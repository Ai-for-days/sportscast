import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import { getRedis } from '../../../../lib/redis';

export const prerender = false;

const FORECAST_SOURCES = ['wageronweather', 'weather.com', 'accuweather', 'nws'];
const SOURCE_LABELS: Record<string, string> = { wageronweather: 'WagerOnWeather.com', 'weather.com': 'Weather.com', accuweather: 'AccuWeather', nws: 'National Weather Service' };
const HAIRCUTS = [0, 0.02, 0.05];

async function buildQuantEdgeAudit() {
  const redis = getRedis();

  /* ================================================================ */
  /*  FORECAST CALIBRATION                                             */
  /* ================================================================ */
  const forecastCount = await redis.zcard('forecasts:all');
  const verificationCount = await redis.zcard('verifications:all');
  const consensusCount = await redis.zcard('consensus:all');

  // Sample verifications for error analysis
  let totalError = 0;
  let totalAbsError = 0;
  let totalBias = 0;
  let verSampled = 0;
  const sourceErrors: Record<string, { sum: number; absSum: number; count: number }> = {};

  if (verificationCount > 0) {
    const ids = await redis.zrange('verifications:all', 0, Math.min(verificationCount, 100) - 1, { rev: true });
    for (const id of ids) {
      const raw = await redis.get(`verification:${id}`);
      if (!raw) continue;
      const v = typeof raw === 'string' ? JSON.parse(raw) : raw as any;
      if (v.signedError != null) {
        totalError += v.signedError;
        totalAbsError += Math.abs(v.signedError);
        totalBias += v.signedError;
        verSampled++;
        const src = v.sourceNormalized || v.source || 'wageronweather';
        const srcKey = Array.isArray(src) ? src[0] : src;
        if (!sourceErrors[srcKey]) sourceErrors[srcKey] = { sum: 0, absSum: 0, count: 0 };
        sourceErrors[srcKey].sum += v.signedError;
        sourceErrors[srcKey].absSum += Math.abs(v.signedError);
        sourceErrors[srcKey].count++;
      }
    }
  }

  const meanError = verSampled > 0 ? Math.round(totalError / verSampled * 100) / 100 : null;
  const mae = verSampled > 0 ? Math.round(totalAbsError / verSampled * 100) / 100 : null;
  const meanBias = verSampled > 0 ? Math.round(totalBias / verSampled * 100) / 100 : null;

  const sourceComparison = Object.entries(sourceErrors).map(([src, data]) => ({
    source: src, label: SOURCE_LABELS[src] || src,
    mae: Math.round(data.absSum / data.count * 100) / 100,
    bias: Math.round(data.sum / data.count * 100) / 100,
    count: data.count,
  }));

  const forecastEvidence = verSampled >= 50 ? 'moderate' : verSampled >= 10 ? 'limited' : 'insufficient';

  const forecast = {
    totalForecasts: forecastCount, totalVerifications: verificationCount, totalConsensus: consensusCount,
    sampleSize: verSampled, meanError, mae, meanBias, sourceComparison,
    trackedSources: FORECAST_SOURCES, sourceLabels: SOURCE_LABELS,
    evidenceStrength: forecastEvidence,
    calibrationNote: 'Forecasts are stored as point/range values, not fully probabilistic outputs. True probability calibration cannot be computed. MAE and bias serve as the closest defensible proxies.',
    qualityAssessment: forecastEvidence === 'moderate' ? 'Partially measured — MAE and bias available from verification data. Not a full calibration analysis.' : forecastEvidence === 'limited' ? 'Weakly measured — small verification sample. Expand verification coverage before relying on accuracy claims.' : 'Not yet measurable — insufficient verification data.',
    missing: ['Full probability calibration (forecasts are not stored as probability distributions)', 'Rolling accuracy windows (requires time-series verification history)', 'Confidence interval coverage analysis'],
  };

  /* ================================================================ */
  /*  PRICING MODEL                                                    */
  /* ================================================================ */
  const pricingCount = await redis.zcard('bookmaker:markets');

  const pricing = {
    totalMarkets: pricingCount,
    evidenceStrength: pricingCount > 20 ? 'limited' : 'insufficient',
    assessment: pricingCount > 0
      ? 'Pricing data present. Model-vs-market comparison available in /admin/pricing-lab. However, no historical pricing time series is tracked — line movement and repricing stability cannot be assessed from stored data.'
      : 'No pricing data available. Generate markets from /admin/pricing-lab first.',
    frictionAwareness: 'The pricing layer computes vig/hold but does not model execution friction (spread, fill uncertainty, fees, latency). Quoted edge is paper edge, not executable edge.',
    missing: ['Historical pricing time series for stability analysis', 'Spread distribution tracking over time', 'Execution friction modeling in price comparisons'],
  };

  /* ================================================================ */
  /*  SIGNAL QUALITY                                                   */
  /* ================================================================ */
  const signalCount = await redis.zcard('kalshi-signals:all');
  const candidateCount = await redis.zcard('exec:candidates:all');

  let edges: number[] = [];
  const confidenceDist: Record<string, number> = {};

  if (signalCount > 0) {
    const sigIds = await redis.zrange('kalshi-signals:all', 0, Math.min(signalCount, 100) - 1, { rev: true });
    for (const id of sigIds) {
      const raw = await redis.get(`kalshi-signal:${id}`);
      if (!raw) continue;
      const s = typeof raw === 'string' ? JSON.parse(raw) : raw as any;
      if (s.edgeYes != null) edges.push(s.edgeYes);
      if (s.confidence) confidenceDist[s.confidence] = (confidenceDist[s.confidence] || 0) + 1;
    }
  }

  const haircutAnalysis = HAIRCUTS.map(h => {
    const adjusted = edges.map(e => Math.abs(e) - h);
    const surviving = adjusted.filter(e => e > 0).length;
    const avgSurviving = adjusted.filter(e => e > 0).length > 0 ? Math.round(adjusted.filter(e => e > 0).reduce((s, e) => s + e, 0) / adjusted.filter(e => e > 0).length * 1000) / 1000 : 0;
    return {
      haircut: `${(h * 100).toFixed(0)}%`,
      haircutValue: h,
      totalSignals: edges.length,
      surviving,
      eliminated: edges.length - surviving,
      survivalRate: edges.length > 0 ? Math.round(surviving / edges.length * 100) : 0,
      avgSurvivingEdge: avgSurviving,
    };
  });

  const rawAvgEdge = edges.length > 0 ? Math.round(edges.reduce((s, e) => s + Math.abs(e), 0) / edges.length * 1000) / 1000 : null;
  const belowThree = edges.filter(e => Math.abs(e) < 0.03).length;
  const signalEvidence = edges.length >= 30 ? 'limited' : 'insufficient';

  const signals = {
    totalSignals: signalCount, sampleSize: edges.length, candidateCount,
    conversionRate: signalCount > 0 && candidateCount > 0 ? Math.round(candidateCount / signalCount * 100) : null,
    rawAvgEdge, confidenceDist,
    belowThreePercent: belowThree, belowThreePercentShare: edges.length > 0 ? Math.round(belowThree / edges.length * 100) : null,
    haircutAnalysis,
    evidenceStrength: signalEvidence,
    qualityNote: 'Signal quality is based on snapshot edge calculations. No systematic outcome tracking exists for resolved trades. Signal quality should be treated as indicative, not validated.',
    missing: ['Realized outcome tracking for signals', 'Hit rate by edge bucket from actual resolutions', 'Signal decay / time-to-expiry analysis'],
  };

  /* ================================================================ */
  /*  THREE QUANT MISTAKES                                             */
  /* ================================================================ */
  const quantMistakes = [
    {
      title: 'Miscalibration & Overconfidence', severity: forecastEvidence === 'moderate' ? 'moderate concern' : 'high concern',
      meaning: 'Model probabilities look precise but may not be well calibrated. Small edge estimates can be artifacts of model noise rather than real advantage.',
      evidence: forecast.qualityAssessment,
      missing: 'Full probability calibration analysis. Forecasts are point values, not probability distributions. True calibration cannot be computed.',
      caution: 'Do not trust edge estimates below 3-5% unless calibration evidence is strong. Current evidence level: ' + forecastEvidence + '.',
    },
    {
      title: 'Market Frictions & Execution Reality', severity: 'high concern',
      meaning: 'Paper edge (model vs mid-market price) is treated as executable edge. Real execution faces spread crossing, fill uncertainty, fees, and latency.',
      evidence: `Haircut analysis shows: at 2% friction, ${haircutAnalysis[1]?.survivalRate || 0}% of signals survive. At 5% friction, ${haircutAnalysis[2]?.survivalRate || 0}% survive. ${belowThree} signals (${signals.belowThreePercentShare || 0}%) have edge below 3%.`,
      missing: 'No execution friction modeling in the pricing/signal pipeline. No spread tracking. No fill-rate analysis.',
      caution: 'Assume at least 2-5% edge erosion from frictions. Only trade signals with edge substantially above this threshold.',
    },
    {
      title: 'Outcome Leakage & Evaluation Discipline', severity: verificationCount > 20 ? 'moderate concern' : 'high concern',
      meaning: 'Signals and models are evaluated using incomplete or contaminated evidence. Without clean out-of-sample validation, apparent performance is unreliable.',
      evidence: verificationCount > 0 ? `${verificationCount} verification records provide some evaluation basis. However, signal-to-outcome attribution is not tracked.` : 'No verification data available. No evaluation basis exists.',
      missing: 'Systematic outcome tracking for executed trades. Out-of-sample validation framework. Survivorship/selection bias analysis.',
      caution: 'Do not scale position sizes based on backtested signal performance until genuine out-of-sample evidence exists.',
    },
  ];

  /* ================================================================ */
  /*  STATISTICAL TESTS                                                */
  /* ================================================================ */
  const statTests = [
    { name: 'Mean Absolute Error', category: 'Forecast', status: verSampled > 0 ? 'available' : 'not_available', value: mae != null ? `${mae}` : null },
    { name: 'Bias / Mean Error', category: 'Forecast', status: verSampled > 0 ? 'available' : 'not_available', value: meanBias != null ? `${meanBias}` : null },
    { name: 'Source-vs-Source Comparison', category: 'Forecast', status: sourceComparison.length > 1 ? 'available' : 'partially_available', value: `${sourceComparison.length} sources compared` },
    { name: 'Rolling Error Windows', category: 'Forecast', status: 'not_available', value: null, note: 'Requires time-series verification history not currently stored in a rolling format' },
    { name: 'Probability Calibration', category: 'Forecast', status: 'not_available', value: null, note: 'Forecasts are point values, not probability distributions' },
    { name: 'Edge Bucket Analysis', category: 'Signal', status: edges.length > 0 ? 'available' : 'not_available', value: edges.length > 0 ? `${edges.length} signals analyzed` : null },
    { name: 'Post-Haircut Survival', category: 'Signal', status: edges.length > 0 ? 'available' : 'not_available', value: edges.length > 0 ? `Analyzed at 0%, 2%, 5% haircuts` : null },
    { name: 'Hit Rate by Edge Bucket', category: 'Signal', status: 'not_available', value: null, note: 'Requires resolved outcome data for signals — not currently tracked' },
    { name: 'Conversion Funnel', category: 'Signal', status: signalCount > 0 ? 'partially_available' : 'not_available', value: signals.conversionRate != null ? `${signals.conversionRate}% signal→candidate` : null, note: 'Candidate→execution→outcome tracking is incomplete' },
    { name: 'Out-of-Sample Validation', category: 'Evaluation', status: 'not_available', value: null, note: 'No formal train/test split or out-of-sample framework exists' },
    { name: 'Survivorship/Selection Bias Review', category: 'Evaluation', status: 'not_available', value: null, note: 'No systematic bias analysis framework. Operator judgment required.' },
  ];

  /* ================================================================ */
  /*  VERDICT                                                          */
  /* ================================================================ */
  const verdict = {
    forecastEvidence: forecastEvidence === 'moderate' ? 'Limited evidence — MAE/bias available but no calibration' : forecastEvidence === 'limited' ? 'Insufficient evidence — small verification sample' : 'Not yet measurable',
    pricingEvidence: pricingCount > 0 ? 'Limited evidence — pricing present but no historical stability analysis' : 'No evidence — no pricing data',
    signalEvidence: signalEvidence === 'limited' ? 'Promising but incomplete — edge data available, no outcome validation' : 'Insufficient evidence — too few signals',
    overallReadiness: 'Not yet statistically validated. The platform has strong engineering and operational controls, but the quantitative edge has not been proven through rigorous out-of-sample evaluation. Trade with extreme caution and small positions only.',
  };

  return { forecast, pricing, signals, quantMistakes, statTests, verdict };
}

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  try {
    const audit = await buildQuantEdgeAudit();
    return new Response(JSON.stringify(audit), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

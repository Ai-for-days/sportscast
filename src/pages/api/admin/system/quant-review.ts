import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import { getRedis } from '../../../../lib/redis';

export const prerender = false;

const FORECAST_SOURCES = ['wageronweather', 'weather.com', 'accuweather', 'nws'];
const FORECAST_SOURCE_LABELS: Record<string, string> = {
  wageronweather: 'WagerOnWeather.com',
  'weather.com': 'Weather.com',
  accuweather: 'AccuWeather',
  nws: 'National Weather Service',
};

async function buildQuantReview() {
  const redis = getRedis();

  // A. Forecast diagnostics
  const forecastCount = await redis.zcard('forecasts:all');
  const verificationCount = await redis.zcard('verifications:all');
  const consensusCount = await redis.zcard('consensus:all');

  // Sample forecast sources
  const sourceCounts: Record<string, number> = {};
  if (forecastCount > 0) {
    const ids = await redis.zrange('forecasts:all', 0, Math.min(forecastCount, 100) - 1, { rev: true });
    for (const id of ids) {
      const raw = await redis.get(`forecast:${id}`);
      if (raw) {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw as any;
        const src = Array.isArray(parsed.source) ? parsed.source[0] : (parsed.source || parsed.sourceNormalized || 'wageronweather');
        sourceCounts[src] = (sourceCounts[src] || 0) + 1;
      }
    }
  }

  // B. Pricing diagnostics
  const pricingCount = await redis.zcard('bookmaker:markets');

  // C. Signal diagnostics
  const signalCount = await redis.zcard('kalshi-signals:all');
  let signalEdges: number[] = [];
  let signalConfidences: Record<string, number> = {};
  if (signalCount > 0) {
    const sigIds = await redis.zrange('kalshi-signals:all', 0, Math.min(signalCount, 50) - 1, { rev: true });
    for (const id of sigIds) {
      const raw = await redis.get(`kalshi-signal:${id}`);
      if (raw) {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw as any;
        if (parsed.edgeYes != null) signalEdges.push(Math.abs(parsed.edgeYes));
        if (parsed.confidence) signalConfidences[parsed.confidence] = (signalConfidences[parsed.confidence] || 0) + 1;
      }
    }
  }

  const avgEdge = signalEdges.length > 0 ? Math.round(signalEdges.reduce((s, e) => s + e, 0) / signalEdges.length * 1000) / 1000 : null;
  const candidateCount = await redis.zcard('exec:candidates:all');

  return {
    forecast: {
      totalForecasts: forecastCount,
      totalVerifications: verificationCount,
      totalConsensus: consensusCount,
      sourceDistribution: sourceCounts,
      trackedSources: FORECAST_SOURCES,
      sourceLabels: FORECAST_SOURCE_LABELS,
      nwsNote: 'NWS is used as the primary verification/observation source. It can also serve as a forecast source when NWS forecast data is ingested alongside other providers.',
    },
    pricing: {
      totalMarkets: pricingCount,
      note: pricingCount > 0 ? 'Pricing data available. Review vig/hold percentages in /admin/pricing-lab.' : 'No pricing data. Generate markets from /admin/pricing-lab.',
    },
    signals: {
      totalSignals: signalCount,
      sampleSize: signalEdges.length,
      avgEdge,
      confidenceDistribution: signalConfidences,
      totalCandidates: candidateCount,
      conversionRate: signalCount > 0 && candidateCount > 0 ? Math.round((candidateCount / signalCount) * 100) : null,
    },
    quantRisks: [
      {
        title: 'Miscalibration & Overconfidence',
        severity: verificationCount > 10 ? 'moderate' : 'unknown',
        findings: [
          verificationCount > 0 ? `${verificationCount} verification records available for calibration analysis.` : 'No verification data — calibration cannot be assessed.',
          avgEdge !== null ? `Average absolute edge: ${(avgEdge * 100).toFixed(1)}%. Edges below 3% may be unreliable after accounting for model uncertainty.` : 'No signal edge data available.',
          'Recommendation: compare model probability outputs against actual outcome frequencies before trusting edge estimates.',
        ],
      },
      {
        title: 'Market Frictions & Execution Reality',
        severity: 'moderate',
        findings: [
          'Signal edge calculations compare model probability to Kalshi market probability.',
          'These comparisons use mid-market or last-traded prices, not actual executable bid/ask spreads.',
          'Real execution will face: spread crossing costs, fill uncertainty, latency between signal generation and execution, and Kalshi platform fees.',
          'Recommendation: assume 2-5% edge erosion from frictions. Only trade signals with edge substantially above this threshold.',
        ],
      },
      {
        title: 'Outcome Leakage & Evaluation Discipline',
        severity: verificationCount > 20 ? 'moderate' : 'high',
        findings: [
          verificationCount > 20 ? `${verificationCount} verification records provide some out-of-sample evidence.` : 'Insufficient verification history for reliable out-of-sample evaluation.',
          'Signal quality metrics are based on snapshot data, not tracked outcomes of actual trades.',
          'No systematic outcome tracking exists for executed trades — P&L is tracked but signal-to-outcome attribution is limited.',
          'Recommendation: track resolved market outcomes against signal predictions before scaling position sizes.',
        ],
      },
    ],
  };
}

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  try {
    const review = await buildQuantReview();
    return new Response(JSON.stringify(review), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

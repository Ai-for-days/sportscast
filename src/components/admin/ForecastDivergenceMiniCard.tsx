// ── Step 167: Compact forecast divergence card for in-tile rendering ────
//
// Pure presentational React component. Used inside the saved-idea /
// draft / QA review surfaces (`WeatherMarketIdeaGenerator.tsx`) where
// the full Step-165 `ForecastDivergenceCard` would dominate the tile.
//
// **Admin-only operator guidance — not customer-facing, not betting
// advice.** Renders the Step-165 stability label + opportunity +
// settlement-risk + divergence/volatility scores + 1-line explanation +
// top 1–3 reasons, plus a deep link to the full inspector.
//
// Insufficient-history input is a first-class state — the operator
// still sees the panel, just with a calm "limited history" hint
// instead of scores so the review/publish flow is never blocked.

import type {
  ForecastDivergenceResult,
  StabilityLabel,
  RiskLevel,
} from '../../lib/forecast-divergence';

interface Props {
  /** Optional Step-165 result. `null` / `undefined` renders an "insufficient history" state. */
  result?: ForecastDivergenceResult | null;
  /** Side label the result was computed for, when picking between A and B. */
  side?: 'A' | 'B';
  /** Loading placeholder. */
  loading?: boolean;
}

const STABILITY_COLOR: Record<StabilityLabel, { bar: string; chip: string; text: string }> = {
  stable: { bar: '#16a34a', chip: '#15803d', text: '#14532d' },
  watch: { bar: '#0ea5e9', chip: '#0369a1', text: '#0c4a6e' },
  unstable: { bar: '#f59e0b', chip: '#b45309', text: '#7c2d12' },
  highly_unstable: { bar: '#dc2626', chip: '#b91c1c', text: '#7f1d1d' },
};

const RISK_COLOR: Record<RiskLevel, string> = {
  low: '#22c55e',
  medium: '#f59e0b',
  high: '#dc2626',
};

const STABILITY_LABEL_COPY: Record<StabilityLabel, string> = {
  stable: 'Stable',
  watch: 'Watch',
  unstable: 'Unstable',
  highly_unstable: 'Highly unstable',
};

const RISK_LABEL_COPY: Record<RiskLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

const METRIC_LABEL: Record<string, string> = {
  high_temp: 'high temp',
  low_temp: 'low temp',
  precipitation_probability: 'precip prob',
  wind_speed: 'wind',
};

const METRIC_UNIT: Record<string, string> = {
  high_temp: '°F',
  low_temp: '°F',
  precipitation_probability: 'pp',
  wind_speed: 'mph',
};

const INSPECTOR_HREF = '/admin/system/forecast-divergence';

export default function ForecastDivergenceMiniCard({ result, side, loading }: Props) {
  if (loading) {
    return (
      <div
        style={{
          marginTop: 8,
          padding: '8px 10px',
          borderRadius: 8,
          background: '#0f172a',
          border: '1px solid #1e293b',
          borderLeft: '4px solid #475569',
          color: '#94a3b8',
          fontSize: 11,
        }}
      >
        Forecast stability signal · loading…
      </div>
    );
  }

  const insufficient =
    !result ||
    result.reasons.includes('insufficient_snapshots') ||
    result.comparedForecasts < 2;

  if (insufficient) {
    return (
      <div
        style={{
          marginTop: 8,
          padding: '8px 10px',
          borderRadius: 8,
          background: '#0f172a',
          border: '1px solid #1e293b',
          borderLeft: '4px solid #475569',
          color: '#cbd5e1',
          fontSize: 11,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 11, color: '#e2e8f0' }}>Forecast Stability Signal</strong>
          <Chip color="#475569" small>Insufficient history</Chip>
        </div>
        <div style={{ marginTop: 4, color: '#94a3b8' }}>
          Limited forecast history available for this idea. The Step 165 engine needs ≥ 2 stored snapshots for the underlying (location, target date, metric) before it can score divergence.
        </div>
        <div style={{ marginTop: 4 }}>
          <a href={INSPECTOR_HREF} style={{ color: '#38bdf8', fontSize: 10, textDecoration: 'none' }}>
            Open inspector →
          </a>
        </div>
      </div>
    );
  }

  const tone = STABILITY_COLOR[result.stabilityLabel];
  const unit = METRIC_UNIT[result.metric] ?? '';
  const metricLabel = METRIC_LABEL[result.metric] ?? result.metric;
  const topReasons = result.reasons.slice(0, 3);

  return (
    <div
      style={{
        marginTop: 8,
        padding: '8px 10px',
        borderRadius: 8,
        background: '#0f172a',
        border: '1px solid #1e293b',
        borderLeft: `4px solid ${tone.bar}`,
        color: '#cbd5e1',
        fontSize: 11,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 11, color: '#e2e8f0' }}>
          Forecast Stability Signal
          {side && (
            <span style={{ color: '#94a3b8', fontWeight: 400, marginLeft: 4 }}>· side {side}</span>
          )}
        </strong>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <Chip color={tone.chip} small>{STABILITY_LABEL_COPY[result.stabilityLabel]}</Chip>
        </div>
      </div>

      <div style={{ marginTop: 4, color: '#e2e8f0', fontSize: 11 }}>
        {metricLabel} · spread {result.spread}{unit} · div {result.divergenceScore}/100 · vol {result.volatilityScore}/100
      </div>

      <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ color: '#94a3b8' }}>Settlement</span>
        <Chip color={RISK_COLOR[result.settlementRisk]} small>{RISK_LABEL_COPY[result.settlementRisk]}</Chip>
        <span style={{ color: '#94a3b8' }}>· Opportunity</span>
        <Chip color={RISK_COLOR[result.opportunitySignal]} small>{RISK_LABEL_COPY[result.opportunitySignal]}</Chip>
      </div>

      {result.explanation && (
        <div style={{ marginTop: 4, color: '#cbd5e1', fontSize: 11, lineHeight: 1.4 }}>
          {result.explanation}
        </div>
      )}

      {topReasons.length > 0 && (
        <ul style={{ margin: '4px 0 0 0', paddingLeft: 14, color: '#94a3b8', fontSize: 10 }}>
          {topReasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}

      <div style={{ marginTop: 4 }}>
        <a href={INSPECTOR_HREF} style={{ color: '#38bdf8', fontSize: 10, textDecoration: 'none' }}>
          Open inspector →
        </a>
      </div>
    </div>
  );
}

function Chip({
  children,
  color,
  small,
}: {
  children: React.ReactNode;
  color: string;
  small?: boolean;
}) {
  return (
    <span
      style={{
        fontSize: small ? 9 : 10,
        fontWeight: 700,
        color: '#fff',
        background: color,
        padding: small ? '1px 6px' : '2px 8px',
        borderRadius: 999,
        textTransform: 'uppercase',
        letterSpacing: 0.3,
      }}
    >
      {children}
    </span>
  );
}

// ── Step 165: Forecast divergence display card ─────────────────────────
//
// Pure presentational React component. Takes a fully-computed
// `ForecastDivergenceResult` and renders the admin-only intelligence
// panel. **Never receives or displays customer-facing copy.** Used by
// the standalone inspector page and (potentially) by future admin
// workflow surfaces that want to embed the divergence signal.

import type {
  ForecastDivergenceResult,
  StabilityLabel,
  RiskLevel,
} from '../../lib/forecast-divergence';

interface Props {
  result: ForecastDivergenceResult;
  /** Optional context line displayed under the title. */
  contextLine?: string;
}

const STABILITY_COLOR: Record<StabilityLabel, { bar: string; chip: string; text: string }> = {
  stable: { bar: '#16a34a', chip: '#15803d', text: '#14532d' },
  watch: { bar: '#0ea5e9', chip: '#0369a1', text: '#0c4a6e' },
  unstable: { bar: '#f59e0b', chip: '#b45309', text: '#7c2d12' },
  highly_unstable: { bar: '#dc2626', chip: '#b91c1c', text: '#7f1d1d' },
};

const RISK_COLOR: Record<RiskLevel, { chip: string; text: string }> = {
  low: { chip: '#22c55e', text: '#14532d' },
  medium: { chip: '#f59e0b', text: '#7c2d12' },
  high: { chip: '#dc2626', text: '#7f1d1d' },
};

const STABILITY_LABEL: Record<StabilityLabel, string> = {
  stable: 'Stable',
  watch: 'Watch',
  unstable: 'Unstable',
  highly_unstable: 'Highly unstable',
};

const RISK_LABEL: Record<RiskLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

const METRIC_LABEL: Record<string, string> = {
  high_temp: 'High temperature',
  low_temp: 'Low temperature',
  precipitation_probability: 'Precipitation probability',
  wind_speed: 'Wind speed',
};

const METRIC_UNIT: Record<string, string> = {
  high_temp: '°F',
  low_temp: '°F',
  precipitation_probability: 'pp',
  wind_speed: 'mph',
};

export default function ForecastDivergenceCard({ result, contextLine }: Props) {
  const tone = STABILITY_COLOR[result.stabilityLabel];
  const unit = METRIC_UNIT[result.metric] ?? '';
  const insufficient = result.reasons.includes('insufficient_snapshots');

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderLeft: `6px solid ${tone.bar}`,
        borderRadius: 12,
        padding: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.3 }}>
            Forecast divergence intelligence · admin-only
          </div>
          <h2 style={{ margin: '4px 0 0 0', fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
            {METRIC_LABEL[result.metric] ?? result.metric}
            {result.cityName ? ` · ${result.cityName}` : ''}
            {result.targetDate ? ` · ${result.targetDate}` : ''}
          </h2>
          {contextLine && (
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{contextLine}</div>
          )}
        </div>
        <Chip color={tone.chip}>{STABILITY_LABEL[result.stabilityLabel]}</Chip>
      </div>

      {insufficient ? (
        <div
          style={{
            marginTop: 10,
            padding: '8px 10px',
            background: '#fef3c7',
            border: '1px solid #fbbf24',
            borderRadius: 8,
            color: '#92400e',
            fontSize: 12,
          }}
        >
          Insufficient snapshots — need at least 2 historical forecasts for this (location, date, metric) to compute divergence.
          The card is rendering the degraded "stable / low" defaults.
        </div>
      ) : null}

      <div
        style={{
          marginTop: 10,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 10,
        }}
      >
        <MetricBox label="Divergence" value={`${result.divergenceScore}/100`} sub={`spread ${result.spread}${unit}`} />
        <MetricBox label="Volatility" value={`${result.volatilityScore}/100`} sub={`max rev ${result.revisionMagnitude}${unit}`} />
        <MetricBox label="Compared" value={`${result.comparedForecasts}`} sub="snapshots" />
        <MetricBox
          label="Horizon"
          value={typeof result.daysUntilTarget === 'number' ? `${result.daysUntilTarget}d` : '—'}
          sub="days until target"
        />
      </div>

      <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <RiskChip label="Settlement risk" level={result.settlementRisk} />
        <RiskChip label="Opportunity signal" level={result.opportunitySignal} />
      </div>

      <div style={{ marginTop: 10, fontSize: 13, color: '#0f172a', lineHeight: 1.45 }}>
        {result.explanation}
      </div>

      {result.reasons.length > 0 && !insufficient && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.3 }}>
            Reasons
          </div>
          <ul style={{ marginTop: 4, paddingLeft: 18, fontSize: 12, color: '#1f2937', lineHeight: 1.5 }}>
            {result.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ marginTop: 8, fontSize: 10, color: '#94a3b8' }}>
        Thresholds for {result.metric}: low ≤ {result.thresholds.low}{unit} · moderate ≤ {result.thresholds.moderate}{unit} · high ≤ {result.thresholds.high}{unit} · severe &gt; {result.thresholds.high}{unit}.
        Admin operator intelligence — not customer-facing. Not betting advice.
      </div>
    </div>
  );
}

function Chip({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        color: '#fff',
        background: color,
        padding: '3px 8px',
        borderRadius: 999,
        textTransform: 'uppercase',
        letterSpacing: 0.3,
      }}
    >
      {children}
    </span>
  );
}

function RiskChip({ label, level }: { label: string; level: RiskLevel }) {
  const tone = RISK_COLOR[level];
  return (
    <span
      style={{
        display: 'inline-flex',
        gap: 6,
        alignItems: 'baseline',
        fontSize: 11,
        color: '#475569',
      }}
    >
      <span>{label}:</span>
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: '#fff',
          background: tone.chip,
          padding: '2px 8px',
          borderRadius: 999,
          textTransform: 'uppercase',
          letterSpacing: 0.3,
        }}
      >
        {RISK_LABEL[level]}
      </span>
    </span>
  );
}

function MetricBox({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div
      style={{
        padding: '8px 10px',
        background: '#f8fafc',
        border: '1px solid #e2e8f0',
        borderRadius: 8,
      }}
    >
      <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.3 }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

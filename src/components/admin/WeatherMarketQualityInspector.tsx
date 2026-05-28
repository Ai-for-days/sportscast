// ── Step 163: Quality-pipeline inspector UI ─────────────────────────────
//
// Compact admin-only view of the Step-163 quality pipeline. Runs a
// fresh generate request via the existing
// /api/admin/system/weather-market-ideas endpoint and renders every
// evaluated idea — retained AND suppressed — with quality score,
// normalized confidence, suppression / dedupe reason, and the
// per-component breakdown. Filters + sort options let the operator
// audit *why* the pipeline made each decision.
//
// **Admin-only. Read-only. No betting advice. No mutation.**

import { useEffect, useMemo, useState } from 'react';

type QualityTier = 'exceptional' | 'strong' | 'moderate' | 'weak' | 'suppress';

type GenerationMode =
  | 'focused'
  | 'balanced'
  | 'broad_scan'
  | 'discovery'
  | 'rivalry_scan'
  | 'volatility_scan'
  | 'seasonal_scan';

interface QualityComponents {
  forecastConfidence: number;
  crossModelAgreement: number;
  regionalUniqueness: number;
  spreadUniqueness: number;
  metricClarity: number;
  noveltyScore: number;
  rarityProxy: number;
  diversityContribution: number;
}

interface InspectorIdea {
  id: string;
  title: string;
  targetDate: string;
  suggestedSpread: number;
  metricA: string;
  metricB: string;
  locationA: { id: string; label: string; region: string };
  locationB: { id: string; label: string; region: string };
  qualityScore?: number;
  qualityTier?: QualityTier;
  qualityComponents?: QualityComponents;
  rawConfidence?: number;
  normalizedConfidence?: number;
  suppressed?: boolean;
  suppressionReason?: string;
  dedupeClusterId?: string;
  dedupeClusterSize?: number;
  noveltyContribution?: number;
  diversityContribution?: number;
}

interface InspectorResult {
  generatedAt: string;
  targetDate: string;
  resolved: {
    generationMode: GenerationMode;
    evaluatedBeforeSuppressionCount?: number;
    retainedAfterSuppressionCount?: number;
    suppressedCount?: number;
    dedupedCount?: number;
    avgQualityScore?: number;
    suppressedByReason?: Record<string, number>;
  };
  ideas: InspectorIdea[];
  evaluatedIdeas?: InspectorIdea[];
}

const API = '/api/admin/system/weather-market-ideas';

const TIER_COLOR: Record<QualityTier, string> = {
  exceptional: '#15803d',
  strong: '#22c55e',
  moderate: '#0ea5e9',
  weak: '#b45309',
  suppress: '#dc2626',
};

const SORT_OPTIONS = [
  { id: 'quality_desc', label: 'Quality (high → low)' },
  { id: 'novelty', label: 'Novelty contribution' },
  { id: 'confidence_delta', label: 'Confidence delta (raw − normalized)' },
  { id: 'cluster_size', label: 'Suppression cluster size' },
] as const;

type SortId = (typeof SORT_OPTIONS)[number]['id'];

const MODES: GenerationMode[] = [
  'focused',
  'balanced',
  'broad_scan',
  'discovery',
  'rivalry_scan',
  'volatility_scan',
  'seasonal_scan',
];

const RETENTION_OPTIONS = ['all', 'retained', 'suppressed'] as const;
type RetentionFilter = (typeof RETENTION_OPTIONS)[number];

const TIER_OPTIONS: Array<'all' | QualityTier> = [
  'all',
  'exceptional',
  'strong',
  'moderate',
  'weak',
  'suppress',
];

function defaultDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 2);
  return d.toISOString().slice(0, 10);
}

export default function WeatherMarketQualityInspector() {
  const [mode, setMode] = useState<GenerationMode>('balanced');
  const [targetDate, setTargetDate] = useState<string>(defaultDate());
  const [retention, setRetention] = useState<RetentionFilter>('all');
  const [tierFilter, setTierFilter] = useState<'all' | QualityTier>('all');
  const [sortId, setSortId] = useState<SortId>('quality_desc');
  const [result, setResult] = useState<InspectorResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runGenerate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate',
          targetDate,
          generationMode: mode,
          metricPair: 'any_temperature_pair',
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      if (body?.result) setResult(body.result as InspectorResult);
      else setError('malformed_response');
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  // Initial fetch
  useEffect(() => {
    runGenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allIdeas: InspectorIdea[] = useMemo(() => {
    if (!result) return [];
    return result.evaluatedIdeas && result.evaluatedIdeas.length > 0
      ? result.evaluatedIdeas
      : result.ideas;
  }, [result]);

  const filtered = useMemo(() => {
    if (!allIdeas) return [];
    let list = allIdeas.slice();
    if (retention === 'retained') list = list.filter((i) => !i.suppressed);
    else if (retention === 'suppressed') list = list.filter((i) => !!i.suppressed);
    if (tierFilter !== 'all') list = list.filter((i) => i.qualityTier === tierFilter);
    list.sort((a, b) => {
      switch (sortId) {
        case 'quality_desc':
          return (b.qualityScore ?? -1) - (a.qualityScore ?? -1);
        case 'novelty':
          return (b.noveltyContribution ?? -1) - (a.noveltyContribution ?? -1);
        case 'confidence_delta':
          return (
            Math.abs((b.rawConfidence ?? 0) - (b.normalizedConfidence ?? 0)) -
            Math.abs((a.rawConfidence ?? 0) - (a.normalizedConfidence ?? 0))
          );
        case 'cluster_size':
          return (b.dedupeClusterSize ?? 0) - (a.dedupeClusterSize ?? 0);
        default:
          return 0;
      }
    });
    return list;
  }, [allIdeas, retention, tierFilter, sortId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Header
        mode={mode}
        setMode={setMode}
        targetDate={targetDate}
        setTargetDate={setTargetDate}
        retention={retention}
        setRetention={setRetention}
        tierFilter={tierFilter}
        setTierFilter={setTierFilter}
        sortId={sortId}
        setSortId={setSortId}
        onRun={runGenerate}
        busy={busy}
      />

      {error && (
        <div
          style={{
            padding: '10px 14px',
            border: '1px solid #fca5a5',
            background: '#fef2f2',
            color: '#7f1d1d',
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          Failed to generate ideas: {error}.
        </div>
      )}

      {result && (
        <ResolvedStrip resolved={result.resolved} totalShown={filtered.length} />
      )}

      <IdeasTable ideas={filtered} />
    </div>
  );
}

function Header({
  mode,
  setMode,
  targetDate,
  setTargetDate,
  retention,
  setRetention,
  tierFilter,
  setTierFilter,
  sortId,
  setSortId,
  onRun,
  busy,
}: {
  mode: GenerationMode;
  setMode: (m: GenerationMode) => void;
  targetDate: string;
  setTargetDate: (s: string) => void;
  retention: RetentionFilter;
  setRetention: (r: RetentionFilter) => void;
  tierFilter: 'all' | QualityTier;
  setTierFilter: (t: 'all' | QualityTier) => void;
  sortId: SortId;
  setSortId: (s: SortId) => void;
  onRun: () => void;
  busy: boolean;
}) {
  const input: React.CSSProperties = {
    padding: '6px 8px',
    borderRadius: 6,
    border: '1px solid #cbd5e1',
    fontSize: 12,
    background: '#fff',
    color: '#0f172a',
  };
  const label: React.CSSProperties = {
    fontSize: 11,
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    display: 'block',
    marginBottom: 2,
  };
  return (
    <div
      style={{
        padding: 16,
        borderRadius: 12,
        background: 'linear-gradient(135deg,#0f172a,#1e293b)',
        color: '#e2e8f0',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.3 }}>
            Quality pipeline inspector
          </div>
          <h1 style={{ margin: '4px 0 0 0', fontSize: 20, fontWeight: 700 }}>
            Why did the generator keep — or suppress — each idea?
          </h1>
        </div>
        <button
          onClick={onRun}
          disabled={busy}
          style={{
            padding: '6px 14px',
            borderRadius: 6,
            border: '1px solid #475569',
            background: busy ? '#334155' : '#2563eb',
            color: '#fff',
            cursor: busy ? 'wait' : 'pointer',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {busy ? 'Generating…' : 'Re-run generate'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
        <div>
          <span style={label}>Generation mode</span>
          <select style={input} value={mode} onChange={(e) => setMode(e.target.value as GenerationMode)}>
            {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <span style={label}>Target date</span>
          <input
            type="date"
            style={input}
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
          />
        </div>
        <div>
          <span style={label}>Retention</span>
          <select style={input} value={retention} onChange={(e) => setRetention(e.target.value as RetentionFilter)}>
            {RETENTION_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <span style={label}>Quality tier</span>
          <select style={input} value={tierFilter} onChange={(e) => setTierFilter(e.target.value as 'all' | QualityTier)}>
            {TIER_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <span style={label}>Sort by</span>
          <select style={input} value={sortId} onChange={(e) => setSortId(e.target.value as SortId)}>
            {SORT_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
      </div>

      <div style={{ fontSize: 10, color: '#94a3b8' }}>
        Admin-only quality audit. Not betting advice. Hard caps unchanged (MAX_RESULTS_CAP=100, MAX_EXPANDED_CITIES=100, concurrency=8).
      </div>
    </div>
  );
}

function ResolvedStrip({
  resolved,
  totalShown,
}: {
  resolved: InspectorResult['resolved'];
  totalShown: number;
}) {
  const items: Array<{ label: string; value: string }> = [
    { label: 'Mode', value: resolved.generationMode },
    {
      label: 'Evaluated',
      value: `${resolved.evaluatedBeforeSuppressionCount ?? '—'}`,
    },
    {
      label: 'Retained',
      value: `${resolved.retainedAfterSuppressionCount ?? '—'}`,
    },
    { label: 'Suppressed', value: `${resolved.suppressedCount ?? '—'}` },
    { label: 'Deduped', value: `${resolved.dedupedCount ?? '—'}` },
    {
      label: 'Avg quality',
      value:
        resolved.avgQualityScore !== undefined
          ? `${resolved.avgQualityScore.toFixed(1)}`
          : '—',
    },
    { label: 'Shown after filters', value: `${totalShown}` },
  ];
  return (
    <div
      style={{
        padding: 12,
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        display: 'flex',
        gap: 16,
        flexWrap: 'wrap',
        fontSize: 12,
      }}
    >
      {items.map((it) => (
        <div key={it.label} style={{ display: 'flex', gap: 6 }}>
          <span style={{ color: '#64748b' }}>{it.label}:</span>
          <span style={{ fontWeight: 600, color: '#0f172a' }}>{it.value}</span>
        </div>
      ))}
      {resolved.suppressedByReason && Object.keys(resolved.suppressedByReason).length > 0 && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: '#64748b' }}>By reason:</span>
          {Object.entries(resolved.suppressedByReason).map(([k, v]) => (
            <span
              key={k}
              style={{
                fontSize: 10,
                padding: '1px 6px',
                borderRadius: 999,
                background: '#e2e8f0',
                color: '#1f2937',
              }}
            >
              {k}: {v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function IdeasTable({ ideas }: { ideas: InspectorIdea[] }) {
  if (ideas.length === 0) {
    return (
      <div
        style={{
          padding: 16,
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          fontSize: 13,
          color: '#64748b',
          fontStyle: 'italic',
        }}
      >
        No ideas match the current filters.
      </div>
    );
  }

  const cell: React.CSSProperties = { padding: '6px 8px', verticalAlign: 'top' };
  const head: React.CSSProperties = {
    ...cell,
    fontSize: 10,
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    textAlign: 'left',
    fontWeight: 700,
  };

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        overflowX: 'auto',
      }}
    >
      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
            <th style={head}>Idea</th>
            <th style={head}>Tier</th>
            <th style={head}>Quality</th>
            <th style={head}>Confidence</th>
            <th style={head}>Novelty</th>
            <th style={head}>Diversity</th>
            <th style={head}>Cluster</th>
            <th style={head}>Status</th>
          </tr>
        </thead>
        <tbody>
          {ideas.map((idea) => {
            const tier = idea.qualityTier ?? 'moderate';
            const tone = TIER_COLOR[tier];
            return (
              <tr
                key={idea.id}
                style={{
                  borderTop: '1px solid #f1f5f9',
                  background: idea.suppressed ? '#fef2f2' : '#fff',
                }}
              >
                <td style={cell}>
                  <div style={{ fontWeight: 600, color: '#0f172a' }}>{idea.title}</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>
                    {idea.locationA.label} ({idea.locationA.region}) → {idea.locationB.label} ({idea.locationB.region}) · {idea.metricA} vs {idea.metricB} · spread {idea.suggestedSpread >= 0 ? '+' : ''}{idea.suggestedSpread}°F
                  </div>
                </td>
                <td style={cell}>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: '#fff',
                      background: tone,
                      padding: '2px 6px',
                      borderRadius: 999,
                      textTransform: 'uppercase',
                      letterSpacing: 0.3,
                    }}
                  >
                    {tier}
                  </span>
                </td>
                <td style={cell}>
                  <strong>{idea.qualityScore?.toFixed(1) ?? '—'}</strong>
                  {idea.qualityComponents && (
                    <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
                      F:{idea.qualityComponents.forecastConfidence.toFixed(0)}
                      {' '}M:{idea.qualityComponents.crossModelAgreement.toFixed(0)}
                      {' '}R:{idea.qualityComponents.regionalUniqueness.toFixed(0)}
                      {' '}S:{idea.qualityComponents.spreadUniqueness.toFixed(0)}
                      {' '}C:{idea.qualityComponents.metricClarity.toFixed(0)}
                      {' '}N:{idea.qualityComponents.noveltyScore.toFixed(0)}
                      {' '}P:{idea.qualityComponents.rarityProxy.toFixed(0)}
                      {' '}D:{idea.qualityComponents.diversityContribution.toFixed(0)}
                    </div>
                  )}
                </td>
                <td style={cell}>
                  raw {idea.rawConfidence?.toFixed(1) ?? '—'} → norm {idea.normalizedConfidence?.toFixed(1) ?? '—'}
                </td>
                <td style={cell}>{idea.noveltyContribution?.toFixed(1) ?? '—'}</td>
                <td style={cell}>{idea.diversityContribution?.toFixed(1) ?? '—'}</td>
                <td style={cell}>
                  {idea.dedupeClusterId ?? '—'}
                  {idea.dedupeClusterSize && idea.dedupeClusterSize > 1 && (
                    <span style={{ fontSize: 10, color: '#64748b', marginLeft: 4 }}>×{idea.dedupeClusterSize}</span>
                  )}
                </td>
                <td style={cell}>
                  {idea.suppressed ? (
                    <div>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: '#fff',
                          background: '#dc2626',
                          padding: '2px 6px',
                          borderRadius: 999,
                          textTransform: 'uppercase',
                        }}
                      >
                        Suppressed
                      </span>
                      <div style={{ fontSize: 10, color: '#7f1d1d', marginTop: 2 }}>
                        {idea.suppressionReason ?? 'unspecified'}
                      </div>
                    </div>
                  ) : (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: '#fff',
                        background: '#15803d',
                        padding: '2px 6px',
                        borderRadius: 999,
                        textTransform: 'uppercase',
                      }}
                    >
                      Retained
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

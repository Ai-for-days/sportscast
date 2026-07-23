// ── Step 159: Daily market brief admin UI ────────────────────────────────
//
// Single-screen operator dashboard backed by /api/admin/system/
// weather-market-daily-brief. Sections are capped at 8 entries each
// (server-side) and rendered as scannable cards with deep links into
// the existing /admin/system/weather-market-ideas workspace.
//
// **Admin-only operator situational awareness. Never customer-facing.
// No mutations. No betting advice.**

import { useEffect, useState } from 'react';
import { formatDMYTime } from '../../lib/date-format';

type BriefItemTone = 'info' | 'warning' | 'high' | 'positive';
type SubsystemHealth = 'ok' | 'failed' | 'skipped';

interface BriefItem {
  id: string;
  title: string;
  subtitle?: string;
  link?: string;
  tone?: BriefItemTone;
  meta?: Record<string, string>;
}

interface DailyBrief {
  generatedAt: string;
  summaryHeadline: string;
  generatedHighlights: BriefItem[];
  interestingMarkets: BriefItem[];
  riskAlerts: BriefItem[];
  qaPending: BriefItem[];
  staleDrafts: BriefItem[];
  recentlyPublished: BriefItem[];
  feedbackSignals: BriefItem[];
  tuningSignals: BriefItem[];
  /** Step 166 — bounded list of operator-actionable divergence findings. */
  forecastDivergenceWatch?: BriefItem[];
  /** Top Kalshi climate markets from the most recent climate snapshot. */
  kalshiClimateMarkets?: BriefItem[];
  operationalWarnings: string[];
  subsystemStatus: Record<string, SubsystemHealth>;
  counts: {
    savedIdeasActive: number;
    draftsActive: number;
    qaPending: number;
    qaNeedsChanges: number;
    highSeverityWarnings: number;
    recentlyPublished: number;
    /** Step 166 — divergence findings surfaced for review. */
    divergenceWatch?: number;
    /** Kalshi climate markets covered by the most recent climate snapshot. */
    kalshiClimateMarkets?: number;
    kalshiClimateCities?: number;
  };
  kalshiClimateSnapshot?: {
    id: string;
    createdAt: string;
    env: 'demo' | 'live';
    marketCount: number;
    cityCount: number;
  };
  kalshiClimateDiagnostic?: {
    scanned: number;
    matchedByKind: number;
    matchedByTickerPrefix: number;
    recentKinds: Array<string | null>;
    recentMarketCounts: number[];
    recentTickerPrefixes: string[];
    resolvedVia: 'kind_tag' | 'ticker_prefix_fallback' | null;
  };
}

const API = '/api/admin/system/weather-market-daily-brief';

const TONE_COLOR: Record<BriefItemTone, { bar: string; chip: string; text: string }> = {
  info: { bar: '#cbd5e1', chip: '#64748b', text: '#1f2937' },
  warning: { bar: '#fbbf24', chip: '#b45309', text: '#92400e' },
  high: { bar: '#dc2626', chip: '#b91c1c', text: '#7f1d1d' },
  positive: { bar: '#22c55e', chip: '#15803d', text: '#14532d' },
};

const SUBSYSTEM_LABEL: Record<string, string> = {
  savedIdeas: 'Saved ideas',
  drafts: 'Drafts',
  qa: 'Post-publish QA',
  feedback: 'Feedback',
  riskUniverse: 'Risk universe',
  wagers: 'Live wagers',
  divergenceWatch: 'Forecast divergence',
  kalshiClimate: 'Kalshi climate snapshot',
};

export default function WeatherMarketDailyBrief() {
  const [brief, setBrief] = useState<DailyBrief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(API)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`);
          return;
        }
        if (body?.brief) setBrief(body.brief as DailyBrief);
        else setError('malformed_response');
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message ?? String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Header
        brief={brief}
        loading={loading}
        onRefresh={() => setRefreshTick((t) => t + 1)}
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
          Failed to load daily brief: {error}. The brief is still operator-only — no
          customer impact.
        </div>
      )}

      {brief && (
        <>
          <SubsystemStatus status={brief.subsystemStatus} />

          <Section
            title="1. Today's highlights"
            description="High-interest ideas saved in the last 24h."
            items={brief.generatedHighlights}
            emptyCopy="No high-interest ideas saved in the last 24h."
          />
          <Section
            title="2. Interesting markets"
            description="Saved ideas the scorer rated promising or high-interest."
            items={brief.interestingMarkets}
            emptyCopy="No promising or high-interest saved ideas right now."
          />
          <Section
            title="3. Risk alerts"
            description="Saved ideas, drafts, and QA items carrying high-severity duplicate or correlation warnings."
            items={brief.riskAlerts}
            emptyCopy="No high-severity risk warnings — workflow is clean."
          />
          <Section
            title="3b. Forecast Divergence Watch"
            description="Step 166 — saved-idea sides whose recent forecast snapshots show non-trivial divergence, volatility, or settlement risk. Sorted: opportunity high → unstable → divergence → volatility → low settlement risk first."
            items={brief.forecastDivergenceWatch ?? []}
            emptyCopy="No actionable divergence signals right now — saved ideas have settled or no historical snapshots are available yet."
          />
          <Section
            title="3c. Kalshi climate activity"
            description={
              brief.kalshiClimateSnapshot
                ? `Top ${(brief.kalshiClimateMarkets ?? []).length} Kalshi KXHIGH/KXLOW markets by volume from snapshot ${brief.kalshiClimateSnapshot.id} (${brief.kalshiClimateSnapshot.env}, ${brief.kalshiClimateSnapshot.cityCount} cities, ${brief.kalshiClimateSnapshot.marketCount} markets total, captured ${formatDMYTime(brief.kalshiClimateSnapshot.createdAt)}). Refresh from /admin/system/kalshi-market-data.`
                : `No Kalshi climate snapshot in Redis yet. Click "Fetch climate markets" on /admin/system/kalshi-market-data to capture one.${brief.kalshiClimateDiagnostic ? ` (scanned ${brief.kalshiClimateDiagnostic.scanned} recent snapshots; kinds=[${brief.kalshiClimateDiagnostic.recentKinds.map((k) => k ?? 'null').join(', ')}]; market counts=[${brief.kalshiClimateDiagnostic.recentMarketCounts.join(', ')}]; ticker prefixes=[${brief.kalshiClimateDiagnostic.recentTickerPrefixes.join(', ')}])` : ''}`
            }
            items={brief.kalshiClimateMarkets ?? []}
            emptyCopy="No Kalshi climate snapshot captured yet — click Fetch climate markets on /admin/system/kalshi-market-data."
          />
          <Section
            title="4. QA queue"
            description="Published markets whose post-publish QA is pending or needs changes."
            items={brief.qaPending}
            emptyCopy="QA queue is empty — every published market has been reviewed."
          />
          <Section
            title="5. Drafts awaiting action"
            description={`Drafts that have not been published or updated in the last 48h.`}
            items={brief.staleDrafts}
            emptyCopy="No stale drafts."
          />
          <Section
            title="6. Recently published"
            description="Drafts promoted to live wagers in the last 48h."
            items={brief.recentlyPublished}
            emptyCopy="No recently published markets."
          />
          <Section
            title="7. Feedback signals"
            description="Per-preset useful rate and advisory tuning note from operator feedback."
            items={brief.feedbackSignals}
            emptyCopy="No feedback signals yet — submit feedback on generated ideas to populate this section."
          />
          <Section
            title="7. Tuning signals"
            description="Top-level advisory notes from the feedback aggregator."
            items={brief.tuningSignals}
            emptyCopy="No tuning notes yet."
          />

          <OperationalWarnings items={brief.operationalWarnings} />

          <Footer brief={brief} />
        </>
      )}

      {!brief && !error && !loading && (
        <div style={{ color: '#64748b', fontSize: 13 }}>No brief data available.</div>
      )}
    </div>
  );
}

function Header({
  brief,
  loading,
  onRefresh,
}: {
  brief: DailyBrief | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '16px 20px',
        borderRadius: 12,
        background: 'linear-gradient(135deg, #0f172a, #1e293b)',
        color: '#e2e8f0',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.3 }}>
            Admin daily market brief
          </div>
          <h1 style={{ margin: '4px 0 0 0', fontSize: 22, fontWeight: 700 }}>
            What should Derek look at today?
          </h1>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            border: '1px solid #475569',
            background: loading ? '#334155' : '#1e293b',
            color: '#e2e8f0',
            cursor: loading ? 'wait' : 'pointer',
            fontSize: 12,
          }}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div style={{ fontSize: 14, color: '#cbd5e1', lineHeight: 1.5 }}>
        {loading ? 'Loading brief…' : brief?.summaryHeadline ?? '—'}
      </div>

      {brief && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 4, fontSize: 12 }}>
          <Stat label="Active ideas" value={brief.counts.savedIdeasActive} />
          <Stat label="Active drafts" value={brief.counts.draftsActive} />
          <Stat label="QA pending" value={brief.counts.qaPending} tone={brief.counts.qaPending > 0 ? 'warning' : 'info'} />
          <Stat label="QA needs changes" value={brief.counts.qaNeedsChanges} tone={brief.counts.qaNeedsChanges > 0 ? 'high' : 'info'} />
          <Stat
            label="High-sev warnings"
            value={brief.counts.highSeverityWarnings}
            tone={brief.counts.highSeverityWarnings > 0 ? 'high' : 'info'}
          />
          <Stat label="Recently published" value={brief.counts.recentlyPublished} tone="positive" />
          {typeof brief.counts.divergenceWatch === 'number' && (
            <Stat
              label="Divergence watch"
              value={brief.counts.divergenceWatch}
              tone={brief.counts.divergenceWatch > 0 ? 'warning' : 'info'}
            />
          )}
          {typeof brief.counts.kalshiClimateMarkets === 'number' && (
            <Stat
              label="Kalshi climate markets"
              value={brief.counts.kalshiClimateMarkets}
              tone={brief.counts.kalshiClimateMarkets > 0 ? 'positive' : 'info'}
            />
          )}
          {typeof brief.counts.kalshiClimateCities === 'number' && (
            <Stat
              label="Kalshi climate cities"
              value={brief.counts.kalshiClimateCities}
              tone="info"
            />
          )}
        </div>
      )}

      <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4 }}>
        Admin-only situational awareness. Never customer-facing. Not betting advice. No automatic actions are taken from this surface.
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'info',
}: {
  label: string;
  value: number;
  tone?: BriefItemTone;
}) {
  const color =
    tone === 'high' ? '#fca5a5' : tone === 'warning' ? '#fcd34d' : tone === 'positive' ? '#86efac' : '#cbd5e1';
  return (
    <div
      style={{
        display: 'flex',
        gap: 6,
        alignItems: 'baseline',
        padding: '4px 8px',
        background: 'rgba(15,23,42,0.6)',
        border: '1px solid #334155',
        borderRadius: 999,
      }}
    >
      <span style={{ color, fontWeight: 700 }}>{value}</span>
      <span style={{ color: '#94a3b8' }}>{label}</span>
    </div>
  );
}

function Section({
  title,
  description,
  items,
  emptyCopy,
}: {
  title: string;
  description: string;
  items: BriefItem[];
  emptyCopy: string;
}) {
  return (
    <section
      style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        padding: 16,
      }}
    >
      <div style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{title}</h2>
        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{description}</div>
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>{emptyCopy}</div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {items.map((it) => (
            <BriefItemRow key={it.id} item={it} />
          ))}
        </ul>
      )}
    </section>
  );
}

function BriefItemRow({ item }: { item: BriefItem }) {
  const tone: BriefItemTone = item.tone ?? 'info';
  const color = TONE_COLOR[tone];
  const body = (
    <div
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        padding: '8px 10px',
        borderRadius: 8,
        background: '#f8fafc',
        borderLeft: `4px solid ${color.bar}`,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', wordBreak: 'break-word' }}>
          {item.title}
        </div>
        {item.subtitle && (
          <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>{item.subtitle}</div>
        )}
        {item.meta && Object.keys(item.meta).length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
            {Object.entries(item.meta).map(([k, v]) =>
              v ? (
                <span
                  key={k}
                  style={{
                    fontSize: 10,
                    padding: '1px 6px',
                    borderRadius: 999,
                    background: '#e2e8f0',
                    color: '#475569',
                  }}
                >
                  {k}: {v}
                </span>
              ) : null,
            )}
          </div>
        )}
      </div>
    </div>
  );
  if (item.link) {
    return (
      <li>
        <a
          href={item.link}
          style={{ textDecoration: 'none', color: 'inherit' }}
        >
          {body}
        </a>
      </li>
    );
  }
  return <li>{body}</li>;
}

function SubsystemStatus({ status }: { status: Record<string, SubsystemHealth> }) {
  const failed = Object.entries(status).filter(([, h]) => h === 'failed');
  if (failed.length === 0) return null;
  return (
    <div
      style={{
        padding: '8px 12px',
        borderRadius: 8,
        background: '#fef3c7',
        border: '1px solid #fbbf24',
        color: '#92400e',
        fontSize: 12,
      }}
    >
      <strong>Partial degradation:</strong>{' '}
      {failed.map(([k]) => SUBSYSTEM_LABEL[k] ?? k).join(', ')} failed to load. Sections backed by
      these subsystems may be empty.
    </div>
  );
}

function OperationalWarnings({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section
      style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        padding: 16,
      }}
    >
      <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
        Operational notes
      </h2>
      <ul style={{ listStyle: 'disc', paddingLeft: 20, marginTop: 8, marginBottom: 0, fontSize: 12, color: '#475569' }}>
        {items.map((s, i) => (
          <li key={i} style={{ marginBottom: 4 }}>{s}</li>
        ))}
      </ul>
    </section>
  );
}

function Footer({ brief }: { brief: DailyBrief }) {
  return (
    <div style={{ fontSize: 11, color: '#94a3b8', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
      <span>Generated {formatDMYTime(brief.generatedAt)}.</span>
      <span>
        <a href="/admin/system/weather-market-ideas" style={{ color: '#1d4ed8' }}>
          Open Weather Market Ideas →
        </a>
      </span>
    </div>
  );
}

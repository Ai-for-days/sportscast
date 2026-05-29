// ── Step 159: Admin-only daily market brief aggregator ─────────────────────
//
// Compact operator-overview layer that answers "what should I look at
// today?" by pulling read-only signals from the existing weather-market
// workflow stores (Steps 146/147/149/150/155/156) and rolling them into
// a handful of capped, scannable sections.
//
// **Admin-only. Read-only. No I/O outside the existing read paths.**
// Never publishes, creates, voids, grades, settles, or prices anything.
// Never reads or writes wallet/balance/settlement state. Never imports
// or calls any `createWager` / `publishWager` / `voidWager` /
// `gradeWager` / `settleWagerBets` function — only the read-only
// stores + the read-only wager shim from Step 150.
//
// Trust posture:
//   - Server-only — browser-import throws.
//   - Pure aggregation. Every subsystem call is wrapped in `try/catch`
//     so a single failure degrades the brief gracefully rather than
//     500-ing the whole endpoint. Failed subsystems show up in
//     `subsystemStatus` so the UI can surface "(degraded)".
//   - No new persistence. Every read goes through an existing store.

import { listSavedIdeas, type SavedWeatherMarketIdea } from './weather-market-idea-store';
import {
  listDraftWagers,
  type DraftWager,
} from './weather-market-draft-wager-store';
import {
  listMarketQA,
  type MarketQA,
} from './weather-market-qa-store';
import {
  listFeedback,
  type WeatherMarketIdeaFeedback,
} from './weather-market-idea-feedback-store';
import { summarizeFeedback, type FeedbackSummary } from './weather-market-idea-feedback-summary';
import {
  fetchRiskUniverse,
  analyzeRisk,
  normalizeIdea,
  normalizeDraft,
  normalizeWager,
  type WeatherMarketRiskWarning,
  type MarketRiskUniverse,
} from './weather-market-risk-warnings';
import { listAllWagers } from './weather-market-store-admin';
// Step 166 — divergence watch helper. Wraps the Step 165 engine over
// recent saved ideas + the existing Step-132 snapshot store.
import {
  buildForecastDivergenceWatch,
  type ForecastDivergenceWatchEntry,
} from './forecast-divergence-watch';
// Kalshi climate market activity — pulls the most recent climate-kind
// snapshot from Redis. No live API call; the operator manually
// refreshes snapshots from /admin/system/kalshi-market-data when they
// want fresh data.
import {
  getLatestClimateSnapshot,
  type ClimateSnapshotDiagnostic,
  type KalshiMarketSnapshot,
  type KalshiMarketSummary,
} from './kalshi-market-data';
import { formatCentsAsAmericanOdds } from './odds';

if (typeof window !== 'undefined') {
  throw new Error(
    'weather-market-daily-brief is server-only and must not be imported in client code',
  );
}

// ── Public types ────────────────────────────────────────────────────────────

export type BriefItemTone = 'info' | 'warning' | 'high' | 'positive';

export interface BriefItem {
  /** Stable id used by the UI for `key` props. */
  id: string;
  title: string;
  /** Optional one-line subtitle (e.g. "saved 4h ago · interestingness 78/100"). */
  subtitle?: string;
  /** Optional deep link into the admin workflow page. */
  link?: string;
  tone?: BriefItemTone;
  /** Small structured key/value pairs for inline rendering. */
  meta?: Record<string, string>;
}

export type SubsystemHealth = 'ok' | 'failed' | 'skipped';

export interface WeatherMarketDailyBrief {
  generatedAt: string;
  summaryHeadline: string;
  /** Top saved ideas with high interestingness from recent runs. */
  generatedHighlights: BriefItem[];
  /** Saved ideas the scorer rated `high_interest` / `promising`. */
  interestingMarkets: BriefItem[];
  /** Items carrying severity:'high' risk warnings across ideas/drafts/QA. */
  riskAlerts: BriefItem[];
  /** Published wagers whose post-publish QA is still pending or needs changes. */
  qaPending: BriefItem[];
  /** Drafts older than the stale threshold and still `status='draft'`. */
  staleDrafts: BriefItem[];
  /** Drafts published in the last `RECENT_PUBLISH_WINDOW_HOURS` hours. */
  recentlyPublished: BriefItem[];
  /** Feedback rollup highlights (per-preset useful rate). */
  feedbackSignals: BriefItem[];
  /** Top-level advisory tuning notes from the feedback summary. */
  tuningSignals: BriefItem[];
  /** Step 166 — bounded list of operator-actionable forecast-divergence signals. */
  forecastDivergenceWatch: BriefItem[];
  /** Kalshi climate market activity from the most recent climate snapshot.
   *  Empty when no climate snapshot has been captured yet. */
  kalshiClimateMarkets: BriefItem[];
  /** Plain-text bullets summarizing operational risks (failure rates etc.). */
  operationalWarnings: string[];
  /** Per-subsystem load status — UI uses to flag partial degradation. */
  subsystemStatus: Record<string, SubsystemHealth>;
  /** Aggregate counts for the header strip. */
  counts: {
    savedIdeasActive: number;
    draftsActive: number;
    qaPending: number;
    qaNeedsChanges: number;
    highSeverityWarnings: number;
    recentlyPublished: number;
    /** Step 166 — non-trivial divergence findings surfaced for review. */
    divergenceWatch: number;
    /** Kalshi climate markets seen in the most recent climate snapshot. */
    kalshiClimateMarkets: number;
    /** Distinct cities (derived from KXHIGH/KXLOW ticker suffix) covered
     *  by the most recent climate snapshot. */
    kalshiClimateCities: number;
  };
  /** Metadata for the most recent Kalshi climate snapshot, when present. */
  kalshiClimateSnapshot?: {
    id: string;
    createdAt: string;
    env: 'demo' | 'live';
    marketCount: number;
    cityCount: number;
  };
  /** Diagnostic info about the Kalshi climate snapshot resolution. Surfaced
   *  so operators can see whether the scan found nothing, found a tagged
   *  snapshot, or fell back to ticker-prefix matching. */
  kalshiClimateDiagnostic?: ClimateSnapshotDiagnostic;
}

// ── Tunables (capped, conservative) ────────────────────────────────────────

/** Max items rendered in any section — keeps the brief scannable. */
const SECTION_CAP = 8;
/** Hours after which an un-published draft is "stale". */
const STALE_DRAFT_HOURS = 48;
/** Hours after which a `pending` QA record is "stuck". */
const STUCK_QA_HOURS = 72;
/** Window for "recently published". */
const RECENT_PUBLISH_WINDOW_HOURS = 48;
/** Window for "today's highlights" (saved-idea generation). */
const RECENT_HIGHLIGHT_WINDOW_HOURS = 24;
/** Cap on records pulled from each store — bounded I/O. */
const STORE_READ_CAP = 200;
/** Forecast-failure rate above which we emit an operational warning. */
const FORECAST_FAILURE_RATE_WARN = 0.25;
/** Insufficient-history-rate above which we suggest broader datasets. */
const INSUFFICIENT_HISTORY_RATE_WARN = 0.6;

const LINK = {
  ideas: '/admin/system/weather-market-ideas',
  divergence: '/admin/system/forecast-divergence',
  kalshiMarketData: '/admin/system/kalshi-market-data',
} as const;

/** Top-N Kalshi climate markets surfaced in the brief. Keeps the
 *  brief scannable rather than dumping every market in the snapshot. */
const KALSHI_CLIMATE_TOP_N = 6;

// ── Helpers ────────────────────────────────────────────────────────────────

function hoursBetween(a: number, b: number): number {
  return Math.abs(b - a) / (1000 * 60 * 60);
}

function fmtAgeHours(ms: number, now: number): string {
  const h = Math.floor(hoursBetween(ms, now));
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return '1d ago';
  return `${d}d ago`;
}

function safeParseTime(s: string | undefined): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

// ── Subsystem loaders (each wraps + degrades gracefully) ────────────────────

async function loadSavedIdeas(): Promise<{ rows: SavedWeatherMarketIdea[]; health: SubsystemHealth }> {
  try {
    const rows = await listSavedIdeas({ limit: STORE_READ_CAP });
    return { rows, health: 'ok' };
  } catch {
    return { rows: [], health: 'failed' };
  }
}

async function loadDrafts(): Promise<{ rows: DraftWager[]; health: SubsystemHealth }> {
  try {
    const rows = await listDraftWagers(STORE_READ_CAP);
    return { rows, health: 'ok' };
  } catch {
    return { rows: [], health: 'failed' };
  }
}

async function loadQA(): Promise<{ rows: MarketQA[]; health: SubsystemHealth }> {
  try {
    const rows = await listMarketQA({ limit: STORE_READ_CAP });
    return { rows, health: 'ok' };
  } catch {
    return { rows: [], health: 'failed' };
  }
}

async function loadFeedback(): Promise<{
  records: WeatherMarketIdeaFeedback[];
  summary: FeedbackSummary | null;
  health: SubsystemHealth;
}> {
  try {
    const records = await listFeedback({ limit: STORE_READ_CAP });
    let summary: FeedbackSummary | null = null;
    try {
      summary = summarizeFeedback(records);
    } catch {
      summary = null;
    }
    return { records, summary, health: 'ok' };
  } catch {
    return { records: [], summary: null, health: 'failed' };
  }
}

async function loadRiskUniverse(): Promise<{ universe: MarketRiskUniverse | null; health: SubsystemHealth }> {
  try {
    const universe = await fetchRiskUniverse({ maxPerSet: STORE_READ_CAP });
    return { universe, health: 'ok' };
  } catch {
    return { universe: null, health: 'failed' };
  }
}

async function loadAllWagers(): Promise<{ rows: any[]; health: SubsystemHealth }> {
  try {
    const rows = (await listAllWagers(STORE_READ_CAP)) as any[];
    return { rows: Array.isArray(rows) ? rows : [], health: 'ok' };
  } catch {
    return { rows: [], health: 'failed' };
  }
}

async function loadDivergenceWatch(
  now: number,
): Promise<{ entries: ForecastDivergenceWatchEntry[]; health: SubsystemHealth }> {
  try {
    const entries = await buildForecastDivergenceWatch({ now: new Date(now) });
    return { entries, health: 'ok' };
  } catch {
    return { entries: [], health: 'failed' };
  }
}

async function loadKalshiClimate(): Promise<{
  snapshot: KalshiMarketSnapshot | null;
  diagnostic: ClimateSnapshotDiagnostic | null;
  health: SubsystemHealth;
}> {
  try {
    const result = await getLatestClimateSnapshot(20, true);
    return { snapshot: result.snapshot, diagnostic: result.diagnostic, health: 'ok' };
  } catch {
    return { snapshot: null, diagnostic: null, health: 'failed' };
  }
}

// ── Section builders ───────────────────────────────────────────────────────

function buildGeneratedHighlights(
  saved: SavedWeatherMarketIdea[],
  now: number,
): BriefItem[] {
  const cutoff = now - RECENT_HIGHLIGHT_WINDOW_HOURS * 3600 * 1000;
  const recent = saved.filter((s) => {
    const t = safeParseTime(s.createdAt);
    return t !== null && t >= cutoff && s.status !== 'rejected';
  });
  // Rank by Step 156 score when present; fall back to createdAt desc.
  recent.sort((a, b) => {
    const sa = a.idea.outcomeInterestingness?.score ?? -1;
    const sb = b.idea.outcomeInterestingness?.score ?? -1;
    if (sb !== sa) return sb - sa;
    return (safeParseTime(b.createdAt) ?? 0) - (safeParseTime(a.createdAt) ?? 0);
  });
  return recent.slice(0, SECTION_CAP).map((s) => {
    const score = s.idea.outcomeInterestingness?.score;
    const label = s.idea.outcomeInterestingness?.label;
    const tone: BriefItemTone =
      label === 'high_interest' ? 'positive' : label === 'promising' ? 'positive' : 'info';
    const t = safeParseTime(s.createdAt);
    const ago = t !== null ? fmtAgeHours(t, now) : undefined;
    const subtitleParts: string[] = [];
    if (ago) subtitleParts.push(`saved ${ago}`);
    if (typeof score === 'number') subtitleParts.push(`interestingness ${score}/100`);
    if (label) subtitleParts.push(label.replace(/_/g, ' '));
    return {
      id: `gh-${s.id}`,
      title: s.idea.title,
      subtitle: subtitleParts.join(' · '),
      link: LINK.ideas,
      tone,
      meta: {
        status: s.status,
        targetDate: s.idea.targetDate,
      },
    };
  });
}

function buildInterestingMarkets(saved: SavedWeatherMarketIdea[]): BriefItem[] {
  const candidates = saved.filter((s) => {
    if (s.status === 'rejected') return false;
    const label = s.idea.outcomeInterestingness?.label;
    return label === 'high_interest' || label === 'promising';
  });
  candidates.sort(
    (a, b) =>
      (b.idea.outcomeInterestingness?.score ?? 0) -
      (a.idea.outcomeInterestingness?.score ?? 0),
  );
  return candidates.slice(0, SECTION_CAP).map((s) => {
    const score = s.idea.outcomeInterestingness?.score ?? 0;
    const label = s.idea.outcomeInterestingness?.label ?? 'neutral';
    const sample = s.idea.outcomeInterestingness?.sampleCount ?? 0;
    return {
      id: `im-${s.id}`,
      title: s.idea.title,
      subtitle: `${label.replace(/_/g, ' ')} · ${score}/100 · n=${sample}`,
      link: LINK.ideas,
      tone: label === 'high_interest' ? 'positive' : 'info',
      meta: { status: s.status, targetDate: s.idea.targetDate },
    };
  });
}

function buildRiskAlerts(
  saved: SavedWeatherMarketIdea[],
  drafts: DraftWager[],
  qa: MarketQA[],
  wagers: any[],
  universe: MarketRiskUniverse | null,
): { items: BriefItem[]; highSeverityCount: number } {
  if (!universe) return { items: [], highSeverityCount: 0 };

  interface CandidateRow {
    id: string;
    title: string;
    source: 'idea' | 'draft' | 'wager' | 'qa';
    link: string;
    warnings: WeatherMarketRiskWarning[];
  }

  const rows: CandidateRow[] = [];

  for (const s of saved) {
    if (s.status === 'rejected') continue;
    const norm = normalizeIdea(s);
    const warnings = analyzeRisk(norm, universe);
    if (warnings.some((w) => w.severity === 'high')) {
      rows.push({
        id: `risk-idea-${s.id}`,
        title: s.idea.title,
        source: 'idea',
        link: LINK.ideas,
        warnings,
      });
    }
  }
  for (const d of drafts) {
    if (d.status === 'published') continue;
    const norm = normalizeDraft(d);
    const warnings = analyzeRisk(norm, universe);
    if (warnings.some((w) => w.severity === 'high')) {
      rows.push({
        id: `risk-draft-${d.id}`,
        title: d.summary.title,
        source: 'draft',
        link: LINK.ideas,
        warnings,
      });
    }
  }
  // QA only matters if its wager carries high warnings.
  const wagerById = new Map<string, any>();
  for (const w of wagers) {
    if (w && typeof w === 'object' && typeof w.id === 'string') wagerById.set(w.id, w);
  }
  for (const q of qa) {
    if (q.status === 'rejected') continue;
    const w = wagerById.get(q.wagerId);
    if (!w) continue;
    const norm = normalizeWager(w);
    if (!norm) continue;
    const warnings = analyzeRisk(norm, universe);
    if (warnings.some((w) => w.severity === 'high')) {
      rows.push({
        id: `risk-qa-${q.id}`,
        title: q.snapshot.title,
        source: 'qa',
        link: LINK.ideas,
        warnings,
      });
    }
  }

  // Sort: most high-severity warnings first.
  rows.sort((a, b) => {
    const ha = a.warnings.filter((w) => w.severity === 'high').length;
    const hb = b.warnings.filter((w) => w.severity === 'high').length;
    return hb - ha;
  });

  let totalHighSeverity = 0;
  for (const r of rows) {
    totalHighSeverity += r.warnings.filter((w) => w.severity === 'high').length;
  }

  const items: BriefItem[] = rows.slice(0, SECTION_CAP).map((r) => {
    const highs = r.warnings.filter((w) => w.severity === 'high');
    const types = Array.from(new Set(highs.map((w) => w.type))).slice(0, 3).join(', ');
    return {
      id: r.id,
      title: r.title,
      subtitle: `${highs.length} high-severity warning(s) · ${r.source} · ${types}`,
      link: r.link,
      tone: 'high',
      meta: { source: r.source },
    };
  });

  return { items, highSeverityCount: totalHighSeverity };
}

function buildQAPending(qa: MarketQA[], now: number): { items: BriefItem[]; pending: number; needsChanges: number } {
  const pending = qa.filter((q) => q.status === 'pending');
  const needsChanges = qa.filter((q) => q.status === 'needs_changes');
  const candidates = [...pending, ...needsChanges];
  // Sort: needs_changes first (more urgent), then oldest pending.
  candidates.sort((a, b) => {
    if (a.status !== b.status) {
      if (a.status === 'needs_changes') return -1;
      if (b.status === 'needs_changes') return 1;
    }
    return (safeParseTime(a.createdAt) ?? 0) - (safeParseTime(b.createdAt) ?? 0);
  });
  const items: BriefItem[] = candidates.slice(0, SECTION_CAP).map((q) => {
    const t = safeParseTime(q.createdAt);
    const ageH = t !== null ? hoursBetween(t, now) : null;
    const ageLabel = t !== null ? fmtAgeHours(t, now) : 'unknown';
    const stuck = ageH !== null && ageH >= STUCK_QA_HOURS && q.status === 'pending';
    const tone: BriefItemTone =
      q.status === 'needs_changes' ? 'high' : stuck ? 'warning' : 'info';
    return {
      id: `qa-${q.id}`,
      title: q.snapshot.title,
      subtitle: `${q.status.replace(/_/g, ' ')} · ${ageLabel}${stuck ? ' · stuck' : ''}`,
      link: LINK.ideas,
      tone,
      meta: { wagerId: q.wagerId, status: q.status, targetDate: q.snapshot.targetDate },
    };
  });
  return { items, pending: pending.length, needsChanges: needsChanges.length };
}

function buildStaleDrafts(drafts: DraftWager[], now: number): BriefItem[] {
  const cutoff = now - STALE_DRAFT_HOURS * 3600 * 1000;
  const stale = drafts.filter((d) => {
    if (d.status === 'published') return false;
    const t = safeParseTime(d.updatedAt) ?? safeParseTime(d.createdAt);
    return t !== null && t <= cutoff;
  });
  stale.sort((a, b) => {
    const ta = safeParseTime(a.updatedAt) ?? safeParseTime(a.createdAt) ?? 0;
    const tb = safeParseTime(b.updatedAt) ?? safeParseTime(b.createdAt) ?? 0;
    return ta - tb; // oldest first
  });
  return stale.slice(0, SECTION_CAP).map((d) => {
    const t = safeParseTime(d.updatedAt) ?? safeParseTime(d.createdAt);
    const ago = t !== null ? fmtAgeHours(t, now) : 'unknown';
    return {
      id: `stale-${d.id}`,
      title: d.summary.title,
      subtitle: `unpublished · last updated ${ago}`,
      link: LINK.ideas,
      tone: 'warning',
      meta: { targetDate: d.summary.targetDate },
    };
  });
}

function buildRecentlyPublished(drafts: DraftWager[], now: number): BriefItem[] {
  const cutoff = now - RECENT_PUBLISH_WINDOW_HOURS * 3600 * 1000;
  const recent = drafts.filter((d) => {
    if (d.status !== 'published') return false;
    const t = safeParseTime(d.publishedAt);
    return t !== null && t >= cutoff;
  });
  recent.sort(
    (a, b) => (safeParseTime(b.publishedAt) ?? 0) - (safeParseTime(a.publishedAt) ?? 0),
  );
  return recent.slice(0, SECTION_CAP).map((d) => {
    const t = safeParseTime(d.publishedAt);
    const ago = t !== null ? fmtAgeHours(t, now) : 'unknown';
    return {
      id: `pub-${d.id}`,
      title: d.summary.title,
      subtitle: `published ${ago}`,
      link: d.publishedWagerId ? `/wagers/${d.publishedWagerId}` : LINK.ideas,
      tone: 'positive',
      meta: { targetDate: d.summary.targetDate, wagerId: d.publishedWagerId ?? '' },
    };
  });
}

function buildFeedbackSignals(summary: FeedbackSummary | null): BriefItem[] {
  if (!summary) return [];
  return summary.byPreset.slice(0, SECTION_CAP).map((g) => {
    const rate = g.usefulRate === null ? 'n/a' : `${Math.round(g.usefulRate * 100)}%`;
    const tone: BriefItemTone =
      g.usefulRate !== null && g.usefulRate >= 0.6
        ? 'positive'
        : g.usefulRate !== null && g.usefulRate <= 0.35
          ? 'warning'
          : 'info';
    return {
      id: `fb-${g.key}`,
      title: `Preset "${g.key}"`,
      subtitle: `${rate} useful · n=${g.totalCount} · ${g.tuningNote}`,
      link: LINK.ideas,
      tone,
    };
  });
}

function buildTuningSignals(summary: FeedbackSummary | null): BriefItem[] {
  if (!summary) return [];
  return summary.topLevelNotes.slice(0, SECTION_CAP).map((note, i) => ({
    id: `tune-${i}`,
    title: note,
    link: LINK.ideas,
    tone: 'info' as BriefItemTone,
  }));
}

const METRIC_LABEL_FOR_BRIEF: Record<string, string> = {
  high_temp: 'high temp',
  low_temp: 'low temp',
  precipitation_probability: 'precip prob',
  wind_speed: 'wind',
};

const METRIC_UNIT_FOR_BRIEF: Record<string, string> = {
  high_temp: '°F',
  low_temp: '°F',
  precipitation_probability: 'pp',
  wind_speed: 'mph',
};

/**
 * Step 166 — map watch entries into the brief's standard `BriefItem`
 * shape so the existing UI renderer can lay them out without a new
 * presentational component.
 *
 * Step 169 — when a trend analysis is attached, append a compact trend
 * tag to the subtitle ("trend: worsening Δ+12") and include the trend
 * label in the meta so the digest plaintext can render it inline.
 */
function buildForecastDivergenceSection(
  entries: ForecastDivergenceWatchEntry[],
): BriefItem[] {
  return entries.slice(0, SECTION_CAP).map((e) => {
    const r = e.result;
    const metricLabel = METRIC_LABEL_FOR_BRIEF[r.metric] ?? r.metric;
    const unit = METRIC_UNIT_FOR_BRIEF[r.metric] ?? '';
    const subtitleParts: string[] = [
      `${r.stabilityLabel.replace(/_/g, ' ')}`,
      `div ${r.divergenceScore}/100`,
      `vol ${r.volatilityScore}/100`,
      `settlement ${r.settlementRisk}`,
      `opportunity ${r.opportunitySignal}`,
    ];
    if (e.trend && e.trend.trendLabel !== 'insufficient_history') {
      const sign = e.trend.trendScoreDelta > 0 ? '+' : '';
      subtitleParts.push(
        `trend: ${e.trend.trendLabel.replace(/_/g, ' ')} Δ${sign}${e.trend.trendScoreDelta}`,
      );
    }
    const tone: BriefItemTone =
      r.opportunitySignal === 'high'
        ? 'positive'
        : r.stabilityLabel === 'highly_unstable' || e.trend?.trendLabel === 'worsening'
          ? 'high'
          : r.stabilityLabel === 'unstable'
            ? 'warning'
            : 'info';
    const meta: Record<string, string> = {
      spread: `${r.spread}${unit}`,
      maxRevision: `${r.revisionMagnitude}${unit}`,
      snapshots: `${r.comparedForecasts}`,
      side: e.side,
    };
    if (e.trend) {
      meta.trend = e.trend.trendLabel;
    }
    return {
      id: e.id,
      title: `${e.cityName} · ${metricLabel} · ${e.targetDate}`,
      subtitle: subtitleParts.join(' · '),
      link: LINK.divergence,
      tone,
      meta,
    };
  });
}

// ── Kalshi climate section ────────────────────────────────────────────────

/** Per-city counts derived from KXHIGH{CITY} / KXLOW{CITY} ticker
 *  prefixes. Pure: takes a list of market summaries and returns
 *  `[{ city: 'DEN', count: 6 }, …]` sorted by count desc. */
export function buildKalshiClimateCityCounts(
  markets: KalshiMarketSummary[],
): Array<{ city: string; count: number }> {
  const counts = new Map<string, number>();
  for (const m of markets) {
    if (typeof m.ticker !== 'string') continue;
    const city = extractCityFromWeatherTicker(m.ticker);
    if (!city) continue;
    counts.set(city, (counts.get(city) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([city, count]) => ({ city, count }))
    .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city));
}

function extractCityFromWeatherTicker(ticker: string): string | null {
  const t = ticker.toUpperCase();
  if (t.startsWith('KXHIGH')) return t.slice('KXHIGH'.length).split('-')[0] || null;
  if (t.startsWith('KXLOW')) return t.slice('KXLOW'.length).split('-')[0] || null;
  return null;
}

function buildKalshiClimateSection(
  snapshot: KalshiMarketSnapshot | null,
): BriefItem[] {
  if (!snapshot || snapshot.markets.length === 0) return [];
  // Priority order for the brief's top 6:
  //   1. Markets with active bid/ask quotes (skip "—" rows).
  //   2. Temperature markets (KXHIGH/KXLOW) — the operator's primary
  //      interest. Rain / hurricane / earthquake markets often have
  //      higher dollar volume than temperature markets and were
  //      crowding the top of the brief otherwise.
  //   3. Volume desc.
  //   4. Ticker asc.
  //
  // The full snapshot still contains every climate market regardless
  // of prefix — operators see them all on the Kalshi Market Data page.
  // This re-sort just changes which 6 surface in the brief.
  const isTemperature = (m: KalshiMarketSummary): boolean => {
    if (typeof m.ticker !== 'string') return false;
    return m.ticker.startsWith('KXHIGH') || m.ticker.startsWith('KXLOW');
  };
  const ranked = snapshot.markets
    .slice()
    .sort((a, b) => {
      const aQuoted = a.yesAsk != null || a.noAsk != null ? 1 : 0;
      const bQuoted = b.yesAsk != null || b.noAsk != null ? 1 : 0;
      if (aQuoted !== bQuoted) return bQuoted - aQuoted;
      const aTemp = isTemperature(a) ? 1 : 0;
      const bTemp = isTemperature(b) ? 1 : 0;
      if (aTemp !== bTemp) return bTemp - aTemp;
      const av = a.volume ?? 0;
      const bv = b.volume ?? 0;
      if (bv !== av) return bv - av;
      return (a.ticker ?? '').localeCompare(b.ticker ?? '');
    });
  const top = ranked.slice(0, KALSHI_CLIMATE_TOP_N);
  const ageSeconds = snapshot.createdAt
    ? Math.max(0, Math.round((Date.now() - Date.parse(snapshot.createdAt)) / 1000))
    : null;
  return top.map((m) => {
    const yesAmerican = formatCentsAsAmericanOdds(m.yesAsk);
    const noAmerican = formatCentsAsAmericanOdds(m.noAsk);
    const meta: Record<string, string> = {
      ticker: m.ticker,
      env: snapshot.kalshiEnv,
      yes: yesAmerican,
      no: noAmerican,
    };
    if (typeof m.volume === 'number') meta.volume = String(m.volume);
    if (m.closeTime) meta.closes = m.closeTime.slice(0, 10);
    const subtitleParts: string[] = [];
    if (m.title) subtitleParts.push(m.title);
    // Sportsbook-style odds right in the subtitle so operators can scan
    // the brief without expanding each item.
    if (yesAmerican !== '—' || noAmerican !== '—') {
      subtitleParts.push(`Yes ${yesAmerican} · No ${noAmerican}`);
    }
    if (ageSeconds !== null) {
      const ageH = Math.floor(ageSeconds / 3600);
      subtitleParts.push(`snapshot ${ageH < 1 ? `${Math.floor(ageSeconds / 60)}m` : `${ageH}h`} old`);
    }
    return {
      id: `kalshi-${m.ticker}`,
      title: m.ticker,
      subtitle: subtitleParts.join(' · '),
      link: LINK.kalshiMarketData,
      tone: 'info' as BriefItemTone,
      meta,
    };
  });
}

function buildOperationalWarnings(
  saved: SavedWeatherMarketIdea[],
  drafts: DraftWager[],
  qa: MarketQA[],
  failedSubsystems: string[],
): string[] {
  const out: string[] = [];

  if (failedSubsystems.length > 0) {
    out.push(
      `One or more subsystems failed to load: ${failedSubsystems.join(', ')}. The brief is partial.`,
    );
  }

  // Insufficient-history rate across recent saved ideas.
  const withInterestingness = saved.filter((s) => s.idea.outcomeInterestingness !== undefined);
  if (withInterestingness.length >= 5) {
    const insufficient = withInterestingness.filter(
      (s) => s.idea.outcomeInterestingness?.label === 'insufficient_history',
    ).length;
    const rate = insufficient / withInterestingness.length;
    if (rate >= INSUFFICIENT_HISTORY_RATE_WARN) {
      out.push(
        `${Math.round(rate * 100)}% of recently saved ideas had insufficient historical data — consider broader city sets or longer time horizons.`,
      );
    }
  }

  // Forecast-failure heuristic from saved-idea warnings.
  let beyondHorizonCount = 0;
  for (const s of saved) {
    for (const w of s.idea.warnings ?? []) {
      if (/beyond.*horizon/i.test(w)) {
        beyondHorizonCount += 1;
        break;
      }
    }
  }
  if (saved.length >= 5 && beyondHorizonCount / saved.length >= FORECAST_FAILURE_RATE_WARN) {
    out.push(
      `${beyondHorizonCount} of ${saved.length} saved ideas are beyond the reliable forecast horizon — confidence labels will be lower.`,
    );
  }

  // Stuck QA backlog.
  const stuckCount = qa.filter(
    (q) => q.status === 'pending' && (Date.now() - (safeParseTime(q.createdAt) ?? Date.now())) / 3600000 >= STUCK_QA_HOURS,
  ).length;
  if (stuckCount > 0) {
    out.push(`${stuckCount} QA record(s) have been pending for more than ${STUCK_QA_HOURS}h.`);
  }

  // Stale drafts.
  const staleCount = drafts.filter((d) => {
    if (d.status === 'published') return false;
    const t = safeParseTime(d.updatedAt) ?? safeParseTime(d.createdAt);
    return t !== null && Date.now() - t >= STALE_DRAFT_HOURS * 3600 * 1000;
  }).length;
  if (staleCount >= 3) {
    out.push(`${staleCount} draft wager(s) older than ${STALE_DRAFT_HOURS}h — review or delete.`);
  }

  return out;
}

function buildSummaryHeadline(opts: {
  highHighlights: number;
  draftsPending: number;
  highSeverity: number;
  qaPending: number;
  failedSubsystems: number;
}): string {
  const parts: string[] = [];
  if (opts.highHighlights > 0) {
    parts.push(`${opts.highHighlights} high-interest idea(s) saved today`);
  }
  if (opts.draftsPending > 0) {
    parts.push(`${opts.draftsPending} draft wager(s) awaiting action`);
  }
  if (opts.qaPending > 0) {
    parts.push(`${opts.qaPending} market(s) in QA`);
  }
  if (opts.highSeverity > 0) {
    parts.push(`${opts.highSeverity} high-severity risk warning(s)`);
  }
  if (parts.length === 0) {
    return 'Quiet day — no high-interest ideas, drafts, QA, or risk alerts surfacing right now.';
  }
  const tail = opts.failedSubsystems > 0 ? ' (some subsystems failed to load)' : '';
  return parts.join('; ') + '.' + tail;
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface BuildDailyBriefOptions {
  /** Inject "now" for tests. Defaults to Date.now(). */
  now?: Date;
}

/**
 * Pure-ish aggregator. Returns a complete `WeatherMarketDailyBrief`
 * even when individual subsystems fail — failed subsystems show up in
 * `subsystemStatus` and the affected sections come back empty.
 */
export async function buildDailyBrief(
  options: BuildDailyBriefOptions = {},
): Promise<WeatherMarketDailyBrief> {
  const nowDate = options.now ?? new Date();
  const now = nowDate.getTime();

  // Parallel load — every loader catches its own failure.
  const [savedRes, draftsRes, qaRes, feedbackRes, universeRes, wagersRes, divergenceRes, kalshiClimateRes] =
    await Promise.all([
      loadSavedIdeas(),
      loadDrafts(),
      loadQA(),
      loadFeedback(),
      loadRiskUniverse(),
      loadAllWagers(),
      loadDivergenceWatch(now),
      loadKalshiClimate(),
    ]);

  const subsystemStatus: Record<string, SubsystemHealth> = {
    savedIdeas: savedRes.health,
    drafts: draftsRes.health,
    qa: qaRes.health,
    feedback: feedbackRes.health,
    riskUniverse: universeRes.health,
    wagers: wagersRes.health,
    divergenceWatch: divergenceRes.health,
    kalshiClimate: kalshiClimateRes.health,
  };

  const failedSubsystems = Object.entries(subsystemStatus)
    .filter(([, h]) => h === 'failed')
    .map(([k]) => k);

  const generatedHighlights = buildGeneratedHighlights(savedRes.rows, now);
  const interestingMarkets = buildInterestingMarkets(savedRes.rows);
  const risk = buildRiskAlerts(
    savedRes.rows,
    draftsRes.rows,
    qaRes.rows,
    wagersRes.rows,
    universeRes.universe,
  );
  const qaPending = buildQAPending(qaRes.rows, now);
  const staleDrafts = buildStaleDrafts(draftsRes.rows, now);
  const recentlyPublished = buildRecentlyPublished(draftsRes.rows, now);
  const feedbackSignals = buildFeedbackSignals(feedbackRes.summary);
  const tuningSignals = buildTuningSignals(feedbackRes.summary);
  const forecastDivergenceWatch = buildForecastDivergenceSection(divergenceRes.entries);
  const kalshiClimateMarkets = buildKalshiClimateSection(kalshiClimateRes.snapshot);
  const kalshiClimateCityCounts = kalshiClimateRes.snapshot
    ? buildKalshiClimateCityCounts(kalshiClimateRes.snapshot.markets)
    : [];
  const operationalWarnings = buildOperationalWarnings(
    savedRes.rows,
    draftsRes.rows,
    qaRes.rows,
    failedSubsystems,
  );

  const counts = {
    savedIdeasActive: savedRes.rows.filter((s) => s.status !== 'rejected').length,
    draftsActive: draftsRes.rows.filter((d) => d.status === 'draft').length,
    qaPending: qaPending.pending,
    qaNeedsChanges: qaPending.needsChanges,
    highSeverityWarnings: risk.highSeverityCount,
    recentlyPublished: recentlyPublished.length,
    divergenceWatch: divergenceRes.entries.length,
    kalshiClimateMarkets: kalshiClimateRes.snapshot?.markets.length ?? 0,
    kalshiClimateCities: kalshiClimateCityCounts.length,
  };

  const kalshiClimateSnapshotMeta = kalshiClimateRes.snapshot
    ? {
        id: kalshiClimateRes.snapshot.id,
        createdAt: kalshiClimateRes.snapshot.createdAt,
        env: kalshiClimateRes.snapshot.kalshiEnv,
        marketCount: kalshiClimateRes.snapshot.markets.length,
        cityCount: kalshiClimateCityCounts.length,
      }
    : undefined;

  const summaryHeadline = buildSummaryHeadline({
    highHighlights: generatedHighlights.filter(
      (h) => h.tone === 'positive',
    ).length,
    draftsPending: counts.draftsActive,
    highSeverity: counts.highSeverityWarnings,
    qaPending: counts.qaPending + counts.qaNeedsChanges,
    failedSubsystems: failedSubsystems.length,
  });

  return {
    generatedAt: nowDate.toISOString(),
    summaryHeadline,
    generatedHighlights,
    interestingMarkets,
    riskAlerts: risk.items,
    qaPending: qaPending.items,
    staleDrafts,
    recentlyPublished,
    feedbackSignals,
    tuningSignals,
    forecastDivergenceWatch,
    kalshiClimateMarkets,
    operationalWarnings,
    subsystemStatus,
    counts,
    kalshiClimateSnapshot: kalshiClimateSnapshotMeta,
    kalshiClimateDiagnostic: kalshiClimateRes.diagnostic ?? undefined,
  };
}

// ── Step 113: Public Wager View (transparency layer) ───────────────────────
//
// Strips admin-only / pricing / line-history / internal-naming fields from
// the underlying Wager so that public, user-facing pages only ever see a
// sanitized, read-only summary. There is no mutation surface here. Public
// components MUST go through this lib (or the existing public /api/wagers
// route) — never through admin endpoints.

import { getWager, listWagers } from './wager-store';
import type { Wager, WagerKind, WagerStatus, WagerMetric } from './wager-types';

// ── Types ────────────────────────────────────────────────────────────────────

export interface PublicOutcome {
  label: string;
  /** American odds, e.g. +135 / -110. Undefined for sides that don't have odds (rare). */
  displayedOdds?: number;
  /** True if this is the resolved winning outcome on a graded market. */
  isWinner?: boolean;
}

export interface PublicWagerView {
  id: string;
  ticketNumber: string;
  title: string;
  description?: string;
  kind: WagerKind;
  status: WagerStatus;
  metric: WagerMetric;
  targetDate: string;
  targetTime?: string;
  lockTime: string;
  /** Human-readable location summary, e.g. "Columbia, SC (KCAE)" or "A: ... vs B: ...". */
  locationSummary: string;
  /** One-sentence summary of the market terms. */
  termsSummary: string;
  /** Per-outcome cards. */
  outcomes: PublicOutcome[];
  /** Compact label for the displayed odds row, e.g. "+135 / -120 / +260". */
  displayedOdds: string;
  /** Plain-language explanation of how the market resolves. */
  resolutionRules: string;
  /** Plain-language explanation of which weather metric is used and where. */
  weatherDataExplanation: string;
  /** Step 116: short, bulleted-style rules-card content. Public-safe. */
  winConditionSummary: string;
  tieOrPushSummary: string;
  lockSummary: string;
  resolutionSourceSummary: string;
  /** Single-line responsible-play reminder. */
  responsiblePlayNote: string;
  /** Last update time from the wager record. */
  lastUpdatedAt: string;
  /** Step 115: market creation time. Public-safe. */
  createdAt: string;
  /** Step 115: terminal-status timestamps derived from updatedAt only when
      status is graded/void. Approximates resolution/cancellation wall-clock
      time without requiring a Wager schema change. Undefined otherwise. */
  resolvedAt?: string;
  voidedAt?: string;
  /** Outcome label that won, if graded. */
  winningOutcome?: string;
  /** User-safe observed weather value (for graded). */
  observedValue?: number;
  /** Pointspread-only: observed values per location, when graded. */
  observedValueA?: number;
  observedValueB?: number;
  // Step 114C: voidReason is intentionally NOT exposed publicly. The raw
  // reason is operator-authored free text and may include ticket numbers,
  // names, or internal references. Public surfaces show only a generic
  // "This market was cancelled before resolution." message; admin views
  // continue to read voidReason directly from the underlying Wager record.
}

// ── Field stripping (single source of truth for what's NOT public) ──────────

const ADMIN_ONLY_FIELDS = [
  'pricingSnapshot',
  'internalName',
  'lineHistory',
  'openingLineSnapshot',
  'closingLineSnapshot',
] as const;

// ── Helpers ─────────────────────────────────────────────────────────────────

const METRIC_LABEL: Record<WagerMetric, string> = {
  actual_temp: 'observed temperature',
  high_temp: 'daily high temperature',
  low_temp: 'daily low temperature',
  actual_wind: 'observed wind speed',
  actual_gust: 'observed wind gust',
};

const METRIC_UNIT: Record<WagerMetric, string> = {
  actual_temp: '°F',
  high_temp: '°F',
  low_temp: '°F',
  actual_wind: 'mph',
  actual_gust: 'mph',
};

function describeLocation(loc: { name: string; stationId?: string } | undefined): string {
  if (!loc) return 'Unknown location';
  return loc.stationId ? `${loc.name} (station ${loc.stationId})` : loc.name;
}

function locationSummary(w: Wager): string {
  if (w.kind === 'odds' || w.kind === 'over-under') {
    return describeLocation(w.location);
  }
  if (w.kind === 'pointspread') {
    return `A: ${describeLocation(w.locationA)} vs B: ${describeLocation(w.locationB)}`;
  }
  return 'Unknown location';
}

function termsSummary(w: Wager): string {
  const metric = METRIC_LABEL[w.metric] ?? String(w.metric);
  const unit = METRIC_UNIT[w.metric] ?? '';
  if (w.kind === 'over-under') {
    const ouw = w as any;
    return `Will the ${metric} at ${describeLocation(ouw.location)} on ${w.targetDate} be over or under ${ouw.line}${unit}?`;
  }
  if (w.kind === 'pointspread') {
    const psw = w as any;
    return `Difference in ${metric} between A and B on ${w.targetDate}, against a spread of ${psw.spread}${unit}.`;
  }
  if (w.kind === 'odds') {
    return `Pick the range that contains the ${metric} at ${describeLocation((w as any).location)} on ${w.targetDate}.`;
  }
  return `Wager on ${metric} at ${w.targetDate}.`;
}

function resolutionRules(w: Wager): string {
  const metric = METRIC_LABEL[w.metric] ?? String(w.metric);
  const unit = METRIC_UNIT[w.metric] ?? '';
  const targetTime = w.targetTime ? ` at ${w.targetTime}` : '';
  if (w.kind === 'over-under') {
    const ouw = w as any;
    return `This market resolves to "over" if the ${metric} on ${w.targetDate}${targetTime} is greater than ${ouw.line}${unit}, and "under" if it is less than or equal to ${ouw.line}${unit}. The market locks at ${new Date(w.lockTime).toLocaleString()} and is graded once an authoritative observation is recorded for the target date.`;
  }
  if (w.kind === 'pointspread') {
    const psw = w as any;
    return `This market resolves on the difference (A − B) of the ${metric} on ${w.targetDate}${targetTime}, compared against a spread of ${psw.spread}${unit}. The market locks at ${new Date(w.lockTime).toLocaleString()} and is graded once authoritative observations are recorded for both locations.`;
  }
  if (w.kind === 'odds') {
    return `This market resolves to the outcome range that contains the observed ${metric} on ${w.targetDate}${targetTime}. The market locks at ${new Date(w.lockTime).toLocaleString()} and is graded once an authoritative observation is recorded for the target date.`;
  }
  return `Resolved using documented weather observations for ${w.targetDate}.`;
}

function winConditionSummary(w: Wager): string {
  const metric = METRIC_LABEL[w.metric] ?? String(w.metric);
  const unit = METRIC_UNIT[w.metric] ?? '';
  if (w.kind === 'over-under') {
    const ouw = w as any;
    return `Over wins if the observed ${metric} is greater than ${ouw.line}${unit}. Under wins if it is less than ${ouw.line}${unit}.`;
  }
  if (w.kind === 'pointspread') {
    const psw = w as any;
    return `The market resolves on the difference (Location A minus Location B) in ${metric} on ${w.targetDate}, compared to a spread of ${psw.spread}${unit}.`;
  }
  if (w.kind === 'odds') {
    return `The market resolves to whichever outcome range contains the observed ${metric} on ${w.targetDate}.`;
  }
  return `The market resolves based on the observed ${metric} on ${w.targetDate}.`;
}

function tieOrPushSummary(w: Wager): string {
  if (w.kind === 'odds') {
    return `Outcome ranges are inclusive of both endpoints. If the observed value falls outside every defined range, or matches more than one range, the market may be reviewed and cancelled per platform rules.`;
  }
  if (w.kind === 'over-under') {
    return `If the observed value exactly equals the line, the market may be reviewed and cancelled per platform rules.`;
  }
  if (w.kind === 'pointspread') {
    return `If the observed difference exactly equals the spread, the market may be reviewed and cancelled per platform rules.`;
  }
  return `If the observed result cannot determine a single winning outcome, the market may be reviewed and cancelled per platform rules.`;
}

function lockSummary(w: Wager): string {
  return `Wagering closes at ${new Date(w.lockTime).toLocaleString()}. After lock, no new participation is allowed and the market awaits authoritative weather observations.`;
}

function resolutionSourceSummary(w: Wager): string {
  const metric = METRIC_LABEL[w.metric] ?? String(w.metric);
  if (w.kind === 'pointspread') {
    const psw = w as any;
    return `Outcomes are determined from authoritative weather observations of ${metric} for ${describeLocation(psw.locationA)} and ${describeLocation(psw.locationB)} on ${w.targetDate}.`;
  }
  return `Outcomes are determined from authoritative weather observations of ${metric} for ${describeLocation((w as any).location)} on ${w.targetDate}.`;
}

function weatherDataExplanation(w: Wager): string {
  const metric = METRIC_LABEL[w.metric] ?? String(w.metric);
  if (w.kind === 'pointspread') {
    return `Outcomes are derived from authoritative weather observations for both locations on ${w.targetDate}. The platform uses the same metric (${metric}) at the recorded weather stations for each side. If the data is missing, delayed, or contested, the market may be void or its grading delayed pending review.`;
  }
  return `Outcomes are derived from authoritative weather observations for ${describeLocation((w as any).location)} on ${w.targetDate}. The metric used is the ${metric}. If the data is missing, delayed, or contested, the market may be void or its grading delayed pending review.`;
}

function buildOutcomes(w: Wager): { outcomes: PublicOutcome[]; displayedOdds: string } {
  const outcomes: PublicOutcome[] = [];
  if (w.kind === 'odds') {
    const ow = w as any;
    for (const o of (ow.outcomes ?? [])) {
      outcomes.push({
        label: o.label,
        displayedOdds: o.odds,
        isWinner: w.status === 'graded' && w.winningOutcome === o.label,
      });
    }
  } else if (w.kind === 'over-under') {
    const ouw = w as any;
    outcomes.push({ label: 'Over', displayedOdds: ouw.over?.odds, isWinner: w.status === 'graded' && w.winningOutcome === 'over' });
    outcomes.push({ label: 'Under', displayedOdds: ouw.under?.odds, isWinner: w.status === 'graded' && w.winningOutcome === 'under' });
  } else if (w.kind === 'pointspread') {
    const psw = w as any;
    outcomes.push({ label: `${describeLocation(psw.locationA)} (A)`, displayedOdds: psw.locationAOdds, isWinner: w.status === 'graded' && w.winningOutcome === 'locationA' });
    outcomes.push({ label: `${describeLocation(psw.locationB)} (B)`, displayedOdds: psw.locationBOdds, isWinner: w.status === 'graded' && w.winningOutcome === 'locationB' });
  }
  const displayedOdds = outcomes
    .map(o => (typeof o.displayedOdds === 'number' ? formatAmericanOdds(o.displayedOdds) : '—'))
    .join(' / ');
  return { outcomes, displayedOdds };
}

function formatAmericanOdds(odds: number): string {
  if (!Number.isFinite(odds)) return '—';
  if (odds > 0) return `+${odds}`;
  return String(odds);
}

const RESPONSIBLE_PLAY_NOTE =
  'Wagering on weather outcomes carries real risk. Wager only what you can afford to lose, set personal limits, and seek help at 1-800-GAMBLER if play is causing harm.';

// ── Public API ──────────────────────────────────────────────────────────────

export function toPublicWagerView(wager: Wager): PublicWagerView {
  // Defensively pick allow-listed fields only — never spread the underlying
  // record. This guarantees that none of the ADMIN_ONLY_FIELDS leak even
  // if upstream callers add new internal fields later.
  void ADMIN_ONLY_FIELDS; // referenced for documentation; stripping is by allow-list below.

  const { outcomes, displayedOdds } = buildOutcomes(wager);

  const view: PublicWagerView = {
    id: wager.id,
    ticketNumber: wager.ticketNumber,
    title: wager.title,
    description: wager.description,
    kind: wager.kind,
    status: wager.status,
    metric: wager.metric,
    targetDate: wager.targetDate,
    targetTime: wager.targetTime,
    lockTime: wager.lockTime,
    locationSummary: locationSummary(wager),
    termsSummary: termsSummary(wager),
    outcomes,
    displayedOdds,
    resolutionRules: resolutionRules(wager),
    weatherDataExplanation: weatherDataExplanation(wager),
    winConditionSummary: winConditionSummary(wager),
    tieOrPushSummary: tieOrPushSummary(wager),
    lockSummary: lockSummary(wager),
    resolutionSourceSummary: resolutionSourceSummary(wager),
    responsiblePlayNote: RESPONSIBLE_PLAY_NOTE,
    lastUpdatedAt: wager.updatedAt ?? wager.createdAt,
    createdAt: wager.createdAt,
    resolvedAt: wager.status === 'graded' ? (wager.updatedAt ?? wager.createdAt) : undefined,
    voidedAt: wager.status === 'void' ? (wager.updatedAt ?? wager.createdAt) : undefined,
    winningOutcome: wager.status === 'graded' ? wager.winningOutcome : undefined,
    observedValue: wager.status === 'graded' ? wager.observedValue : undefined,
  };
  if (wager.kind === 'pointspread') {
    const psw = wager as any;
    if (typeof psw.observedValueA === 'number') view.observedValueA = psw.observedValueA;
    if (typeof psw.observedValueB === 'number') view.observedValueB = psw.observedValueB;
  }
  // Step 114C: voidReason intentionally not copied — see PublicWagerView decl.
  return view;
}

export async function getPublicWager(id: string): Promise<PublicWagerView | null> {
  if (!id) return null;
  const wager = await getWager(id);
  if (!wager) return null;
  return toPublicWagerView(wager);
}

export interface PublicListOptions {
  status?: WagerStatus;
  limit?: number;
  cursor?: number;
}

export async function listPublicWagers(opts: PublicListOptions = {}): Promise<{ wagers: PublicWagerView[]; total: number }> {
  const { wagers, total } = await listWagers({
    status: opts.status,
    limit: Math.min(50, Math.max(1, opts.limit ?? 20)),
    cursor: opts.cursor ?? 0,
  });
  return { wagers: wagers.map(toPublicWagerView), total };
}

// ── Step 120 Part C: defensive allow-list serializer ────────────────────────
//
// Use this on every public-facing JSON response. Even if the caller
// accidentally hands us a raw Wager (or a PublicWagerView with an extra
// admin-shaped field merged in), this picks ONLY the canonical public
// fields. Never spread the input.

export const PUBLIC_WAGER_VIEW_KEYS = [
  'id',
  'ticketNumber',
  'title',
  'description',
  'kind',
  'status',
  'metric',
  'targetDate',
  'targetTime',
  'lockTime',
  'locationSummary',
  'termsSummary',
  'outcomes',
  'displayedOdds',
  'resolutionRules',
  'weatherDataExplanation',
  'winConditionSummary',
  'tieOrPushSummary',
  'lockSummary',
  'resolutionSourceSummary',
  'responsiblePlayNote',
  'lastUpdatedAt',
  'createdAt',
  'resolvedAt',
  'voidedAt',
  'winningOutcome',
  'observedValue',
  'observedValueA',
  'observedValueB',
] as const satisfies readonly (keyof PublicWagerView)[];

const PUBLIC_OUTCOME_KEYS = ['label', 'displayedOdds', 'isWinner'] as const;

function pickOutcome(o: any): PublicOutcome {
  const out: PublicOutcome = { label: typeof o?.label === 'string' ? o.label : '' };
  if (typeof o?.displayedOdds === 'number') out.displayedOdds = o.displayedOdds;
  if (typeof o?.isWinner === 'boolean') out.isWinner = o.isWinner;
  void PUBLIC_OUTCOME_KEYS;
  return out;
}

/**
 * Defensively pick only the canonical PublicWagerView fields. Drops any
 * stray admin-only field a caller may have merged in. Use this on every
 * public-facing JSON response.
 */
export function serializePublicWager(view: PublicWagerView): PublicWagerView {
  const out: PublicWagerView = {
    id: view.id,
    ticketNumber: view.ticketNumber,
    title: view.title,
    description: view.description,
    kind: view.kind,
    status: view.status,
    metric: view.metric,
    targetDate: view.targetDate,
    targetTime: view.targetTime,
    lockTime: view.lockTime,
    locationSummary: view.locationSummary,
    termsSummary: view.termsSummary,
    outcomes: Array.isArray(view.outcomes) ? view.outcomes.map(pickOutcome) : [],
    displayedOdds: view.displayedOdds,
    resolutionRules: view.resolutionRules,
    weatherDataExplanation: view.weatherDataExplanation,
    winConditionSummary: view.winConditionSummary,
    tieOrPushSummary: view.tieOrPushSummary,
    lockSummary: view.lockSummary,
    resolutionSourceSummary: view.resolutionSourceSummary,
    responsiblePlayNote: view.responsiblePlayNote,
    lastUpdatedAt: view.lastUpdatedAt,
    createdAt: view.createdAt,
  };
  if (view.resolvedAt) out.resolvedAt = view.resolvedAt;
  if (view.voidedAt) out.voidedAt = view.voidedAt;
  if (view.winningOutcome) out.winningOutcome = view.winningOutcome;
  if (typeof view.observedValue === 'number') out.observedValue = view.observedValue;
  if (typeof view.observedValueA === 'number') out.observedValueA = view.observedValueA;
  if (typeof view.observedValueB === 'number') out.observedValueB = view.observedValueB;
  return out;
}

export function serializePublicWagers(views: PublicWagerView[]): PublicWagerView[] {
  return views.map(serializePublicWager);
}

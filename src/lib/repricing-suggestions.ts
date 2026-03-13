import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';
import { listWagers, updateWager, getWager } from './wager-store';
import { getWagerExposure } from './exposure';
import type { Wager, WagerKind, LineHistoryEntry } from './wager-types';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export type SuggestionPriority = 'low' | 'medium' | 'high' | 'critical';

export interface RepricingSuggestion {
  wagerId: string;
  title: string;
  ticketNumber: string;
  marketType: WagerKind;
  current: CurrentMarket;
  suggested: SuggestedMarket;
  reason: string;
  priority: SuggestionPriority;
  factors: {
    modelDrift?: number;
    liability?: number;
    lopsidedPct?: number;
    moveCount?: number;
    staleHours?: number;
  };
  generatedAt: string;
}

export interface CurrentMarket {
  overUnder?: { line: number; overOdds: number; underOdds: number };
  pointspread?: { spread: number; locationAOdds: number; locationBOdds: number };
  rangeOdds?: { bands: { label: string; odds: number }[] };
}

export interface SuggestedMarket {
  overUnder?: { line: number; overOdds: number; underOdds: number };
  pointspread?: { spread: number; locationAOdds: number; locationBOdds: number };
  rangeOdds?: { bands: { label: string; odds: number }[] };
}

export interface AppliedChange {
  id: string;
  wagerId: string;
  title: string;
  marketType: WagerKind;
  before: CurrentMarket;
  after: SuggestedMarket;
  reason: string;
  appliedAt: string;
  appliedBy: 'admin';
  edited: boolean;
}

export interface RepricingOverview {
  totalSuggestions: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  avgModelDrift: number;
  totalAtRiskLiability: number;
}

/* ------------------------------------------------------------------ */
/*  Redis keys                                                          */
/* ------------------------------------------------------------------ */

const APPLIED_PREFIX = 'reprice:applied:';
const APPLIED_SET = 'reprice:applied:all';

/* ------------------------------------------------------------------ */
/*  Applied changes CRUD                                                */
/* ------------------------------------------------------------------ */

async function saveAppliedChange(change: AppliedChange): Promise<void> {
  const redis = getRedis();
  await redis.set(`${APPLIED_PREFIX}${change.id}`, JSON.stringify(change));
  await redis.zadd(APPLIED_SET, { score: Date.now(), member: change.id });
}

export async function listAppliedChanges(limit = 50): Promise<AppliedChange[]> {
  const redis = getRedis();
  const ids = await redis.zrange(APPLIED_SET, 0, limit - 1, { rev: true });
  if (!ids || ids.length === 0) return [];
  const changes: AppliedChange[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${APPLIED_PREFIX}${id}`);
    if (raw) changes.push(typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as AppliedChange);
  }
  return changes;
}

/* ------------------------------------------------------------------ */
/*  Suggestion generation helpers                                       */
/* ------------------------------------------------------------------ */

function getModelDrift(wager: Wager): number {
  const snap = (wager as any).pricingSnapshot;
  if (!snap) return 0;

  if (wager.kind === 'over-under' && snap.overUnder) {
    const posted = (wager as any).line ?? 0;
    const model = snap.overUnder.suggestedLine ?? snap.overUnder.fairLine ?? posted;
    return Math.abs(posted - model);
  }
  if (wager.kind === 'pointspread' && snap.pointspread) {
    const posted = (wager as any).spread ?? 0;
    const model = snap.pointspread.suggestedSpread ?? posted;
    return Math.abs(posted - model);
  }
  return 0;
}

function getLopsidedPct(byOutcome: Record<string, { stakedCents: number }>): number {
  const totals = Object.values(byOutcome).map(o => o.stakedCents);
  const total = totals.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  const max = Math.max(...totals);
  return max / total;
}

function getStaleHours(wager: Wager): number {
  const history = (wager as any).lineHistory as LineHistoryEntry[] | undefined;
  const lastChange = history?.length ? history[history.length - 1].changedAt : (wager as any).createdAt;
  if (!lastChange) return 0;
  return (Date.now() - new Date(lastChange).getTime()) / (1000 * 60 * 60);
}

function scorePriority(drift: number, liability: number, lopsided: number, staleHours: number, moveCount: number): SuggestionPriority {
  let score = 0;
  if (liability >= 100000) score += 4; else if (liability >= 50000) score += 3; else if (liability >= 20000) score += 2; else if (liability >= 5000) score += 1;
  if (drift >= 4) score += 4; else if (drift >= 2.5) score += 3; else if (drift >= 1) score += 2; else if (drift >= 0.5) score += 1;
  if (lopsided >= 0.85) score += 3; else if (lopsided >= 0.75) score += 2; else if (lopsided >= 0.65) score += 1;
  if (staleHours >= 12) score += 2; else if (staleHours >= 6) score += 1;
  if (moveCount >= 3) score -= 1; // Already moved a lot, reduce aggressiveness

  if (score >= 8) return 'critical';
  if (score >= 5) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}

function buildReason(drift: number, liability: number, lopsided: number, staleHours: number): string {
  const reasons: string[] = [];
  if (drift >= 1) reasons.push(`model drift ${drift.toFixed(1)}`);
  if (liability >= 20000) reasons.push(`liability $${(liability / 100).toFixed(0)}`);
  if (lopsided >= 0.65) reasons.push(`${(lopsided * 100).toFixed(0)}% lopsided action`);
  if (staleHours >= 6) reasons.push(`stale ${staleHours.toFixed(0)}h`);
  if (reasons.length === 0) reasons.push('routine refresh');
  return reasons.join(', ');
}

/* ------------------------------------------------------------------ */
/*  Suggest O/U changes                                                 */
/* ------------------------------------------------------------------ */

function suggestOverUnder(
  wager: any,
  drift: number,
  lopsided: number,
  liability: number,
  moveCount: number,
): SuggestedMarket {
  const snap = wager.pricingSnapshot?.overUnder;
  const currentLine = wager.line ?? 0;
  const currentOver = wager.overOdds ?? -110;
  const currentUnder = wager.underOdds ?? -110;

  // Start from model suggestion if available, else current
  let newLine = snap?.suggestedLine ?? currentLine;
  let newOver = snap?.suggestedOverOdds ?? currentOver;
  let newUnder = snap?.suggestedUnderOdds ?? currentUnder;

  // Dampen if many moves already
  const dampen = moveCount >= 3 ? 0.5 : moveCount >= 2 ? 0.75 : 1.0;

  // Blend toward model line
  if (drift >= 0.5) {
    const move = (newLine - currentLine) * dampen;
    newLine = currentLine + move;
    // Round to nearest 0.5
    newLine = Math.round(newLine * 2) / 2;
  }

  // If lopsided, shade odds against dominant side
  if (lopsided >= 0.65) {
    const shade = Math.round((lopsided - 0.5) * 30 * dampen);
    // Assume dominant side needs worse odds (more negative or less positive)
    newOver = currentOver - shade;
    newUnder = currentUnder + shade;
  }

  return { overUnder: { line: newLine, overOdds: newOver, underOdds: newUnder } };
}

/* ------------------------------------------------------------------ */
/*  Suggest pointspread changes                                         */
/* ------------------------------------------------------------------ */

function suggestPointspread(
  wager: any,
  drift: number,
  lopsided: number,
  moveCount: number,
): SuggestedMarket {
  const snap = wager.pricingSnapshot?.pointspread;
  const currentSpread = wager.spread ?? 0;
  const currentA = wager.locationAOdds ?? -110;
  const currentB = wager.locationBOdds ?? -110;

  let newSpread = snap?.suggestedSpread ?? currentSpread;
  let newA = snap?.suggestedLocationAOdds ?? currentA;
  let newB = snap?.suggestedLocationBOdds ?? currentB;

  const dampen = moveCount >= 3 ? 0.5 : moveCount >= 2 ? 0.75 : 1.0;

  if (drift >= 0.5) {
    const move = (newSpread - currentSpread) * dampen;
    newSpread = currentSpread + move;
    newSpread = Math.round(newSpread * 2) / 2;
  }

  if (lopsided >= 0.65) {
    const shade = Math.round((lopsided - 0.5) * 30 * dampen);
    newA = currentA - shade;
    newB = currentB + shade;
  }

  return { pointspread: { spread: newSpread, locationAOdds: newA, locationBOdds: newB } };
}

/* ------------------------------------------------------------------ */
/*  Suggest range odds changes                                          */
/* ------------------------------------------------------------------ */

function suggestRangeOdds(
  wager: any,
  drift: number,
  lopsided: number,
  moveCount: number,
): SuggestedMarket {
  const snap = wager.pricingSnapshot?.rangeOdds;
  const currentBands = (wager.outcomes || []).map((o: any) => ({ label: o.label, odds: o.odds }));

  if (!snap?.bands?.length) {
    return { rangeOdds: { bands: currentBands } };
  }

  const dampen = moveCount >= 3 ? 0.5 : moveCount >= 2 ? 0.75 : 1.0;

  const newBands = currentBands.map((band: any) => {
    const modelBand = snap.bands.find((b: any) => b.label === band.label);
    if (!modelBand) return band;
    const modelOdds = modelBand.suggestedOdds ?? modelBand.fairOdds ?? band.odds;
    const move = (modelOdds - band.odds) * dampen;
    return { label: band.label, odds: Math.round(band.odds + move) };
  });

  return { rangeOdds: { bands: newBands } };
}

/* ------------------------------------------------------------------ */
/*  Generate all suggestions                                            */
/* ------------------------------------------------------------------ */

export async function generateRepricingSuggestions(): Promise<RepricingSuggestion[]> {
  const { wagers } = await listWagers({ status: 'open' });
  const suggestions: RepricingSuggestion[] = [];

  for (const wager of wagers) {
    const drift = getModelDrift(wager);
    const exposure = await getWagerExposure(wager.id);
    const liability = exposure?.maxLiabilityCents ?? 0;
    const lopsided = exposure?.byOutcome ? getLopsidedPct(exposure.byOutcome) : 0;
    const staleHours = getStaleHours(wager);
    const moveCount = ((wager as any).lineHistory?.length) ?? 0;

    // Only suggest if there's a meaningful reason
    const needsSuggestion = drift >= 0.5 || liability >= 20000 || lopsided >= 0.65 || staleHours >= 6;
    if (!needsSuggestion) continue;

    const priority = scorePriority(drift, liability, lopsided, staleHours, moveCount);
    const reason = buildReason(drift, liability, lopsided, staleHours);

    // Build current market snapshot
    const current: CurrentMarket = {};
    let suggested: SuggestedMarket = {};

    if (wager.kind === 'over-under') {
      const w = wager as any;
      current.overUnder = { line: w.line, overOdds: w.overOdds, underOdds: w.underOdds };
      suggested = suggestOverUnder(w, drift, lopsided, liability, moveCount);
    } else if (wager.kind === 'pointspread') {
      const w = wager as any;
      current.pointspread = { spread: w.spread, locationAOdds: w.locationAOdds, locationBOdds: w.locationBOdds };
      suggested = suggestPointspread(w, drift, lopsided, moveCount);
    } else if (wager.kind === 'odds') {
      const w = wager as any;
      current.rangeOdds = { bands: (w.outcomes || []).map((o: any) => ({ label: o.label, odds: o.odds })) };
      suggested = suggestRangeOdds(w, drift, lopsided, moveCount);
    }

    suggestions.push({
      wagerId: wager.id,
      title: (wager as any).title || wager.id,
      ticketNumber: (wager as any).ticketNumber || '',
      marketType: wager.kind,
      current,
      suggested,
      reason,
      priority,
      factors: {
        modelDrift: Math.round(drift * 100) / 100,
        liability,
        lopsidedPct: Math.round(lopsided * 100) / 100,
        moveCount,
        staleHours: Math.round(staleHours * 10) / 10,
      },
      generatedAt: new Date().toISOString(),
    });
  }

  // Sort by priority (critical first)
  const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  suggestions.sort((a, b) => (order[a.priority] ?? 4) - (order[b.priority] ?? 4));

  return suggestions;
}

/* ------------------------------------------------------------------ */
/*  Generate overview                                                   */
/* ------------------------------------------------------------------ */

export async function generateRepricingOverview(suggestions: RepricingSuggestion[]): Promise<RepricingOverview> {
  const drifts = suggestions.map(s => s.factors.modelDrift ?? 0);
  const liabilities = suggestions.filter(s => s.priority === 'critical' || s.priority === 'high').map(s => s.factors.liability ?? 0);

  return {
    totalSuggestions: suggestions.length,
    critical: suggestions.filter(s => s.priority === 'critical').length,
    high: suggestions.filter(s => s.priority === 'high').length,
    medium: suggestions.filter(s => s.priority === 'medium').length,
    low: suggestions.filter(s => s.priority === 'low').length,
    avgModelDrift: drifts.length ? drifts.reduce((a, b) => a + b, 0) / drifts.length : 0,
    totalAtRiskLiability: liabilities.reduce((a, b) => a + b, 0),
  };
}

/* ------------------------------------------------------------------ */
/*  Apply suggestion                                                    */
/* ------------------------------------------------------------------ */

export async function applySuggestion(
  wagerId: string,
  appliedMarket: SuggestedMarket,
  originalSuggestion: RepricingSuggestion,
  edited: boolean,
): Promise<AppliedChange | null> {
  const wager = await getWager(wagerId);
  if (!wager) return null;

  // Build the wager update based on market type
  const updates: any = {};

  if (appliedMarket.overUnder && wager.kind === 'over-under') {
    updates.line = appliedMarket.overUnder.line;
    updates.overOdds = appliedMarket.overUnder.overOdds;
    updates.underOdds = appliedMarket.overUnder.underOdds;
  } else if (appliedMarket.pointspread && wager.kind === 'pointspread') {
    updates.spread = appliedMarket.pointspread.spread;
    updates.locationAOdds = appliedMarket.pointspread.locationAOdds;
    updates.locationBOdds = appliedMarket.pointspread.locationBOdds;
  } else if (appliedMarket.rangeOdds && wager.kind === 'odds') {
    const outcomes = (wager as any).outcomes || [];
    const updatedOutcomes = outcomes.map((o: any) => {
      const newBand = appliedMarket.rangeOdds!.bands.find((b: any) => b.label === o.label);
      return newBand ? { ...o, odds: newBand.odds } : o;
    });
    updates.outcomes = updatedOutcomes;
  }

  // Apply via existing wager update flow (handles line history)
  await updateWager(wagerId, updates);

  // Save applied change record
  const change: AppliedChange = {
    id: `rpc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    wagerId,
    title: originalSuggestion.title,
    marketType: originalSuggestion.marketType,
    before: originalSuggestion.current,
    after: appliedMarket,
    reason: originalSuggestion.reason,
    appliedAt: new Date().toISOString(),
    appliedBy: 'admin',
    edited,
  };

  await saveAppliedChange(change);

  // Audit log
  const eventType = edited ? 'repricing_suggestion_edited_before_apply' : 'repricing_suggestion_applied';
  await logAuditEvent({
    actor: 'admin',
    eventType,
    targetType: 'wager',
    targetId: wagerId,
    summary: `Repricing applied: ${originalSuggestion.title} — ${originalSuggestion.reason}`,
    details: { before: originalSuggestion.current, after: appliedMarket, edited },
  });

  return change;
}

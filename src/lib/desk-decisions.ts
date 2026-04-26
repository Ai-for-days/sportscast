// ── Step 74: Desk Decision Journal + Operator Outcome Review ────────────────
//
// Manual decision tracking. Operator marks each signal as take / skip / watch
// / reject with a reason category and notes; later, the same record gets a
// review pass that records the realized outcome and P&L.
//
// CRITICAL CONSTRAINTS
//   - No autonomous trading
//   - No automatic candidate creation
//   - No execution changes
//   - No scoring changes
//   - Manual journal only

import { getRedis } from './redis';

const KEY_PREFIX = 'desk-decision:';
const SET_KEY = 'desk-decisions:all';
const MAX_ENTRIES = 5000;

export type DecisionType = 'take' | 'skip' | 'watch' | 'reject';
export type ReasonCategory =
  | 'edge'
  | 'calibration'
  | 'liquidity'
  | 'risk'
  | 'venue'
  | 'weather_uncertainty'
  | 'manual_override'
  | 'other';
export type OutcomeStatus = 'pending' | 'won' | 'lost' | 'push' | 'missed_opportunity';

export interface DeskDecision {
  id: string;
  createdAt: string;
  updatedAt: string;
  signalId: string;
  title: string;
  source: string;
  marketType?: string;
  locationName?: string;
  metric?: string;
  targetDate?: string;
  operatorId: string;
  decision: DecisionType;
  reasonCategory: ReasonCategory;
  notes?: string;
  // Captured signal-time context (snapshot at decision moment)
  rawEdge?: number;
  calibratedEdge?: number;
  reliabilityFactor?: number;
  signalScore?: number;
  sizingTier?: string;
  // Review fields (filled in later)
  outcomeStatus?: OutcomeStatus;
  pnlCents?: number;
  reviewedAt?: string;
  reviewNotes?: string;
}

function newId(): string {
  return `dd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export interface CreateDecisionInput {
  signalId: string;
  title: string;
  source: string;
  marketType?: string;
  locationName?: string;
  metric?: string;
  targetDate?: string;
  operatorId: string;
  decision: DecisionType;
  reasonCategory: ReasonCategory;
  notes?: string;
  rawEdge?: number;
  calibratedEdge?: number;
  reliabilityFactor?: number;
  signalScore?: number;
  sizingTier?: string;
}

export async function createDecision(input: CreateDecisionInput): Promise<DeskDecision> {
  const redis = getRedis();
  const now = new Date().toISOString();
  const id = newId();
  const record: DeskDecision = {
    id,
    createdAt: now,
    updatedAt: now,
    outcomeStatus: 'pending',
    ...input,
  };
  await redis.set(`${KEY_PREFIX}${id}`, JSON.stringify(record));
  await redis.zadd(SET_KEY, { score: Date.now(), member: id });

  // Auto-trim oldest beyond MAX_ENTRIES
  const total = await redis.zcard(SET_KEY);
  if (total > MAX_ENTRIES) {
    const overflow = total - MAX_ENTRIES;
    const oldest = await redis.zrange(SET_KEY, 0, overflow - 1);
    if (oldest && oldest.length > 0) {
      await redis.zremrangebyrank(SET_KEY, 0, overflow - 1);
      for (const oldId of oldest) {
        await redis.del(`${KEY_PREFIX}${oldId}`);
      }
    }
  }
  return record;
}

export async function getDecision(id: string): Promise<DeskDecision | null> {
  const redis = getRedis();
  const raw = await redis.get(`${KEY_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : (raw as DeskDecision);
}

export async function updateDecision(id: string, patch: Partial<Pick<DeskDecision, 'decision' | 'reasonCategory' | 'notes'>>): Promise<DeskDecision | null> {
  const existing = await getDecision(id);
  if (!existing) return null;
  const updated: DeskDecision = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  const redis = getRedis();
  await redis.set(`${KEY_PREFIX}${id}`, JSON.stringify(updated));
  return updated;
}

export async function reviewDecision(
  id: string,
  patch: Pick<DeskDecision, 'outcomeStatus' | 'pnlCents' | 'reviewNotes'>,
): Promise<DeskDecision | null> {
  const existing = await getDecision(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  const updated: DeskDecision = {
    ...existing,
    outcomeStatus: patch.outcomeStatus ?? existing.outcomeStatus,
    pnlCents: patch.pnlCents,
    reviewNotes: patch.reviewNotes,
    reviewedAt: now,
    updatedAt: now,
  };
  const redis = getRedis();
  await redis.set(`${KEY_PREFIX}${id}`, JSON.stringify(updated));
  return updated;
}

export async function listDecisions(limit = 200): Promise<DeskDecision[]> {
  const redis = getRedis();
  const total = await redis.zcard(SET_KEY);
  if (total === 0) return [];
  const ids = await redis.zrange(SET_KEY, 0, Math.min(total, limit) - 1, { rev: true });
  const out: DeskDecision[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${KEY_PREFIX}${id}`);
    if (raw) out.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }
  return out;
}

// ── Summary / analysis ──────────────────────────────────────────────────────

export interface DecisionSummary {
  totals: { take: number; skip: number; watch: number; reject: number; all: number };
  byReason: Record<ReasonCategory, number>;
  taken: {
    count: number;
    withPnl: number;
    wins: number;
    losses: number;
    pushes: number;
    winRatePct: number | null;
    totalPnlCents: number;
    avgPnlCents: number | null;
  };
  skippedThatWon: number;        // skip + outcomeStatus 'won' (manual flag) or 'missed_opportunity'
  rejectedThatWon: number;       // reject + same
  takenThatLost: number;         // take + lost
  manualOverrides: number;       // reasonCategory === 'manual_override'
  pending: number;               // outcomeStatus pending or undefined
  reviewed: number;
  missedOpportunities: number;   // outcomeStatus === 'missed_opportunity'
}

export function summarize(decisions: DeskDecision[]): DecisionSummary {
  const empty: ReasonCategory[] = ['edge', 'calibration', 'liquidity', 'risk', 'venue', 'weather_uncertainty', 'manual_override', 'other'];
  const byReason = Object.fromEntries(empty.map(r => [r, 0])) as Record<ReasonCategory, number>;

  const taken = decisions.filter(d => d.decision === 'take');
  const takenWithPnl = taken.filter(d => d.pnlCents != null);
  const wins = takenWithPnl.filter(d => (d.pnlCents as number) > 0).length;
  const losses = takenWithPnl.filter(d => (d.pnlCents as number) < 0).length;
  const pushes = takenWithPnl.filter(d => (d.pnlCents as number) === 0).length;
  const totalPnl = takenWithPnl.reduce((s, d) => s + (d.pnlCents as number), 0);

  for (const d of decisions) byReason[d.reasonCategory] += 1;

  const skippedThatWon = decisions.filter(d => d.decision === 'skip' && (d.outcomeStatus === 'won' || d.outcomeStatus === 'missed_opportunity')).length;
  const rejectedThatWon = decisions.filter(d => d.decision === 'reject' && (d.outcomeStatus === 'won' || d.outcomeStatus === 'missed_opportunity')).length;
  const takenThatLost = taken.filter(d => d.outcomeStatus === 'lost').length;

  const totalsBy = (kind: DecisionType) => decisions.filter(d => d.decision === kind).length;

  return {
    totals: {
      take: totalsBy('take'),
      skip: totalsBy('skip'),
      watch: totalsBy('watch'),
      reject: totalsBy('reject'),
      all: decisions.length,
    },
    byReason,
    taken: {
      count: taken.length,
      withPnl: takenWithPnl.length,
      wins, losses, pushes,
      winRatePct: takenWithPnl.length > 0 ? Math.round((wins / takenWithPnl.length) * 1000) / 10 : null,
      totalPnlCents: totalPnl,
      avgPnlCents: takenWithPnl.length > 0 ? Math.round(totalPnl / takenWithPnl.length) : null,
    },
    skippedThatWon,
    rejectedThatWon,
    takenThatLost,
    manualOverrides: byReason.manual_override,
    pending: decisions.filter(d => d.outcomeStatus === 'pending' || d.outcomeStatus === undefined).length,
    reviewed: decisions.filter(d => d.reviewedAt != null).length,
    missedOpportunities: decisions.filter(d => d.outcomeStatus === 'missed_opportunity').length,
  };
}

export function findMissedOpportunities(decisions: DeskDecision[]): DeskDecision[] {
  // A skipped/rejected signal that the operator later marked as won or as a
  // missed_opportunity. Automatic detection (looking up the resolved Kalshi
  // market by ticker) is future work — see methodology.
  return decisions.filter(d =>
    (d.decision === 'skip' || d.decision === 'reject') &&
    (d.outcomeStatus === 'won' || d.outcomeStatus === 'missed_opportunity'),
  );
}

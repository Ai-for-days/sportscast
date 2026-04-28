// ── Step 92: Operator training mode + practice simulator ────────────────────
//
// Sandboxed training so operators can rehearse the full workflow without
// touching real candidates, orders, pilots, strategies, playbooks,
// settlements, or ledgers. Every training write goes to the training:*
// keyspace; nothing in this file calls into production stores. Audit log
// entries are still produced, since the audit log records "what the
// operator did," not production state.

import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';

// ── Types ───────────────────────────────────────────────────────────────────

export type ScenarioType =
  | 'signal_review'
  | 'risk_review'
  | 'pilot_review'
  | 'execution_playbook'
  | 'incident_response';

export type SessionStatus = 'open' | 'completed' | 'cancelled';

export interface ExpectedAction {
  /** Stable id used to match recorded actions. */
  id: string;
  /** Operator-facing label. */
  label: string;
  /** Required for full credit. */
  required: boolean;
  /** Positive points awarded when this action is recorded. */
  scoreWeight: number;
  /** Hint shown to the operator after completion. */
  rationale: string;
}

export interface DistractorAction {
  /** Stable id; recording one of these is a "wrong action". */
  id: string;
  label: string;
  /** Negative points (penalty applied during scoring). */
  penaltyWeight: number;
  /** Why this was the wrong call (shown in feedback). */
  rationale: string;
}

export interface TrainingScenario {
  id: string;
  title: string;
  scenarioType: ScenarioType;
  /** What the operator is meant to learn / demonstrate. */
  objective: string;
  /** Briefing the operator sees before the run. */
  briefing: string;
  /** Fake / mock data (json-safe blob) shown in the session. */
  mockData: Record<string, any>;
  expectedActions: ExpectedAction[];
  distractors: DistractorAction[];
  /** Plain-English rubric description. */
  scoringRubric: string;
}

export interface TrainingAction {
  /** Stable id of the recorded action (one row in the session log). */
  id: string;
  recordedAt: string;
  /** id from scenario.expectedActions OR scenario.distractors OR null for free-form note. */
  actionId: string | null;
  /** "good" | "wrong" | "note" — derived at record time, persisted for clarity. */
  kind: 'good' | 'wrong' | 'note';
  /** Operator-supplied free-form text. */
  note?: string;
}

export interface SessionScore {
  score: number;            // 0..100
  total: number;            // raw sum (pre-clamp)
  goodActionPoints: number; // sum of scoreWeights for matched expected actions
  missedRequiredPenalty: number;  // negative; -10 per missed required
  wrongActionPenalty: number;     // negative; sum of penaltyWeights
  goodActions: string[];          // labels of matched expected actions
  missedRequired: string[];       // labels of required actions that were not recorded
  wrongActions: string[];         // labels of distractor actions that were recorded
  durationMs: number | null;
  feedback: string[];
}

export interface TrainingSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  operatorId: string;
  scenarioId: string;
  scenarioType: ScenarioType;
  status: SessionStatus;
  actions: TrainingAction[];
  notes: string[];
  completedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  /** Computed and stamped on completion (and recomputed on each read). */
  score?: SessionScore;
}

export class TrainingError extends Error {
  constructor(message: string, public code: string) { super(message); }
}

// ── Storage keys / caps (training-only namespace) ───────────────────────────

const SESSION_PREFIX = 'training:session:';
const SESSION_SET = 'training:sessions:all';
const MAX_SESSIONS = 1000;

// ── Helpers ─────────────────────────────────────────────────────────────────

function newSessionId(): string {
  return `tr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function newActionId(): string {
  return `act-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Scenario catalog (static; not persisted) ────────────────────────────────

export const SCENARIOS: TrainingScenario[] = [
  {
    id: 'review-eligible-signal',
    title: 'Review a systematic-eligible signal',
    scenarioType: 'signal_review',
    objective: 'Confirm a systematic-eligible signal is well-calibrated, has sufficient evidence, and clears risk filters before flagging it for execution.',
    briefing: 'A new ranked signal has cleared the systematic eligibility filter. Walk through calibration, evidence, and venue checks before deciding whether to advance it.',
    mockData: {
      signalId: 'mock-clt-rain-yes-2026-04-29',
      market: 'CLT rain over 0.10in',
      probability: 0.62,
      modelEdgePct: 4.8,
      calibratedEdgePct: 5.2,
      reliabilityFactor: 0.84,
      systematicEligible: true,
      sampleSize: 312,
      evidence: 'moderate',
      venue: 'outdoor',
      indoorWarning: false,
      strategy: 'rain-yes-v2',
    },
    expectedActions: [
      { id: 'verify-calibrated-edge',  label: 'Verify calibrated edge is positive and consistent with the label', required: true,  scoreWeight: 18, rationale: 'Calibrated edge is the load-bearing input; without it eligibility means little.' },
      { id: 'verify-reliability',      label: 'Verify reliability factor (≥0.7 here) is acceptable',               required: true,  scoreWeight: 14, rationale: 'A high reliability factor means the calibration model has confidence.' },
      { id: 'verify-sample-size',      label: 'Verify sample size / evidence label is sufficient',                  required: true,  scoreWeight: 12, rationale: '>=200 resolved orders is the moderate-evidence threshold.' },
      { id: 'verify-venue',            label: 'Confirm no indoor/venue warning would invalidate the signal',         required: true,  scoreWeight: 10, rationale: 'Outdoor markets are eligible; indoor venues invalidate weather signals.' },
      { id: 'advance-to-allocation',   label: 'Advance to the allocation step (do not auto-trade)',                  required: true,  scoreWeight: 16, rationale: 'Eligible signals get sized at the allocation stage, never executed automatically.' },
    ],
    distractors: [
      { id: 'submit-now',              label: 'Submit a live order immediately',                                     penaltyWeight: 25, rationale: 'Submitting before sizing skips risk review and dual-control.' },
      { id: 'ignore-reliability',      label: 'Ignore reliability factor — eligibility flag is enough',              penaltyWeight: 10, rationale: 'Eligibility uses thresholds; reliability is the calibration confidence layer.' },
      { id: 'force-promote-strategy',  label: 'Promote the underlying strategy to pilot_ready right now',            penaltyWeight: 15, rationale: 'Strategy promotion has its own gating workflow; signal review does not promote.' },
    ],
    scoringRubric: 'Full credit requires all five expected actions; reliability check and venue check are easy to forget. Distractors model common shortcuts.',
  },
  {
    id: 'reject-weak-signal',
    title: 'Reject a weak signal',
    scenarioType: 'signal_review',
    objective: 'Recognize when calibration data is too thin or the edge is below the action threshold and reject the signal cleanly.',
    briefing: 'A new signal looks edgy at first glance, but evidence is sparse. Decide whether to take it, and journal your reasoning.',
    mockData: {
      signalId: 'mock-rdu-snow-yes-2026-12-01',
      market: 'RDU snow over 1.0in',
      probability: 0.41,
      modelEdgePct: 1.8,
      calibratedEdgePct: 0.9,
      reliabilityFactor: 0.42,
      systematicEligible: false,
      sampleSize: 18,
      evidence: 'insufficient',
    },
    expectedActions: [
      { id: 'note-low-edge',     label: 'Note the calibrated edge is too low to act on',     required: true,  scoreWeight: 18, rationale: 'Below the action threshold the expected value is dominated by friction.' },
      { id: 'note-thin-evidence', label: 'Note evidence label is "insufficient"',             required: true,  scoreWeight: 18, rationale: 'You cannot promote against insufficient calibration evidence.' },
      { id: 'reject-with-reason', label: 'Reject the signal in the desk decisions journal with a written reason', required: true, scoreWeight: 20, rationale: 'A written rejection preserves audit trail.' },
      { id: 'add-to-watchlist',   label: 'Add the underlying strategy to the watchlist for more evidence',         required: false, scoreWeight: 8, rationale: 'Optional: revisit once sample size grows.' },
    ],
    distractors: [
      { id: 'force-take',     label: 'Take it anyway "just to see"',                          penaltyWeight: 25, rationale: 'Taking thin-evidence signals contaminates calibration data and wastes capital.' },
      { id: 'ignore-thresholds', label: 'Ignore the thresholds because the model "feels right"', penaltyWeight: 15, rationale: 'Thresholds exist to neutralize hindsight bias.' },
    ],
    scoringRubric: 'Full credit requires recognizing low edge, thin evidence, and writing a rejection. Watchlist add is bonus.',
  },
  {
    id: 'complete-execution-playbook',
    title: 'Complete a manual execution playbook',
    scenarioType: 'execution_playbook',
    objective: 'Walk a paper-mode execution from signal review through post-trade without skipping required items.',
    briefing: 'You are running a paper-mode playbook for an eligible signal. Move through every required check; you can skip optional items but must always link a candidate before the order step.',
    mockData: { signalId: 'mock-bos-wind-no-2026-05-04', mode: 'paper', strategyId: 'wind-no-v1' },
    expectedActions: [
      { id: 'complete-signal-review',   label: 'Complete all signal-review checks',          required: true, scoreWeight: 14, rationale: 'Signal review is required before risk review.' },
      { id: 'complete-risk-review',     label: 'Complete all risk-review checks',            required: true, scoreWeight: 14, rationale: 'Risk review confirms allocation, stress, and concentration are acceptable.' },
      { id: 'link-candidate',            label: 'Link the manually-created candidate id',     required: true, scoreWeight: 12, rationale: 'Candidates are not auto-created — paste the id you created elsewhere.' },
      { id: 'review-dry-run',            label: 'Review the dry-run order (size / price / side / market)', required: true, scoreWeight: 12, rationale: 'A dry-run check catches sizing or side mistakes before submission.' },
      { id: 'journal-decision',          label: 'Journal the decision',                       required: true, scoreWeight: 10, rationale: 'Journaled decisions feed downstream attribution.' },
      { id: 'add-review-note',           label: 'Add a written review note',                  required: true, scoreWeight: 10, rationale: 'Review notes record rationale and observations for later study.' },
      { id: 'complete-playbook',         label: 'Mark the playbook complete after required items pass', required: true, scoreWeight: 10, rationale: 'Completing the playbook closes the run and stamps audit trail.' },
    ],
    distractors: [
      { id: 'skip-required-no-note', label: 'Skip a required item without a note',           penaltyWeight: 20, rationale: 'Required items can only be skipped with a written reason.' },
      { id: 'submit-before-link',    label: 'Submit the order before linking the candidate', penaltyWeight: 20, rationale: 'Reverses the audit trail — link candidate first, order next.' },
      { id: 'force-complete-blocked', label: 'Force complete while a required item is blocked', penaltyWeight: 25, rationale: 'completePlaybook() rejects this — practice handling the rejection cleanly.' },
    ],
    scoringRubric: 'Full credit requires every required step in order. Distractors capture the most common mistakes seen in audit data.',
  },
  {
    id: 'pilot-breach-warning',
    title: 'Handle a pilot breach warning',
    scenarioType: 'pilot_review',
    objective: 'When an active pilot breaches its limits, recognize the breach, freeze new entries from that pilot, and capture rationale.',
    briefing: 'An active pilot has tripped its daily-loss limit by 12%. Decide what to do without panicking the pilot into auto-pause behavior the system does not have.',
    mockData: {
      pilotId: 'mock-pilot-rain-yes-pilot-1',
      strategyName: 'rain-yes-v2',
      mode: 'demo',
      maxDailyLossCents: 50000,
      realizedLossCents: 56000,
      breaches: ['daily-loss > limit'],
      warningStatus: 'breach',
    },
    expectedActions: [
      { id: 'acknowledge-breach',   label: 'Acknowledge the breach in the alert system',                              required: true,  scoreWeight: 14, rationale: 'Acknowledging records that the desk has seen the breach.' },
      { id: 'open-pilot-control',   label: 'Open the pilot control room and freeze new entries from this pilot',     required: true,  scoreWeight: 16, rationale: 'Freezing new entries is operator-controlled — no auto-pause exists.' },
      { id: 'review-recent-orders', label: 'Review recent orders attributed to the pilot',                            required: true,  scoreWeight: 12, rationale: 'Investigate whether the loss is one bad fill or a pattern.' },
      { id: 'write-incident-note',  label: 'Write an incident note summarizing the breach + decision',                required: true,  scoreWeight: 12, rationale: 'Incident notes feed audit + post-mortem.' },
      { id: 'schedule-go-no-go',    label: 'Schedule a pilot go/no-go review',                                        required: false, scoreWeight: 8,  rationale: 'Optional — required if the breach repeats.' },
    ],
    distractors: [
      { id: 'auto-pause',          label: 'Auto-pause the pilot via the API',                                        penaltyWeight: 20, rationale: 'There is no auto-pause endpoint — pausing is a manual operator action.' },
      { id: 'cancel-all-orders',   label: 'Mass-cancel every order in the system',                                  penaltyWeight: 25, rationale: 'Mass-cancel is overkill and disruptive; only cancel orders attributed to the pilot.' },
      { id: 'ignore-breach',       label: 'Ignore the breach because it is "small"',                                penaltyWeight: 15, rationale: 'Even a small breach must be acknowledged in the alert system.' },
    ],
    scoringRubric: 'Full credit requires acknowledging the breach, freezing new pilot entries, investigating, and journaling. Auto-pause is the most common wrong call.',
  },
  {
    id: 'overdue-pilot-decision',
    title: 'Resolve an overdue pilot decision',
    scenarioType: 'pilot_review',
    objective: 'Take an overdue go/no-go decision and either complete it (with rationale) or cancel it (with reason). Do not let it linger.',
    briefing: 'A go/no-go decision has been open for 4 days past its dueDate. Move it to a terminal state in a way that preserves audit trail.',
    mockData: {
      decisionId: 'mock-dec-l9j-7',
      pilotName: 'rain-yes-v2',
      recommendation: 'continue',
      decision: 'accepted',
      dueDate: '2026-04-24',
      ageDays: 4,
    },
    expectedActions: [
      { id: 'open-decision',        label: 'Open the decision in the pilot decisions tracker',                       required: true, scoreWeight: 12, rationale: 'Look at the original review and any context before acting.' },
      { id: 'mark-in-progress',     label: 'Move it to in_progress with a status note',                              required: true, scoreWeight: 12, rationale: 'in_progress signals that the operator owns the resolution now.' },
      { id: 'mark-completed-with-rationale', label: 'Complete the decision with a written rationale',                required: true, scoreWeight: 18, rationale: 'Completion requires a clear rationale for audit.' },
      { id: 'add-followup-note',    label: 'Add a follow-up note describing what changed in production',             required: false, scoreWeight: 8,  rationale: 'Optional but excellent — links the decision to actual ops.' },
    ],
    distractors: [
      { id: 'silent-complete',  label: 'Mark the decision completed without any rationale',                          penaltyWeight: 20, rationale: 'Completion-without-rationale is rejected by the API.' },
      { id: 'force-cancel',     label: 'Cancel the decision without a written reason',                                penaltyWeight: 15, rationale: 'Cancellations require a written reason.' },
      { id: 'extend-due-date',  label: 'Edit the due date to make it not overdue any more',                           penaltyWeight: 25, rationale: 'Editing dueDate to dodge the overdue flag is governance theater.' },
    ],
    scoringRubric: 'Full credit requires opening, moving to in_progress, and completing with rationale. The silent-completion distractor is the most common compliance failure.',
  },
  {
    id: 'respond-to-scorecard-alert',
    title: 'Respond to a scorecard alert',
    scenarioType: 'incident_response',
    objective: 'Take an open scorecard alert through acknowledgement and resolution while writing a real resolution note.',
    briefing: 'A scorecard alert has been open for two days. Acknowledge it, investigate, and resolve it correctly.',
    mockData: {
      alertId: 'mock-salert-l9j-2',
      ruleId: 'overdue-decisions',
      severity: 'high',
      fireCount: 3,
      title: '2 overdue pilot decisions',
    },
    expectedActions: [
      { id: 'open-alert',         label: 'Open the alert in the strategy brief',                          required: true, scoreWeight: 12, rationale: 'Read the alert before acting.' },
      { id: 'acknowledge',        label: 'Acknowledge with a note describing investigation steps',         required: true, scoreWeight: 16, rationale: 'Acknowledgement separates "seen" from "resolved".' },
      { id: 'fix-underlying',     label: 'Resolve the underlying overdue decisions in the pilot decisions tracker', required: true, scoreWeight: 20, rationale: 'Resolving the alert without fixing the cause just hides the signal.' },
      { id: 'resolve-with-note',  label: 'Resolve the alert with a written resolution',                    required: true, scoreWeight: 14, rationale: 'Resolution requires a non-empty resolution string.' },
    ],
    distractors: [
      { id: 'resolve-without-fix', label: 'Resolve the alert without fixing the underlying overdue decisions', penaltyWeight: 25, rationale: 'Resolving without fixing the cause is the most common bad pattern.' },
      { id: 'ignore-alert',        label: 'Leave it open and hope it resolves itself',                          penaltyWeight: 15, rationale: 'Alerts never auto-resolve.' },
    ],
    scoringRubric: 'Full credit requires investigating, fixing the cause, then resolving with a written note. Distractors capture the "fix the symptom" failure mode.',
  },
  {
    id: 'allocation-stress-review',
    title: 'Review an allocation stress test',
    scenarioType: 'risk_review',
    objective: 'Read a Caution-level stress verdict and either reduce exposure or document why current allocation is acceptable.',
    briefing: 'The latest allocation stress test came back Caution because of a 38% concentration in a single city bucket. Decide what to do.',
    mockData: {
      verdict: 'Caution',
      reason: '38% city concentration in a single market',
      meanMaxDrawdownCents: 220000,
      bankrollCents: 1000000,
    },
    expectedActions: [
      { id: 'open-stress-test',     label: 'Open the allocation stress test report',                                  required: true, scoreWeight: 12, rationale: 'Read the full report before reacting.' },
      { id: 'identify-concentration', label: 'Identify which city / date / metric drives the concentration',          required: true, scoreWeight: 14, rationale: 'Concentration in one bucket is the signal here.' },
      { id: 'reduce-or-document',   label: 'Either reduce the concentrated allocation or document acceptance with a reason', required: true, scoreWeight: 18, rationale: 'Either is acceptable; doing nothing is not.' },
      { id: 'log-stress-decision',  label: 'Log the decision in the operator dashboard',                                required: false, scoreWeight: 8,  rationale: 'Optional — keeps a paper trail.' },
    ],
    distractors: [
      { id: 'increase-exposure', label: 'Increase exposure to take advantage of the concentrated bet',               penaltyWeight: 25, rationale: 'Caution verdict means concentration is already too high.' },
      { id: 'ignore-verdict',    label: 'Ignore the Caution verdict because realized P&L is positive',                penaltyWeight: 20, rationale: 'Backward-looking realized P&L is not a substitute for stress.' },
    ],
    scoringRubric: 'Full credit requires reading the report, identifying the concentration driver, and either reducing or documenting. Increasing exposure into a Caution verdict is the worst mistake.',
  },
];

const SCENARIOS_BY_ID = new Map(SCENARIOS.map(s => [s.id, s]));

export function listScenarios(): TrainingScenario[] {
  return SCENARIOS;
}
export function getScenario(id: string): TrainingScenario | null {
  return SCENARIOS_BY_ID.get(id) ?? null;
}

// ── Session CRUD (training:* namespace only) ────────────────────────────────

export async function startSession(input: { operatorId: string; scenarioId: string; note?: string }): Promise<TrainingSession> {
  if (!input.operatorId) throw new TrainingError('operatorId is required', 'operator_required');
  const scenario = getScenario(input.scenarioId);
  if (!scenario) throw new TrainingError(`Unknown scenarioId "${input.scenarioId}"`, 'scenario_not_found');

  const id = newSessionId();
  const now = new Date().toISOString();
  const session: TrainingSession = {
    id,
    createdAt: now,
    updatedAt: now,
    operatorId: input.operatorId,
    scenarioId: scenario.id,
    scenarioType: scenario.scenarioType,
    status: 'open',
    actions: [],
    notes: input.note?.trim() ? [`[${now}] ${input.operatorId}: ${input.note.trim()}`] : [],
  };

  const redis = getRedis();
  await redis.set(`${SESSION_PREFIX}${id}`, JSON.stringify(session));
  await redis.zadd(SESSION_SET, { score: Date.now(), member: id });
  await trimToCap(redis, SESSION_SET, SESSION_PREFIX, MAX_SESSIONS);

  await logAuditEvent({
    actor: input.operatorId,
    eventType: 'training_session_started',
    targetType: 'training_session',
    targetId: id,
    summary: `Training session ${id} started for scenario "${scenario.title}"`,
    details: { sessionId: id, scenarioId: scenario.id, scenarioType: scenario.scenarioType },
  });

  return session;
}

export async function getSession(id: string): Promise<TrainingSession | null> {
  const redis = getRedis();
  const raw = await redis.get(`${SESSION_PREFIX}${id}`);
  if (!raw) return null;
  const session = (typeof raw === 'string' ? JSON.parse(raw) : raw) as TrainingSession;
  // Always recompute score on read (cheap and keeps the UI in sync).
  session.score = scoreSession(session);
  return session;
}

export async function listSessions(limit = 200): Promise<TrainingSession[]> {
  const redis = getRedis();
  const total = await redis.zcard(SESSION_SET);
  if (total === 0) return [];
  const ids = await redis.zrange(SESSION_SET, 0, Math.min(total, limit) - 1, { rev: true });
  const out: TrainingSession[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${SESSION_PREFIX}${id}`);
    if (raw) {
      const s = (typeof raw === 'string' ? JSON.parse(raw) : raw) as TrainingSession;
      s.score = scoreSession(s);
      out.push(s);
    }
  }
  return out;
}

async function saveSession(session: TrainingSession): Promise<void> {
  const redis = getRedis();
  await redis.set(`${SESSION_PREFIX}${session.id}`, JSON.stringify(session));
}

// ── Recording actions ───────────────────────────────────────────────────────

export async function recordAction(input: {
  sessionId: string;
  actionId: string | null;
  note?: string;
  actor: string;
}): Promise<TrainingSession> {
  const session = await getSession(input.sessionId);
  if (!session) throw new TrainingError('Training session not found', 'session_not_found');
  if (session.status !== 'open') throw new TrainingError(`Cannot record on a ${session.status} session`, 'illegal_record');

  const scenario = getScenario(session.scenarioId);
  if (!scenario) throw new TrainingError('Scenario not found', 'scenario_not_found');

  let kind: TrainingAction['kind'] = 'note';
  if (input.actionId) {
    if (scenario.expectedActions.some(a => a.id === input.actionId)) kind = 'good';
    else if (scenario.distractors.some(a => a.id === input.actionId)) kind = 'wrong';
    else throw new TrainingError(`Unknown actionId "${input.actionId}" for this scenario`, 'unknown_action');
  } else if (!input.note?.trim()) {
    throw new TrainingError('Either actionId or note is required', 'empty_action');
  }

  const action: TrainingAction = {
    id: newActionId(),
    recordedAt: new Date().toISOString(),
    actionId: input.actionId ?? null,
    kind,
    note: input.note?.trim() || undefined,
  };
  session.actions.push(action);
  session.updatedAt = action.recordedAt;
  await saveSession(session);

  return { ...session, score: scoreSession(session) };
}

// ── Notes ───────────────────────────────────────────────────────────────────

export async function addNote(sessionId: string, note: string, actor: string): Promise<TrainingSession> {
  if (!note?.trim()) throw new TrainingError('note is required', 'note_required');
  const session = await getSession(sessionId);
  if (!session) throw new TrainingError('Training session not found', 'session_not_found');
  const stamped = `[${new Date().toISOString()}] ${actor}: ${note.trim()}`;
  session.notes = [...(session.notes ?? []), stamped].slice(-200);
  session.updatedAt = new Date().toISOString();
  await saveSession(session);
  return { ...session, score: scoreSession(session) };
}

// ── Transitions ─────────────────────────────────────────────────────────────

export async function completeSession(sessionId: string, actor: string): Promise<TrainingSession> {
  const session = await getSession(sessionId);
  if (!session) throw new TrainingError('Training session not found', 'session_not_found');
  if (session.status !== 'open') throw new TrainingError(`Cannot complete a ${session.status} session`, 'illegal_transition');

  const now = new Date().toISOString();
  session.status = 'completed';
  session.completedAt = now;
  session.updatedAt = now;
  session.score = scoreSession(session);
  await saveSession(session);

  await logAuditEvent({
    actor,
    eventType: 'training_session_completed',
    targetType: 'training_session',
    targetId: sessionId,
    summary: `Training session ${sessionId} completed (score=${session.score?.score ?? '—'})`,
    details: { sessionId, scenarioId: session.scenarioId, score: session.score?.score, durationMs: session.score?.durationMs },
  });

  return session;
}

export async function cancelSession(sessionId: string, actor: string, reason: string): Promise<TrainingSession> {
  if (!reason?.trim()) throw new TrainingError('cancel reason is required', 'reason_required');
  const session = await getSession(sessionId);
  if (!session) throw new TrainingError('Training session not found', 'session_not_found');
  if (session.status !== 'open') throw new TrainingError(`Cannot cancel a ${session.status} session`, 'illegal_transition');

  const now = new Date().toISOString();
  session.status = 'cancelled';
  session.cancelledAt = now;
  session.cancelReason = reason.trim();
  session.updatedAt = now;
  session.notes = [...(session.notes ?? []), `[${now}] ${actor}: cancelled — ${reason.trim()}`];
  session.score = scoreSession(session);
  await saveSession(session);

  await logAuditEvent({
    actor,
    eventType: 'training_session_cancelled',
    targetType: 'training_session',
    targetId: sessionId,
    summary: `Training session ${sessionId} cancelled: ${reason.trim()}`,
    details: { sessionId, reason: reason.trim() },
  });

  return session;
}

// ── Scoring ─────────────────────────────────────────────────────────────────

const MISSED_REQUIRED_PENALTY = 10;

export function scoreSession(session: TrainingSession): SessionScore {
  const scenario = getScenario(session.scenarioId);
  if (!scenario) {
    return {
      score: 0, total: 0, goodActionPoints: 0,
      missedRequiredPenalty: 0, wrongActionPenalty: 0,
      goodActions: [], missedRequired: [], wrongActions: [],
      durationMs: null,
      feedback: ['Scenario definition missing — cannot score.'],
    };
  }

  // Most-recent action per id wins (operators may correct themselves).
  const recordedIds = new Set<string>();
  for (const a of session.actions) {
    if (a.actionId) recordedIds.add(a.actionId);
  }

  let goodActionPoints = 0;
  const goodActions: string[] = [];
  for (const e of scenario.expectedActions) {
    if (recordedIds.has(e.id)) {
      goodActionPoints += e.scoreWeight;
      goodActions.push(e.label);
    }
  }

  const missedRequired: string[] = [];
  for (const e of scenario.expectedActions) {
    if (e.required && !recordedIds.has(e.id)) missedRequired.push(e.label);
  }
  const missedRequiredPenalty = -missedRequired.length * MISSED_REQUIRED_PENALTY;

  let wrongActionPenalty = 0;
  const wrongActions: string[] = [];
  for (const d of scenario.distractors) {
    if (recordedIds.has(d.id)) {
      wrongActionPenalty -= d.penaltyWeight;
      wrongActions.push(d.label);
    }
  }

  const total = goodActionPoints + missedRequiredPenalty + wrongActionPenalty;
  const score = Math.max(0, Math.min(100, total));

  let durationMs: number | null = null;
  if (session.status === 'completed' && session.completedAt) {
    const dur = new Date(session.completedAt).getTime() - new Date(session.createdAt).getTime();
    if (Number.isFinite(dur) && dur >= 0) durationMs = dur;
  }

  // Feedback narrative
  const feedback: string[] = [];
  for (const e of scenario.expectedActions) {
    if (recordedIds.has(e.id)) feedback.push(`✓ ${e.label} — ${e.rationale}`);
  }
  for (const label of missedRequired) feedback.push(`✗ Missed required: ${label}`);
  for (const d of scenario.distractors) {
    if (recordedIds.has(d.id)) feedback.push(`✗ Wrong action: ${d.label} — ${d.rationale}`);
  }

  return {
    score, total, goodActionPoints,
    missedRequiredPenalty, wrongActionPenalty,
    goodActions, missedRequired, wrongActions,
    durationMs, feedback,
  };
}

// ── Aggregations ────────────────────────────────────────────────────────────

export interface TrainingSummary {
  total: number;
  byStatus: Record<SessionStatus, number>;
  byScenarioType: Record<ScenarioType, number>;
  averageScore: number | null;
  averageDurationMs: number | null;
  passingPct: number | null; // % of completed sessions with score ≥ 70
}

const PASS_THRESHOLD = 70;

export function summarizeSessions(sessions: TrainingSession[]): TrainingSummary {
  const byStatus: Record<SessionStatus, number> = { open: 0, completed: 0, cancelled: 0 };
  const byScenarioType: Record<ScenarioType, number> = {
    signal_review: 0, risk_review: 0, pilot_review: 0, execution_playbook: 0, incident_response: 0,
  };
  let scoreSum = 0;
  let scoreCount = 0;
  let durationSum = 0;
  let durationCount = 0;
  let passing = 0;
  let completedCount = 0;

  for (const s of sessions) {
    byStatus[s.status]++;
    byScenarioType[s.scenarioType]++;
    if (s.status === 'completed') {
      completedCount++;
      if (s.score) {
        scoreSum += s.score.score;
        scoreCount++;
        if (s.score.score >= PASS_THRESHOLD) passing++;
        if (s.score.durationMs != null) {
          durationSum += s.score.durationMs;
          durationCount++;
        }
      }
    }
  }

  return {
    total: sessions.length,
    byStatus,
    byScenarioType,
    averageScore: scoreCount === 0 ? null : Math.round(scoreSum / scoreCount),
    averageDurationMs: durationCount === 0 ? null : Math.round(durationSum / durationCount),
    passingPct: completedCount === 0 ? null : Math.round((passing / completedCount) * 1000) / 10,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function trimToCap(redis: any, setKey: string, keyPrefix: string, cap: number) {
  const total = await redis.zcard(setKey);
  if (total <= cap) return;
  const overflow = total - cap;
  const oldest = await redis.zrange(setKey, 0, overflow - 1);
  if (oldest && oldest.length > 0) {
    await redis.zremrangebyrank(setKey, 0, overflow - 1);
    for (const oldId of oldest) await redis.del(`${keyPrefix}${oldId}`);
  }
}

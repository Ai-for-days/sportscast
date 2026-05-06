// ── Step 105: Data Source Confidence & Weather Evidence Center ──────────────
//
// Advisory-only weather-data evidence. Operators capture observed values from
// multiple sources, the lib computes consensus / spread / confidence / verdict,
// and flags conflicts that need human review. NEVER grades or voids wagers,
// never settles balances, never changes pricing, never mutates wager records.
// Writes are confined to weather-evidence:* and the audit log.

import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';

// ── Types ────────────────────────────────────────────────────────────────────

export type EvidenceVerdict =
  | 'strong_evidence'
  | 'mixed_evidence'
  | 'insufficient_evidence'
  | 'conflict_requires_review';

export type RecommendedUse =
  | 'safe_for_manual_grading'
  | 'review_before_grading'
  | 'do_not_grade_without_more_data';

export type SourceConfidence = 'low' | 'medium' | 'high' | 'unknown';

export interface SourceObservation {
  sourceName: string;          // e.g. "NWS station KCLT", "Open-Meteo", "weather.com"
  observedValue: number;       // numeric — required for consensus math
  unit: string;                // free-form, e.g. "°F", "mph"
  observedAt: string;          // ISO 8601
  stationId?: string;
  confidence: SourceConfidence;
  notes: string[];
}

export interface WeatherEvidenceRecord {
  id: string;
  createdAt: string;
  createdBy: string;
  wagerId?: string;            // optional link
  /** Free-form location description; we don't bind to wager-store locations to avoid coupling. */
  location: string;
  metric: string;              // e.g. "actual_temp", "high_temp", custom
  targetDate: string;          // YYYY-MM-DD
  targetTime?: string;         // HH:MM if relevant
  sources: SourceObservation[];
  consensusValue?: number;
  sourceSpread?: number;
  confidenceScore: number;     // 0..100
  verdict: EvidenceVerdict;
  warnings: string[];
  recommendedUse: RecommendedUse;
  notes: string[];
}

export interface EvidenceSummary {
  total: number;
  byVerdict: Record<EvidenceVerdict, number>;
  byRecommendedUse: Record<RecommendedUse, number>;
  conflictCount: number;
  insufficientCount: number;
  averageConfidence: number | null;
  linkedToWagers: number;
}

export class WeatherEvidenceError extends Error {
  constructor(message: string, public code: string) { super(message); }
}

// ── Storage keys / caps ──────────────────────────────────────────────────────

const EVIDENCE_PREFIX = 'weather-evidence:';
const EVIDENCE_SET = 'weather-evidence:all';
const EVIDENCE_BY_WAGER_PREFIX = 'weather-evidence:wager:';
const MAX_EVIDENCE = 2000;

// ── Tolerance per metric ────────────────────────────────────────────────────

const TOLERANCES: { match: (m: string) => boolean; tolerance: number; unit: string }[] = [
  { match: m => /temp/i.test(m), tolerance: 1.5, unit: '°F' },
  { match: m => /gust/i.test(m), tolerance: 5, unit: 'mph' },
  { match: m => /wind/i.test(m), tolerance: 3, unit: 'mph' },
];
const DEFAULT_TOLERANCE = 2;

export function toleranceForMetric(metric: string): { tolerance: number; unit?: string } {
  for (const t of TOLERANCES) if (t.match(metric)) return { tolerance: t.tolerance, unit: t.unit };
  return { tolerance: DEFAULT_TOLERANCE };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function newEvidenceId(): string {
  return `wev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function nowIso(): string { return new Date().toISOString(); }
function isValidYmd(s: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(s); }

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ── Compute verdict / confidence ────────────────────────────────────────────

interface ComputeOutput {
  consensusValue?: number;
  sourceSpread?: number;
  confidenceScore: number;
  verdict: EvidenceVerdict;
  recommendedUse: RecommendedUse;
  warnings: string[];
}

function computeFrom(sources: SourceObservation[], metric: string, opts: { hasManualOverrideNote?: boolean }): ComputeOutput {
  const out: ComputeOutput = {
    confidenceScore: 0,
    verdict: 'insufficient_evidence',
    recommendedUse: 'do_not_grade_without_more_data',
    warnings: [],
  };

  const numericSources = sources.filter(s => Number.isFinite(s.observedValue));
  const values = numericSources.map(s => s.observedValue);

  if (numericSources.length !== sources.length) {
    out.warnings.push(`${sources.length - numericSources.length} source(s) had non-numeric observedValue and were excluded from consensus.`);
  }

  if (numericSources.length === 0) {
    out.warnings.push('No usable numeric source observations.');
    return out;
  }

  const consensus = median(values);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min;
  out.consensusValue = consensus ?? undefined;
  out.sourceSpread = spread;

  const tol = toleranceForMetric(metric);
  const tolerance = tol.tolerance;

  // Confidence: start at 100, deduct for spread, single source, low-confidence sources, unit mismatch
  let score = 100;

  if (numericSources.length === 1) {
    score -= 30;
    out.warnings.push('Only one source — single-source evidence is fragile.');
  } else if (numericSources.length === 2) {
    score -= 10;
    out.warnings.push('Only two sources — third-source corroboration recommended for borderline cases.');
  }

  // Spread vs tolerance
  if (spread > tolerance * 2) {
    score -= 50;
    out.warnings.push(`Spread ${spread.toFixed(2)} is more than 2× the tolerance (${tolerance}) for ${metric}.`);
  } else if (spread > tolerance) {
    score -= 25;
    out.warnings.push(`Spread ${spread.toFixed(2)} exceeds the tolerance (${tolerance}) for ${metric}.`);
  } else if (spread > tolerance * 0.5) {
    score -= 8;
  }

  // Per-source confidence labels
  const lowConfCount = numericSources.filter(s => s.confidence === 'low' || s.confidence === 'unknown').length;
  if (lowConfCount > 0) {
    score -= Math.min(20, lowConfCount * 8);
    out.warnings.push(`${lowConfCount} source(s) tagged as low/unknown confidence.`);
  }

  // Unit mismatch within sources
  const units = new Set(numericSources.map(s => s.unit?.trim() || ''));
  if (units.size > 1) {
    score -= 15;
    out.warnings.push(`Sources use ${units.size} different unit labels (${Array.from(units).join(', ')}). Confirm values are converted to a single unit.`);
  } else if (tol.unit) {
    const u = Array.from(units)[0];
    if (u && tol.unit && u.toLowerCase().replace(/\s/g, '') !== tol.unit.toLowerCase().replace(/\s/g, '')) {
      // Soft mismatch warning only
      out.warnings.push(`Source unit "${u}" doesn't match the typical unit "${tol.unit}" for ${metric}. Confirm units before grading.`);
      score -= 5;
    }
  }

  // ObservedAt sanity: stale > 24h before targetDate or far after?
  for (const s of numericSources) {
    const t = new Date(s.observedAt).getTime();
    if (!Number.isFinite(t)) {
      score -= 5;
      out.warnings.push(`Source "${s.sourceName}" has an invalid observedAt — review.`);
    }
  }

  score = Math.max(0, Math.min(100, score));
  out.confidenceScore = Math.round(score);

  // Verdict
  if (numericSources.length < 2 && !opts.hasManualOverrideNote) {
    out.verdict = 'insufficient_evidence';
    out.recommendedUse = 'do_not_grade_without_more_data';
    return out;
  }

  if (spread > tolerance) {
    out.verdict = 'conflict_requires_review';
    out.recommendedUse = 'do_not_grade_without_more_data';
    return out;
  }

  if (numericSources.length >= 2 && spread <= tolerance * 0.5 && lowConfCount === 0 && units.size <= 1) {
    out.verdict = 'strong_evidence';
    out.recommendedUse = 'safe_for_manual_grading';
  } else {
    out.verdict = 'mixed_evidence';
    out.recommendedUse = 'review_before_grading';
  }

  return out;
}

// ── Persistence ──────────────────────────────────────────────────────────────

async function saveRecord(rec: WeatherEvidenceRecord): Promise<void> {
  const redis = getRedis();
  await redis.set(`${EVIDENCE_PREFIX}${rec.id}`, JSON.stringify(rec));
}

export async function getEvidence(id: string): Promise<WeatherEvidenceRecord | null> {
  if (!id) return null;
  const redis = getRedis();
  const raw = await redis.get(`${EVIDENCE_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : (raw as WeatherEvidenceRecord);
}

export async function listEvidence(limit = 200): Promise<WeatherEvidenceRecord[]> {
  const redis = getRedis();
  const total = await redis.zcard(EVIDENCE_SET);
  if (total === 0) return [];
  const ids = await redis.zrange(EVIDENCE_SET, 0, Math.min(total, limit) - 1, { rev: true });
  const out: WeatherEvidenceRecord[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${EVIDENCE_PREFIX}${id}`);
    if (raw) out.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }
  return out;
}

export async function listEvidenceForWager(wagerId: string): Promise<WeatherEvidenceRecord[]> {
  if (!wagerId) return [];
  const redis = getRedis();
  const ids = await redis.zrange(`${EVIDENCE_BY_WAGER_PREFIX}${wagerId}`, 0, -1, { rev: true });
  if (!ids || ids.length === 0) return [];
  const out: WeatherEvidenceRecord[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${EVIDENCE_PREFIX}${id}`);
    if (raw) out.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }
  return out;
}

// ── Create ───────────────────────────────────────────────────────────────────

export interface CreateEvidenceInput {
  wagerId?: string;
  location: string;
  metric: string;
  targetDate: string;
  targetTime?: string;
  sources: Array<{
    sourceName: string;
    observedValue: number | string;
    unit: string;
    observedAt: string;
    stationId?: string;
    confidence?: SourceConfidence;
    notes?: string[];
  }>;
  notes?: string[];
}

export async function createManualEvidence(input: CreateEvidenceInput, actor: string): Promise<WeatherEvidenceRecord> {
  if (!actor) throw new WeatherEvidenceError('actor is required', 'actor_required');
  if (!input.location?.trim()) throw new WeatherEvidenceError('location is required', 'location_required');
  if (!input.metric?.trim()) throw new WeatherEvidenceError('metric is required', 'metric_required');
  if (!input.targetDate || !isValidYmd(input.targetDate)) {
    throw new WeatherEvidenceError('targetDate must be YYYY-MM-DD', 'invalid_date');
  }
  if (!Array.isArray(input.sources) || input.sources.length === 0) {
    throw new WeatherEvidenceError('At least one source observation is required', 'sources_required');
  }
  if (input.targetTime && !/^\d{2}:\d{2}$/.test(input.targetTime)) {
    throw new WeatherEvidenceError('targetTime must be HH:MM', 'invalid_target_time');
  }

  // Normalize sources
  const sources: SourceObservation[] = input.sources.map((s, idx) => {
    if (!s.sourceName?.trim()) throw new WeatherEvidenceError(`sources[${idx}].sourceName is required`, 'source_name_required');
    if (!s.unit?.trim()) throw new WeatherEvidenceError(`sources[${idx}].unit is required`, 'source_unit_required');
    if (!s.observedAt) throw new WeatherEvidenceError(`sources[${idx}].observedAt is required`, 'source_observedAt_required');
    const v = Number(s.observedValue);
    if (!Number.isFinite(v)) throw new WeatherEvidenceError(`sources[${idx}].observedValue must be numeric`, 'source_value_invalid');
    return {
      sourceName: s.sourceName.trim(),
      observedValue: v,
      unit: s.unit.trim(),
      observedAt: s.observedAt,
      stationId: s.stationId?.trim() || undefined,
      confidence: (s.confidence ?? 'medium') as SourceConfidence,
      notes: (s.notes ?? []).map(n => n.trim()).filter(Boolean),
    };
  });

  const notes = (input.notes ?? []).map(n => n.trim()).filter(Boolean);
  const hasManualOverrideNote = notes.some(n => /override|verified|single-source-ok/i.test(n));
  const computed = computeFrom(sources, input.metric.trim(), { hasManualOverrideNote });

  const id = newEvidenceId();
  const now = nowIso();
  const rec: WeatherEvidenceRecord = {
    id,
    createdAt: now,
    createdBy: actor,
    wagerId: input.wagerId?.trim() || undefined,
    location: input.location.trim(),
    metric: input.metric.trim(),
    targetDate: input.targetDate,
    targetTime: input.targetTime?.trim() || undefined,
    sources,
    consensusValue: computed.consensusValue,
    sourceSpread: computed.sourceSpread,
    confidenceScore: computed.confidenceScore,
    verdict: computed.verdict,
    warnings: computed.warnings,
    recommendedUse: computed.recommendedUse,
    notes: notes.map(n => `[${now}] ${actor}: ${n}`),
  };

  await saveRecord(rec);
  const redis = getRedis();
  await redis.zadd(EVIDENCE_SET, { score: Date.now(), member: id });
  if (rec.wagerId) {
    await redis.zadd(`${EVIDENCE_BY_WAGER_PREFIX}${rec.wagerId}`, { score: Date.now(), member: id });
  }
  await trimToCap(redis);

  await logAuditEvent({
    actor,
    eventType: 'weather_evidence_created',
    targetType: 'weather_evidence',
    targetId: id,
    summary: `Weather evidence ${id} created (${rec.metric} @ ${rec.location}, ${sources.length} source(s), verdict=${computed.verdict})`,
    details: {
      id, wagerId: rec.wagerId, metric: rec.metric, location: rec.location,
      sourceCount: sources.length, verdict: computed.verdict,
      confidenceScore: computed.confidenceScore, recommendedUse: computed.recommendedUse,
    },
  });

  return rec;
}

// ── Add note ────────────────────────────────────────────────────────────────

export async function addEvidenceNote(id: string, note: string, actor: string): Promise<WeatherEvidenceRecord> {
  if (!actor) throw new WeatherEvidenceError('actor is required', 'actor_required');
  if (!note?.trim()) throw new WeatherEvidenceError('note is required', 'note_required');

  const rec = await getEvidence(id);
  if (!rec) throw new WeatherEvidenceError('Evidence not found', 'evidence_not_found');

  const stamped = `[${nowIso()}] ${actor}: ${note.trim()}`;
  rec.notes = [...(rec.notes ?? []), stamped].slice(-200);
  await saveRecord(rec);

  await logAuditEvent({
    actor,
    eventType: 'weather_evidence_note_added',
    targetType: 'weather_evidence',
    targetId: id,
    summary: `Note added to weather evidence ${id}`,
    details: { id, wagerId: rec.wagerId },
  });

  return rec;
}

// ── Link to wager ───────────────────────────────────────────────────────────

export async function linkToWager(id: string, wagerId: string, actor: string): Promise<WeatherEvidenceRecord> {
  if (!actor) throw new WeatherEvidenceError('actor is required', 'actor_required');
  if (!wagerId?.trim()) throw new WeatherEvidenceError('wagerId is required', 'wager_required');

  const rec = await getEvidence(id);
  if (!rec) throw new WeatherEvidenceError('Evidence not found', 'evidence_not_found');

  const previous = rec.wagerId;
  rec.wagerId = wagerId.trim();
  await saveRecord(rec);

  const redis = getRedis();
  if (previous && previous !== rec.wagerId) {
    await redis.zrem(`${EVIDENCE_BY_WAGER_PREFIX}${previous}`, id);
  }
  await redis.zadd(`${EVIDENCE_BY_WAGER_PREFIX}${rec.wagerId}`, { score: Date.now(), member: id });

  await logAuditEvent({
    actor,
    eventType: 'weather_evidence_linked_to_wager',
    targetType: 'weather_evidence',
    targetId: id,
    summary: `Weather evidence ${id} linked to wager ${rec.wagerId}${previous ? ` (was ${previous})` : ''}`,
    details: { id, wagerId: rec.wagerId, previousWagerId: previous },
  });

  return rec;
}

// ── Summary ─────────────────────────────────────────────────────────────────

export async function getEvidenceSummary(): Promise<EvidenceSummary> {
  const recs = await listEvidence(500);
  const byVerdict: Record<EvidenceVerdict, number> = {
    strong_evidence: 0, mixed_evidence: 0, insufficient_evidence: 0, conflict_requires_review: 0,
  };
  const byRecommendedUse: Record<RecommendedUse, number> = {
    safe_for_manual_grading: 0, review_before_grading: 0, do_not_grade_without_more_data: 0,
  };
  let conflictCount = 0;
  let insufficientCount = 0;
  let scoreSum = 0;
  let scoreCount = 0;
  let linkedToWagers = 0;

  for (const r of recs) {
    byVerdict[r.verdict]++;
    byRecommendedUse[r.recommendedUse]++;
    if (r.verdict === 'conflict_requires_review') conflictCount++;
    if (r.verdict === 'insufficient_evidence') insufficientCount++;
    if (Number.isFinite(r.confidenceScore)) { scoreSum += r.confidenceScore; scoreCount++; }
    if (r.wagerId) linkedToWagers++;
  }

  return {
    total: recs.length,
    byVerdict,
    byRecommendedUse,
    conflictCount,
    insufficientCount,
    averageConfidence: scoreCount === 0 ? null : Math.round(scoreSum / scoreCount),
    linkedToWagers,
  };
}

// ── Trim ─────────────────────────────────────────────────────────────────────

async function trimToCap(redis: any) {
  const total = await redis.zcard(EVIDENCE_SET);
  if (total <= MAX_EVIDENCE) return;
  const overflow = total - MAX_EVIDENCE;
  const oldest = await redis.zrange(EVIDENCE_SET, 0, overflow - 1) as string[];
  if (oldest && oldest.length > 0) {
    await redis.zremrangebyrank(EVIDENCE_SET, 0, overflow - 1);
    for (const oldId of oldest) {
      await redis.del(`${EVIDENCE_PREFIX}${oldId}`);
      // Note: by-wager pointers aren't cleaned here; next list-by-wager call will skip
      // missing records via the get-then-skip pattern (raw is null → no push).
    }
  }
}

import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface Experiment {
  id: string;
  createdAt: string;
  updatedAt: string;
  family: string;
  name: string;
  description?: string;
  baselineVersion: string;
  candidateVersion: string;
  status: 'draft' | 'running' | 'completed' | 'cancelled';
  notes?: string;
  results?: ExperimentResults;
}

export interface ExperimentResults {
  experimentId: string;
  completedAt: string;
  metrics: {
    sampleSize?: number;
    avgEdge?: number;
    avgScore?: number;
    pnlCents?: number;
    fillRate?: number;
    winRate?: number;
    closingLinePerformance?: number;
  };
  baselineMetrics?: Record<string, number>;
  candidateMetrics?: Record<string, number>;
  conclusion?: string;
}

/* ------------------------------------------------------------------ */
/*  Redis keys                                                         */
/* ------------------------------------------------------------------ */

const EXPERIMENT_PREFIX = 'experiment:';
const EXPERIMENT_SET = 'experiments:all';

/* ------------------------------------------------------------------ */
/*  CRUD                                                               */
/* ------------------------------------------------------------------ */

export async function saveExperiment(exp: Experiment): Promise<void> {
  const redis = getRedis();
  await redis.set(`${EXPERIMENT_PREFIX}${exp.id}`, JSON.stringify(exp));
  await redis.zadd(EXPERIMENT_SET, { score: Date.now(), member: exp.id });
}

export async function getExperiment(id: string): Promise<Experiment | null> {
  const redis = getRedis();
  const raw = await redis.get(`${EXPERIMENT_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as Experiment;
}

export async function listExperiments(): Promise<Experiment[]> {
  const redis = getRedis();
  const ids = await redis.zrange(EXPERIMENT_SET, 0, -1, { rev: true });
  if (!ids || ids.length === 0) return [];

  const experiments: Experiment[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${EXPERIMENT_PREFIX}${id}`);
    if (raw) {
      experiments.push(typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as Experiment);
    }
  }
  return experiments;
}

/* ------------------------------------------------------------------ */
/*  Create experiment                                                  */
/* ------------------------------------------------------------------ */

export async function createExperiment(input: {
  family: string;
  name: string;
  description?: string;
  baselineVersion: string;
  candidateVersion: string;
  notes?: string;
}): Promise<Experiment> {
  const exp: Experiment = {
    id: `exp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    family: input.family,
    name: input.name,
    description: input.description,
    baselineVersion: input.baselineVersion,
    candidateVersion: input.candidateVersion,
    status: 'draft',
    notes: input.notes,
  };

  await saveExperiment(exp);

  await logAuditEvent({
    actor: 'admin',
    eventType: 'experiment_created',
    targetType: 'experiment',
    targetId: exp.id,
    summary: `Experiment created: ${exp.name} (${exp.family} ${exp.baselineVersion} vs ${exp.candidateVersion})`,
  });

  return exp;
}

/* ------------------------------------------------------------------ */
/*  Update experiment status                                           */
/* ------------------------------------------------------------------ */

export async function updateExperimentStatus(
  id: string,
  status: Experiment['status'],
  results?: ExperimentResults,
  notes?: string,
): Promise<Experiment | null> {
  const exp = await getExperiment(id);
  if (!exp) return null;

  exp.status = status;
  exp.updatedAt = new Date().toISOString();
  if (results) exp.results = results;
  if (notes) exp.notes = notes;

  await saveExperiment(exp);

  if (status === 'completed') {
    await logAuditEvent({
      actor: 'admin',
      eventType: 'experiment_completed',
      targetType: 'experiment',
      targetId: id,
      summary: `Experiment completed: ${exp.name}`,
      details: { results },
    });
  }

  return exp;
}

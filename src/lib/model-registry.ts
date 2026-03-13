import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ModelVersion {
  id: string;
  family: string;
  version: string;
  name: string;
  description?: string;
  createdAt: string;
  status: 'draft' | 'active' | 'archived';
  parameters?: any;
  notes?: string;
  createdBy: 'admin';
}

export const MODEL_FAMILIES = [
  'forecast_verification_v2',
  'forecast_consensus',
  'bookmaker_pricing',
  'signal_ranking',
  'portfolio_sizing',
  'hedging_engine',
  'kalshi_signals',
] as const;

export type ModelFamily = typeof MODEL_FAMILIES[number];

/* ------------------------------------------------------------------ */
/*  Redis keys                                                         */
/* ------------------------------------------------------------------ */

const MODEL_PREFIX = 'model:version:';
const MODEL_SET = 'model:versions:all';
const ACTIVE_PREFIX = 'model:active:';

/* ------------------------------------------------------------------ */
/*  CRUD                                                               */
/* ------------------------------------------------------------------ */

export async function saveModelVersion(model: ModelVersion): Promise<void> {
  const redis = getRedis();
  await redis.set(`${MODEL_PREFIX}${model.id}`, JSON.stringify(model));
  await redis.zadd(MODEL_SET, { score: Date.now(), member: model.id });
}

export async function getModelVersion(id: string): Promise<ModelVersion | null> {
  const redis = getRedis();
  const raw = await redis.get(`${MODEL_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as ModelVersion;
}

export async function listModelVersions(): Promise<ModelVersion[]> {
  const redis = getRedis();
  const ids = await redis.zrange(MODEL_SET, 0, -1, { rev: true });
  if (!ids || ids.length === 0) return [];

  const models: ModelVersion[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${MODEL_PREFIX}${id}`);
    if (raw) {
      models.push(typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as ModelVersion);
    }
  }
  return models;
}

export async function listVersionsByFamily(family: string): Promise<ModelVersion[]> {
  const all = await listModelVersions();
  return all.filter(m => m.family === family);
}

/* ------------------------------------------------------------------ */
/*  Active version management                                          */
/* ------------------------------------------------------------------ */

export async function getActiveVersion(family: string): Promise<ModelVersion | null> {
  const redis = getRedis();
  const activeId = await redis.get(`${ACTIVE_PREFIX}${family}`);
  if (!activeId) return null;
  const id = typeof activeId === 'string' ? activeId : String(activeId);
  return getModelVersion(id);
}

export async function getActiveVersions(): Promise<Record<string, ModelVersion | null>> {
  const result: Record<string, ModelVersion | null> = {};
  for (const family of MODEL_FAMILIES) {
    result[family] = await getActiveVersion(family);
  }
  return result;
}

export async function promoteVersion(id: string): Promise<ModelVersion | null> {
  const model = await getModelVersion(id);
  if (!model) return null;

  // Demote current active
  const current = await getActiveVersion(model.family);
  if (current && current.id !== id) {
    current.status = 'draft';
    await saveModelVersion(current);
  }

  // Promote new version
  model.status = 'active';
  await saveModelVersion(model);

  const redis = getRedis();
  await redis.set(`${ACTIVE_PREFIX}${model.family}`, model.id);

  await logAuditEvent({
    actor: 'admin',
    eventType: 'model_version_promoted',
    targetType: 'model-version',
    targetId: id,
    summary: `Model promoted: ${model.family} → ${model.version} (${model.name})`,
    details: { family: model.family, version: model.version, previousId: current?.id },
  });

  await logAuditEvent({
    actor: 'admin',
    eventType: 'active_model_changed',
    targetType: 'model-family',
    targetId: model.family,
    summary: `Active model changed: ${model.family} now ${model.version}`,
  });

  return model;
}

export async function archiveVersion(id: string): Promise<ModelVersion | null> {
  const model = await getModelVersion(id);
  if (!model) return null;

  if (model.status === 'active') {
    // Cannot archive the active version
    return null;
  }

  model.status = 'archived';
  await saveModelVersion(model);

  await logAuditEvent({
    actor: 'admin',
    eventType: 'model_version_archived',
    targetType: 'model-version',
    targetId: id,
    summary: `Model archived: ${model.family} ${model.version}`,
  });

  return model;
}

/* ------------------------------------------------------------------ */
/*  Create version                                                     */
/* ------------------------------------------------------------------ */

export async function createModelVersion(
  input: { family: string; version: string; name: string; description?: string; parameters?: any; notes?: string }
): Promise<ModelVersion> {
  const model: ModelVersion = {
    id: `mv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    family: input.family,
    version: input.version,
    name: input.name,
    description: input.description,
    createdAt: new Date().toISOString(),
    status: 'draft',
    parameters: input.parameters,
    notes: input.notes,
    createdBy: 'admin',
  };

  await saveModelVersion(model);

  await logAuditEvent({
    actor: 'admin',
    eventType: 'model_version_created',
    targetType: 'model-version',
    targetId: model.id,
    summary: `Model version created: ${model.family} ${model.version} (${model.name})`,
  });

  return model;
}

/* ------------------------------------------------------------------ */
/*  Initialize defaults                                                */
/* ------------------------------------------------------------------ */

export async function initializeDefaults(): Promise<void> {
  const actives = await getActiveVersions();

  const defaults: { family: string; version: string; name: string; description: string }[] = [
    { family: 'forecast_verification_v2', version: 'v2.0', name: 'V2 Scoring', description: 'Multi-factor forecast verification scoring' },
    { family: 'forecast_consensus', version: 'v1.0', name: 'Weighted Consensus', description: 'Source-weighted consensus engine' },
    { family: 'bookmaker_pricing', version: 'v1.0', name: 'Model-Based Pricing', description: 'Probability-to-odds bookmaker pricing' },
    { family: 'signal_ranking', version: 'v1.0', name: 'Composite Ranking', description: 'Edge + confidence + score weighted ranking' },
    { family: 'portfolio_sizing', version: 'v1.0', name: 'Tier-Based Sizing', description: 'Kelly-inspired tier-based position sizing' },
    { family: 'hedging_engine', version: 'v1.0', name: 'Risk-Based Hedging', description: 'Threshold-based hedging recommendations' },
    { family: 'kalshi_signals', version: 'v1.0', name: 'Edge Detection', description: 'Model vs market edge signal generation' },
  ];

  for (const d of defaults) {
    if (!actives[d.family]) {
      const model = await createModelVersion(d);
      await promoteVersion(model.id);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Helper: get current model tag for a family                         */
/* ------------------------------------------------------------------ */

export async function getModelTag(family: string): Promise<string> {
  const active = await getActiveVersion(family);
  if (!active) return `${family}:unknown`;
  return `${family}:${active.version}`;
}

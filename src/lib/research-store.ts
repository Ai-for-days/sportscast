import { getRedis } from './redis';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export const SNAPSHOT_FAMILIES = [
  'forecasts',
  'forecast_verification',
  'consensus',
  'pricing',
  'signals',
  'portfolio',
  'execution_candidates',
  'demo_orders',
  'live_orders',
  'settlements',
  'positions',
  'pnl',
  'health_alerts',
  'operator_daily',
  'active_models',
] as const;

export type SnapshotFamily = typeof SNAPSHOT_FAMILIES[number];

export interface Snapshot {
  id: string;
  snapshotDate: string;       // YYYY-MM-DD
  family: SnapshotFamily;
  createdAt: string;
  metadata?: any;
  payload: any;
}

/* ------------------------------------------------------------------ */
/*  Redis keys                                                          */
/* ------------------------------------------------------------------ */

const SNAP_PREFIX = 'snapshot:';
const SNAP_SET = 'snapshots:all';
const SNAP_FAMILY_SET = (f: string) => `snapshots:family:${f}`;
const SNAP_DATE_SET = (d: string) => `snapshots:date:${d}`;

/* ------------------------------------------------------------------ */
/*  Write (append-only — no update/delete exposed)                      */
/* ------------------------------------------------------------------ */

export async function writeSnapshot(
  family: SnapshotFamily,
  snapshotDate: string,
  payload: any,
  metadata?: any,
): Promise<Snapshot> {
  const snap: Snapshot = {
    id: `snap-${family}-${snapshotDate}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    snapshotDate,
    family,
    createdAt: new Date().toISOString(),
    metadata,
    payload,
  };

  const redis = getRedis();
  const score = Date.now();
  await redis.set(`${SNAP_PREFIX}${snap.id}`, JSON.stringify(snap));
  await redis.zadd(SNAP_SET, { score, member: snap.id });
  await redis.zadd(SNAP_FAMILY_SET(family), { score, member: snap.id });
  await redis.zadd(SNAP_DATE_SET(snapshotDate), { score, member: snap.id });

  return snap;
}

/* ------------------------------------------------------------------ */
/*  Read helpers                                                        */
/* ------------------------------------------------------------------ */

async function fetchSnapshots(ids: string[]): Promise<Snapshot[]> {
  const redis = getRedis();
  const snaps: Snapshot[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${SNAP_PREFIX}${id}`);
    if (raw) snaps.push(typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as Snapshot);
  }
  return snaps;
}

export async function getSnapshot(id: string): Promise<Snapshot | null> {
  const redis = getRedis();
  const raw = await redis.get(`${SNAP_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as Snapshot;
}

export async function listSnapshots(limit = 100): Promise<Snapshot[]> {
  const redis = getRedis();
  const ids = await redis.zrange(SNAP_SET, 0, limit - 1, { rev: true });
  return fetchSnapshots(ids || []);
}

export async function getSnapshotsByFamily(family: string, limit = 100): Promise<Snapshot[]> {
  const redis = getRedis();
  const ids = await redis.zrange(SNAP_FAMILY_SET(family), 0, limit - 1, { rev: true });
  return fetchSnapshots(ids || []);
}

export async function getSnapshotsByDate(date: string): Promise<Snapshot[]> {
  const redis = getRedis();
  const ids = await redis.zrange(SNAP_DATE_SET(date), 0, -1);
  return fetchSnapshots(ids || []);
}

export async function getLatestSnapshot(family: string): Promise<Snapshot | null> {
  const snaps = await getSnapshotsByFamily(family, 1);
  return snaps.length > 0 ? snaps[0] : null;
}

export async function getSnapshotSeries(family: string, limit = 30): Promise<Snapshot[]> {
  return getSnapshotsByFamily(family, limit);
}

export async function getSnapshotsByDateRange(family: string, from: string, to: string): Promise<Snapshot[]> {
  const all = await getSnapshotsByFamily(family, 500);
  return all.filter(s => s.snapshotDate >= from && s.snapshotDate <= to);
}

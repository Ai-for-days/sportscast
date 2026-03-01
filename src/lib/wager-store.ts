import { getRedis } from './redis';
import type {
  Wager, WagerStatus, WagerLocation, CreateWagerInput,
  OddsWager, OverUnderWager, PointspreadWager,
} from './wager-types';

// ── Redis key helpers ────────────────────────────────────────────────────────

const KEY = {
  wager: (id: string) => `wager:${id}`,
  byStatus: (status: WagerStatus) => `wagers:by-status:${status}`,
  byDate: (date: string) => `wagers:by-date:${date}`,
  all: 'wagers:all',
} as const;

function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `w_${ts}_${rand}`;
}

// ── NWS station resolver ─────────────────────────────────────────────────────

async function resolveNWSStation(lat: number, lon: number): Promise<{ stationId: string; timeZone: string }> {
  const pointsRes = await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, {
    headers: { 'User-Agent': 'WagerOnWeather/1.0 (contact@wageronweather.com)' },
  });
  if (!pointsRes.ok) {
    throw new Error(`NWS points API failed: ${pointsRes.status}`);
  }
  const pointsData = await pointsRes.json();
  const timeZone: string = pointsData.properties?.timeZone || 'America/New_York';
  const stationsUrl: string = pointsData.properties?.observationStations;

  if (!stationsUrl) {
    throw new Error('No observation stations URL returned from NWS');
  }

  const stationsRes = await fetch(stationsUrl, {
    headers: { 'User-Agent': 'WagerOnWeather/1.0 (contact@wageronweather.com)' },
  });
  if (!stationsRes.ok) {
    throw new Error(`NWS stations API failed: ${stationsRes.status}`);
  }
  const stationsData = await stationsRes.json();
  const firstStation = stationsData.features?.[0];
  if (!firstStation) {
    throw new Error('No observation stations found for this location');
  }

  const stationId: string = firstStation.properties?.stationIdentifier;
  return { stationId, timeZone };
}

async function buildWagerLocation(loc: { name: string; lat: number; lon: number }): Promise<WagerLocation> {
  const { stationId, timeZone } = await resolveNWSStation(loc.lat, loc.lon);
  return {
    name: loc.name,
    lat: loc.lat,
    lon: loc.lon,
    stationId,
    timeZone,
  };
}

// ── CRUD operations ──────────────────────────────────────────────────────────

export async function createWager(input: CreateWagerInput): Promise<Wager> {
  const redis = getRedis();
  const id = generateId();
  const now = new Date().toISOString();

  const base = {
    id,
    title: input.title.trim(),
    description: input.description?.trim(),
    status: 'open' as WagerStatus,
    metric: input.metric,
    targetDate: input.targetDate,
    lockTime: input.lockTime,
    createdAt: now,
    updatedAt: now,
  };

  let wager: Wager;

  if (input.kind === 'odds') {
    const location = await buildWagerLocation(input.location!);
    wager = { ...base, kind: 'odds', location, outcomes: input.outcomes! } as OddsWager;
  } else if (input.kind === 'over-under') {
    const location = await buildWagerLocation(input.location!);
    wager = { ...base, kind: 'over-under', location, line: input.line!, over: input.over!, under: input.under! } as OverUnderWager;
  } else {
    const [locationA, locationB] = await Promise.all([
      buildWagerLocation(input.locationA!),
      buildWagerLocation(input.locationB!),
    ]);
    wager = {
      ...base, kind: 'pointspread', locationA, locationB,
      spread: input.spread!, locationAOdds: input.locationAOdds!, locationBOdds: input.locationBOdds!,
    } as PointspreadWager;
  }

  const pipeline = redis.pipeline();
  pipeline.set(KEY.wager(id), JSON.stringify(wager));
  pipeline.zadd(KEY.byStatus('open'), { score: new Date(input.targetDate).getTime(), member: id });
  pipeline.sadd(KEY.byDate(input.targetDate), id);
  pipeline.zadd(KEY.all, { score: Date.now(), member: id });
  await pipeline.exec();

  return wager;
}

export async function getWager(id: string): Promise<Wager | null> {
  const redis = getRedis();
  const raw = await redis.get(KEY.wager(id));
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as Wager;
}

export interface ListOptions {
  status?: WagerStatus;
  limit?: number;
  cursor?: number; // offset
}

export async function listWagers(opts: ListOptions = {}): Promise<{ wagers: Wager[]; total: number }> {
  const redis = getRedis();
  const limit = Math.min(opts.limit || 20, 50);
  const offset = opts.cursor || 0;

  const key = opts.status ? KEY.byStatus(opts.status) : KEY.all;
  const total = await redis.zcard(key);
  const ids = await redis.zrange(key, offset, offset + limit - 1, { rev: true }) as string[];

  if (ids.length === 0) return { wagers: [], total };

  const pipeline = redis.pipeline();
  for (const id of ids) {
    pipeline.get(KEY.wager(id));
  }
  const results = await pipeline.exec();

  const wagers: Wager[] = [];
  for (const raw of results) {
    if (raw) {
      const w = typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as Wager;
      wagers.push(w);
    }
  }

  return { wagers, total };
}

export async function updateWager(id: string, updates: Partial<CreateWagerInput>): Promise<Wager | null> {
  const existing = await getWager(id);
  if (!existing) return null;
  if (existing.status !== 'open') {
    throw new Error('Can only edit open wagers');
  }

  const updated: Wager = {
    ...existing,
    ...updates,
    id: existing.id,
    kind: existing.kind,
    status: existing.status,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  } as Wager;

  // If location changed, re-resolve station
  if (updates.location && (existing.kind === 'odds' || existing.kind === 'over-under')) {
    (updated as OddsWager | OverUnderWager).location = await buildWagerLocation(updates.location);
  }

  const redis = getRedis();
  await redis.set(KEY.wager(id), JSON.stringify(updated));
  return updated;
}

export async function deleteWager(id: string): Promise<boolean> {
  const wager = await getWager(id);
  if (!wager) return false;

  const redis = getRedis();
  const pipeline = redis.pipeline();
  pipeline.del(KEY.wager(id));
  pipeline.zrem(KEY.byStatus(wager.status), id);
  pipeline.srem(KEY.byDate(wager.targetDate), id);
  pipeline.zrem(KEY.all, id);
  await pipeline.exec();
  return true;
}

async function changeStatus(id: string, from: WagerStatus, to: WagerStatus, extra?: Partial<Wager>): Promise<Wager | null> {
  const wager = await getWager(id);
  if (!wager || wager.status !== from) return null;

  const updated = { ...wager, ...extra, status: to, updatedAt: new Date().toISOString() } as Wager;

  const redis = getRedis();
  const pipeline = redis.pipeline();
  pipeline.set(KEY.wager(id), JSON.stringify(updated));
  pipeline.zrem(KEY.byStatus(from), id);
  pipeline.zadd(KEY.byStatus(to), { score: new Date(wager.targetDate).getTime(), member: id });
  await pipeline.exec();

  return updated;
}

export async function gradeWager(id: string, observedValue: number, winningOutcome: string): Promise<Wager | null> {
  const wager = await getWager(id);
  if (!wager || (wager.status !== 'locked' && wager.status !== 'open')) return null;

  return changeStatus(id, wager.status, 'graded', { observedValue, winningOutcome } as Partial<Wager>);
}

export async function voidWager(id: string, reason: string): Promise<Wager | null> {
  const wager = await getWager(id);
  if (!wager || wager.status === 'void') return null;

  return changeStatus(id, wager.status, 'void', { voidReason: reason } as Partial<Wager>);
}

export async function getWagersByDate(date: string): Promise<Wager[]> {
  const redis = getRedis();
  const ids = await redis.smembers(KEY.byDate(date)) as string[];
  if (ids.length === 0) return [];

  const pipeline = redis.pipeline();
  for (const id of ids) {
    pipeline.get(KEY.wager(id));
  }
  const results = await pipeline.exec();

  return results
    .filter(Boolean)
    .map(raw => typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as Wager);
}

export async function lockExpiredWagers(): Promise<string[]> {
  const redis = getRedis();
  const now = Date.now();

  // Get all open wager IDs
  const openIds = await redis.zrange(KEY.byStatus('open'), 0, -1) as string[];
  const locked: string[] = [];

  for (const id of openIds) {
    const wager = await getWager(id);
    if (!wager || wager.status !== 'open') continue;
    if (new Date(wager.lockTime).getTime() <= now) {
      await changeStatus(id, 'open', 'locked');
      locked.push(id);
    }
  }

  return locked;
}

import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';
import { getActiveVersions, MODEL_FAMILIES } from './model-registry';
import { getLatestSnapshot, getSnapshotsByDateRange } from './research-store';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export type AttributionMethod = 'direct' | 'inferred' | 'unknown';

export interface VersionAttribution {
  family: string;
  version: string;
  versionId: string;
  versionName: string;
  attributionMethodMix: { direct: number; inferred: number; unknown: number };
  records: number;
  signals: number;
  candidates: number;
  orders: number;
  fills: number;
  settled: number;
  grossPnlCents: number;
  netPnlCents: number;
  avgEdge: number;
  avgScore: number;
  winRate: number;
  fillRate: number;
  conversionRate: number;
}

export interface StackAttribution {
  stackSignature: string;
  stackVersions: Record<string, string>;
  records: number;
  netPnlCents: number;
  winRate: number;
  fillRate: number;
  avgEdge: number;
}

export interface AttributionOverview {
  totalAttributed: number;
  directCount: number;
  inferredCount: number;
  unknownCount: number;
  bestVersionByPnl: { family: string; version: string; netPnlCents: number } | null;
  bestVersionByWinRate: { family: string; version: string; winRate: number } | null;
  bestStack: { signature: string; netPnlCents: number } | null;
}

export interface AttributionFilters {
  family?: string;
  dateFrom?: string;
  dateTo?: string;
  source?: string;
  mode?: string;
  attributionMethod?: AttributionMethod;
  minSample?: number;
}

/* ------------------------------------------------------------------ */
/*  Tag extraction helpers                                              */
/* ------------------------------------------------------------------ */

function extractModelTag(record: any, family: string): { version: string; method: AttributionMethod } | null {
  // Direct: explicit modelVersion or modelTags field
  if (record.modelTags && record.modelTags[family]) {
    const tag = record.modelTags[family];
    const ver = typeof tag === 'string' ? tag.split(':').pop() || tag : tag.version || tag;
    return { version: String(ver), method: 'direct' };
  }
  if (record.modelVersion && record.modelFamily === family) {
    return { version: record.modelVersion, method: 'direct' };
  }
  // Check metadata
  if (record.metadata?.modelTags?.[family]) {
    const tag = record.metadata.modelTags[family];
    const ver = typeof tag === 'string' ? tag.split(':').pop() || tag : tag.version || tag;
    return { version: String(ver), method: 'direct' };
  }
  return null;
}

async function inferModelTag(family: string, dateStr: string): Promise<{ version: string; method: AttributionMethod } | null> {
  // Try to find nearest active_models snapshot
  const snaps = await getSnapshotsByDateRange('active_models', dateStr, dateStr);
  if (snaps.length > 0) {
    const payload = snaps[0].payload;
    if (payload && payload[family]) {
      return { version: payload[family].version || 'unknown', method: 'inferred' };
    }
  }
  // Fallback: latest active_models snapshot
  const latest = await getLatestSnapshot('active_models');
  if (latest?.payload?.[family]) {
    return { version: latest.payload[family].version || 'unknown', method: 'inferred' };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Build attribution from system data                                  */
/* ------------------------------------------------------------------ */

export async function buildAttribution(filters: AttributionFilters = {}): Promise<{
  versions: VersionAttribution[];
  stacks: StackAttribution[];
  overview: AttributionOverview;
}> {
  const redis = getRedis();

  // Collect records: signals, candidates, orders, settlements
  const records: { type: string; data: any; date: string }[] = [];

  // Signals
  const sigIds = await redis.zrange('kalshi-signals:all', 0, 500, { rev: true }) || [];
  for (const id of sigIds) {
    const raw = await redis.get(`kalshi-signal:${id}`);
    if (!raw) continue;
    const s = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const date = (s.createdAt || s.generatedAt || '').slice(0, 10);
    if (filters.dateFrom && date < filters.dateFrom) continue;
    if (filters.dateTo && date > filters.dateTo) continue;
    if (filters.source && s.source !== filters.source) continue;
    records.push({ type: 'signal', data: s, date });
  }

  // Candidates
  const candIds = await redis.zrange('exec-candidates:all', 0, 500, { rev: true }) || [];
  for (const id of candIds) {
    const raw = await redis.get(`exec-candidate:${id}`);
    if (!raw) continue;
    const c = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const date = (c.createdAt || '').slice(0, 10);
    if (filters.dateFrom && date < filters.dateFrom) continue;
    if (filters.dateTo && date > filters.dateTo) continue;
    records.push({ type: 'candidate', data: c, date });
  }

  // Demo orders
  const demoIds = await redis.zrange('demo-orders:all', 0, 500, { rev: true }) || [];
  for (const id of demoIds) {
    const raw = await redis.get(`demo-order:${id}`);
    if (!raw) continue;
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const date = (o.createdAt || '').slice(0, 10);
    if (filters.dateFrom && date < filters.dateFrom) continue;
    if (filters.dateTo && date > filters.dateTo) continue;
    if (filters.mode && filters.mode !== 'demo') continue;
    records.push({ type: 'order', data: { ...o, mode: 'demo' }, date });
  }

  // Live orders
  const liveIds = await redis.zrange('live-orders:all', 0, 500, { rev: true }) || [];
  for (const id of liveIds) {
    const raw = await redis.get(`live-order:${id}`);
    if (!raw) continue;
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const date = (o.createdAt || '').slice(0, 10);
    if (filters.dateFrom && date < filters.dateFrom) continue;
    if (filters.dateTo && date > filters.dateTo) continue;
    if (filters.mode && filters.mode !== 'live') continue;
    records.push({ type: 'order', data: { ...o, mode: 'live' }, date });
  }

  // Settlements
  const stlIds = await redis.zrange('settlements:all', 0, 500, { rev: true }) || [];
  for (const id of stlIds) {
    const raw = await redis.get(`settlement:${id}`);
    if (!raw) continue;
    const s = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const date = (s.createdAt || '').slice(0, 10);
    if (filters.dateFrom && date < filters.dateFrom) continue;
    if (filters.dateTo && date > filters.dateTo) continue;
    records.push({ type: 'settlement', data: s, date });
  }

  // Build per-version and per-stack attribution
  const versionMap = new Map<string, VersionAttribution>();
  const stackMap = new Map<string, StackAttribution>();
  let totalAttributed = 0, directCount = 0, inferredCount = 0, unknownCount = 0;

  const familyList = filters.family ? [filters.family] : [...MODEL_FAMILIES];

  for (const rec of records) {
    const stackVersions: Record<string, string> = {};
    let anyAttribution = false;

    for (const family of familyList) {
      let tag = extractModelTag(rec.data, family);
      let method: AttributionMethod = tag?.method || 'unknown';
      let version = tag?.version || '';

      if (!tag && rec.date) {
        const inferred = await inferModelTag(family, rec.date);
        if (inferred) { version = inferred.version; method = 'inferred'; }
      }

      if (!version) { method = 'unknown'; version = 'unknown'; }

      if (filters.attributionMethod && method !== filters.attributionMethod) continue;

      const key = `${family}:${version}`;
      stackVersions[family] = version;

      if (!versionMap.has(key)) {
        versionMap.set(key, {
          family, version, versionId: '', versionName: '',
          attributionMethodMix: { direct: 0, inferred: 0, unknown: 0 },
          records: 0, signals: 0, candidates: 0, orders: 0, fills: 0, settled: 0,
          grossPnlCents: 0, netPnlCents: 0, avgEdge: 0, avgScore: 0,
          winRate: 0, fillRate: 0, conversionRate: 0,
        });
      }

      const va = versionMap.get(key)!;
      va.records++;
      va.attributionMethodMix[method]++;
      if (method === 'direct') directCount++;
      else if (method === 'inferred') inferredCount++;
      else unknownCount++;
      anyAttribution = true;

      if (rec.type === 'signal') {
        va.signals++;
        va.avgEdge += rec.data.edge ?? rec.data.edgePct ?? 0;
        va.avgScore += rec.data.score ?? rec.data.compositeScore ?? 0;
      } else if (rec.type === 'candidate') {
        va.candidates++;
      } else if (rec.type === 'order') {
        va.orders++;
        if (rec.data.status === 'filled') va.fills++;
        va.grossPnlCents += rec.data.realizedPnlCents ?? rec.data.pnlCents ?? 0;
        va.netPnlCents += (rec.data.realizedPnlCents ?? rec.data.pnlCents ?? 0) - (rec.data.feesCents ?? 0);
      } else if (rec.type === 'settlement') {
        va.settled++;
        va.grossPnlCents += rec.data.grossPnlCents ?? 0;
        va.netPnlCents += rec.data.netPnlCents ?? 0;
      }
    }

    if (anyAttribution) totalAttributed++;

    // Stack attribution
    const sigKeys = Object.entries(stackVersions).sort((a, b) => a[0].localeCompare(b[0]));
    if (sigKeys.length > 0) {
      const sig = sigKeys.map(([f, v]) => `${f}:${v}`).join(' | ');
      if (!stackMap.has(sig)) {
        stackMap.set(sig, { stackSignature: sig, stackVersions: { ...stackVersions }, records: 0, netPnlCents: 0, winRate: 0, fillRate: 0, avgEdge: 0 });
      }
      const sa = stackMap.get(sig)!;
      sa.records++;
      if (rec.type === 'order') {
        sa.netPnlCents += (rec.data.realizedPnlCents ?? rec.data.pnlCents ?? 0) - (rec.data.feesCents ?? 0);
        if (rec.data.status === 'filled') sa.fillRate++;
        if ((rec.data.realizedPnlCents ?? rec.data.pnlCents ?? 0) > 0) sa.winRate++;
        sa.avgEdge += rec.data.edge ?? rec.data.edgePct ?? 0;
      }
    }
  }

  // Finalize averages
  const versions = [...versionMap.values()].map(va => {
    if (va.signals > 0) { va.avgEdge /= va.signals; va.avgScore /= va.signals; }
    if (va.orders > 0) { va.fillRate = va.fills / va.orders; va.winRate = va.netPnlCents > 0 ? va.fills / va.orders : 0; }
    if (va.signals > 0) { va.conversionRate = va.orders / va.signals; }
    return va;
  });

  const minSample = filters.minSample || 0;
  const filteredVersions = versions.filter(v => v.records >= minSample);

  const stacks = [...stackMap.values()].map(sa => {
    if (sa.records > 0) {
      sa.winRate = sa.records > 0 ? sa.winRate / sa.records : 0;
      sa.fillRate = sa.records > 0 ? sa.fillRate / sa.records : 0;
      sa.avgEdge = sa.records > 0 ? sa.avgEdge / sa.records : 0;
    }
    return sa;
  }).filter(s => s.records >= minSample);

  // Overview
  const bestPnl = filteredVersions.length > 0 ? filteredVersions.reduce((a, b) => a.netPnlCents > b.netPnlCents ? a : b) : null;
  const bestWR = filteredVersions.filter(v => v.orders >= 3).length > 0
    ? filteredVersions.filter(v => v.orders >= 3).reduce((a, b) => a.winRate > b.winRate ? a : b) : null;
  const bestStk = stacks.length > 0 ? stacks.reduce((a, b) => a.netPnlCents > b.netPnlCents ? a : b) : null;

  const overview: AttributionOverview = {
    totalAttributed,
    directCount,
    inferredCount,
    unknownCount,
    bestVersionByPnl: bestPnl ? { family: bestPnl.family, version: bestPnl.version, netPnlCents: bestPnl.netPnlCents } : null,
    bestVersionByWinRate: bestWR ? { family: bestWR.family, version: bestWR.version, winRate: bestWR.winRate } : null,
    bestStack: bestStk ? { signature: bestStk.stackSignature, netPnlCents: bestStk.netPnlCents } : null,
  };

  await logAuditEvent({
    actor: 'admin',
    eventType: 'model_attribution_run',
    targetType: 'system',
    targetId: 'model-attribution',
    summary: `Attribution run: ${totalAttributed} records, ${filteredVersions.length} versions, ${stacks.length} stacks`,
  });

  return { versions: filteredVersions, stacks, overview };
}

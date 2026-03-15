import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import { getRedis } from '../../../../lib/redis';

export const prerender = false;

interface PipelineStage {
  key: string; label: string; expectedCadence: string; expectedIntervalHours: number;
  indexKey: string; recordPrefix: string; status: string; lastRun: string | null; ageHours: number | null; nextExpected: string | null; summary: string;
}

const STAGES = [
  { key: 'forecast_ingestion', label: 'Forecast Ingestion', expectedCadence: 'Hourly', expectedIntervalHours: 1, indexKey: 'forecasts:all', recordPrefix: 'forecast:' },
  { key: 'verification', label: 'Verification', expectedCadence: 'After forecast update', expectedIntervalHours: 4, indexKey: 'verifications:all', recordPrefix: 'verification:' },
  { key: 'consensus', label: 'Consensus Generation', expectedCadence: 'After verification', expectedIntervalHours: 6, indexKey: 'consensus:all', recordPrefix: 'consensus:' },
  { key: 'pricing', label: 'Pricing / Market Generation', expectedCadence: 'After consensus', expectedIntervalHours: 12, indexKey: 'bookmaker:markets', recordPrefix: 'bookmaker:market:' },
  { key: 'signal_generation', label: 'Signal Generation', expectedCadence: 'Hourly', expectedIntervalHours: 1, indexKey: 'kalshi-signals:all', recordPrefix: 'kalshi-signal:' },
  { key: 'candidate_creation', label: 'Candidate Creation', expectedCadence: 'After signal generation', expectedIntervalHours: 4, indexKey: 'exec:candidates:all', recordPrefix: 'exec:candidate:' },
  { key: 'reconciliation', label: 'Reconciliation', expectedCadence: 'Daily', expectedIntervalHours: 24, indexKey: 'recon:runs:all', recordPrefix: 'recon:run:' },
  { key: 'settlement', label: 'Settlement', expectedCadence: 'After event resolution', expectedIntervalHours: 168, indexKey: 'settlements:all', recordPrefix: 'settlement:' },
];

async function computeCadence(): Promise<PipelineStage[]> {
  const redis = getRedis();
  const results: PipelineStage[] = [];

  for (const stage of STAGES) {
    const count = await redis.zcard(stage.indexKey);
    if (count === 0) {
      results.push({ ...stage, status: 'no_data', lastRun: null, ageHours: null, nextExpected: null, summary: `No records in ${stage.indexKey}` });
      continue;
    }

    const recentIds = await redis.zrange(stage.indexKey, 0, 0, { rev: true });
    let lastRun: string | null = null;
    let ageHours: number | null = null;

    if (recentIds && recentIds.length > 0) {
      const raw = await redis.get(`${stage.recordPrefix}${recentIds[0]}`);
      if (raw) {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw as any;
        lastRun = parsed.createdAt || parsed.timestamp || null;
        if (lastRun) {
          ageHours = Math.round((Date.now() - new Date(lastRun).getTime()) / (1000 * 60 * 60) * 10) / 10;
        }
      }
    }

    let status = 'no_data';
    if (ageHours !== null) {
      if (ageHours <= stage.expectedIntervalHours) status = 'on_schedule';
      else if (ageHours <= stage.expectedIntervalHours * 3) status = 'delayed';
      else status = 'stale';
    }

    const nextExpected = lastRun ? new Date(new Date(lastRun).getTime() + stage.expectedIntervalHours * 60 * 60 * 1000).toISOString() : null;
    const summary = ageHours !== null ? `Last run: ${ageHours}h ago. Expected cadence: ${stage.expectedCadence}. ${count} total records.` : `${count} records but unable to determine last run time.`;

    results.push({ ...stage, status, lastRun, ageHours, nextExpected, summary });
  }

  return results;
}

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  try {
    const stages = await computeCadence();
    const onSchedule = stages.filter(s => s.status === 'on_schedule').length;
    const delayed = stages.filter(s => s.status === 'delayed').length;
    const stale = stages.filter(s => s.status === 'stale').length;
    const noData = stages.filter(s => s.status === 'no_data').length;
    return new Response(JSON.stringify({ stages, summary: { total: stages.length, onSchedule, delayed, stale, noData } }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

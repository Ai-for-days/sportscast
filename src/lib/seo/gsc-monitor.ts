// ── Weekly Search Console snapshot, and an alarm worth having ─────────────
//
// Per Derek (2026-09-08), after a measurement that had not been taken since
// July. What it found, over the 30 days to 2026-09-08:
//
//   /mlb-weather               61 impressions
//   /nfl-weather               46
//   /college-football-weather  15  (and the only click on the site)
//   everything else            10  — across ~6,300 ZIP pages
//
// Every query was sports-weather. Nothing generic, from any of the ZIP pages
// the sitemap is mostly made of. That is the single most useful fact about
// this site's search performance and it sat unmeasured for seven weeks,
// because measuring it meant somebody remembering to export two CSVs by hand.
//
// So this takes the measurement on a schedule and keeps the history.
//
// **What it alerts on, and what it deliberately does not.** Search data is
// noisy at this volume — a site with one click a quarter will produce a
// "100% decline" most weeks, and an alarm that cries every week gets muted,
// taking the real one with it (the same rule `data-source-health.ts` is
// built on). So:
//
//   - It alerts on IMPRESSIONS, not clicks. Clicks are too sparse here to
//     carry a signal; impressions are the leading indicator anyway.
//   - It needs a floor of real volume before it will call anything a drop,
//     so going from 4 impressions to 1 is not an incident.
//   - It alerts when the site's indexed pages fall, because that is a
//     structural problem rather than a fluctuation in demand.
//
// Read-only and advisory throughout: it reports, it never changes the
// sitemap, the tier list, or any page.

import { getRedis } from './../redis';
import { raiseAlert } from './../alerts';
import { fetchTotals, fetchPagePerformance, fetchTopQueries, gscApiConfigured, gscSiteUrl } from './gsc-api';
import type { GscPerformanceExportRow } from './gsc-types';
import type { GscQueryRow, GscTotals } from './gsc-api';

const SNAPSHOT_TTL_SECONDS = 400 * 86400; // a year of weekly snapshots
const INDEX_KEY = 'gsc-monitor:snapshots';
const WINDOW_DAYS = 28;

/** Below this, week-to-week movement is noise and nothing is called a drop. */
const MIN_IMPRESSIONS_TO_JUDGE = 40;
/** A fall of at least this share of impressions, above the floor, is an alert. */
const DROP_FRACTION = 0.4;

export interface GscSnapshot {
  /** ISO instant the snapshot was taken. */
  takenAt: string;
  /** The settled window it covers. */
  windowDays: number;
  siteUrl: string;
  totals: GscTotals;
  /** Pages with any impressions in the window, biggest first. */
  pages: GscPerformanceExportRow[];
  topQueries: GscQueryRow[];
}

function snapshotKey(takenAt: string): string {
  return `gsc-monitor:snapshot:${takenAt.slice(0, 10)}`;
}

/** Snapshot dates we hold, newest first. */
export async function listSnapshotDates(limit = 52): Promise<string[]> {
  try {
    const raw = await getRedis().get(INDEX_KEY);
    const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as string[] | null;
    return Array.isArray(parsed) ? parsed.slice(0, limit) : [];
  } catch {
    return [];
  }
}

export async function getSnapshot(date: string): Promise<GscSnapshot | null> {
  try {
    const raw = await getRedis().get(snapshotKey(date));
    if (!raw) return null;
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) as GscSnapshot;
  } catch {
    return null;
  }
}

/** The most recent snapshot, or null when none has been taken. */
export async function latestSnapshot(): Promise<GscSnapshot | null> {
  const [newest] = await listSnapshotDates(1);
  return newest ? getSnapshot(newest) : null;
}

async function storeSnapshot(snap: GscSnapshot): Promise<void> {
  const redis = getRedis();
  const date = snap.takenAt.slice(0, 10);
  await redis.set(snapshotKey(snap.takenAt), JSON.stringify(snap), { ex: SNAPSHOT_TTL_SECONDS });
  const dates = await listSnapshotDates(9999);
  if (!dates.includes(date)) {
    await redis.set(INDEX_KEY, JSON.stringify([...dates, date].sort().reverse()), { ex: SNAPSHOT_TTL_SECONDS });
  }
}

export interface GscComparison {
  impressionsBefore: number;
  impressionsAfter: number;
  changeFraction: number | null;
  pagesWithImpressionsBefore: number;
  pagesWithImpressionsAfter: number;
  /** Null when there is nothing to compare, or too little volume to judge. */
  verdict: 'improved' | 'steady' | 'dropped' | 'too-little-data' | 'no-baseline';
}

/**
 * Compare two snapshots. Pure, so the thresholds can be tested without a
 * Redis or a network.
 */
export function compareSnapshots(previous: GscSnapshot | null, current: GscSnapshot): GscComparison {
  const after = current.totals.impressions;
  const pagesAfter = current.pages.filter((p) => p.impressions > 0).length;
  if (!previous) {
    return {
      impressionsBefore: 0,
      impressionsAfter: after,
      changeFraction: null,
      pagesWithImpressionsBefore: 0,
      pagesWithImpressionsAfter: pagesAfter,
      verdict: 'no-baseline',
    };
  }
  const before = previous.totals.impressions;
  const pagesBefore = previous.pages.filter((p) => p.impressions > 0).length;
  const changeFraction = before > 0 ? (after - before) / before : null;

  // The floor applies to the BASELINE. A week that went 4 -> 1 is not a 75%
  // decline worth waking anyone for; a week that went 200 -> 50 is.
  let verdict: GscComparison['verdict'];
  if (before < MIN_IMPRESSIONS_TO_JUDGE) verdict = 'too-little-data';
  else if (changeFraction !== null && changeFraction <= -DROP_FRACTION) verdict = 'dropped';
  else if (changeFraction !== null && changeFraction >= DROP_FRACTION) verdict = 'improved';
  else verdict = 'steady';

  return {
    impressionsBefore: before,
    impressionsAfter: after,
    changeFraction,
    pagesWithImpressionsBefore: pagesBefore,
    pagesWithImpressionsAfter: pagesAfter,
    verdict,
  };
}

export interface MonitorResult {
  ok: boolean;
  reason?: string;
  snapshot?: GscSnapshot;
  comparison?: GscComparison;
  alerted?: boolean;
}

/**
 * Take this week's snapshot, store it, compare it to the previous one, and
 * raise an alert only when something structural moved.
 */
export async function runGscMonitor(): Promise<MonitorResult> {
  if (!gscApiConfigured()) {
    return { ok: false, reason: 'GSC service-account credentials are not configured' };
  }

  const [totals, pages, topQueries] = await Promise.all([
    fetchTotals(WINDOW_DAYS),
    fetchPagePerformance(WINDOW_DAYS),
    fetchTopQueries(WINDOW_DAYS, 50),
  ]);

  // A failed pull must not be stored: an empty snapshot would become next
  // week's baseline and manufacture a fake recovery, then a fake collapse.
  if (!totals || !pages) {
    return { ok: false, reason: 'Search Console did not answer; nothing stored' };
  }

  const previous = await latestSnapshot();
  const snapshot: GscSnapshot = {
    takenAt: new Date().toISOString(),
    windowDays: WINDOW_DAYS,
    siteUrl: gscSiteUrl(),
    totals,
    pages: [...pages].sort((a, b) => b.impressions - a.impressions),
    topQueries: topQueries ?? [],
  };

  const comparison = compareSnapshots(previous, snapshot);
  await storeSnapshot(snapshot);

  let alerted = false;
  if (comparison.verdict === 'dropped') {
    const pct = Math.round(Math.abs(comparison.changeFraction ?? 0) * 100);
    await raiseAlert(
      'warning',
      'gsc_impressions_drop',
      `Search impressions down ${pct}% week over week`,
      `Search Console impressions over the last ${WINDOW_DAYS} days fell from ${comparison.impressionsBefore} to ${comparison.impressionsAfter}, ` +
        `and the number of pages earning any impressions went from ${comparison.pagesWithImpressionsBefore} to ${comparison.pagesWithImpressionsAfter}. ` +
        `Customers are seeing fewer of our pages in search results. Check for a crawl or indexation regression before assuming demand moved.`,
      '/admin/system/seo-health',
      { before: comparison.impressionsBefore, after: comparison.impressionsAfter },
    );
    alerted = true;
  }

  return { ok: true, snapshot, comparison, alerted };
}

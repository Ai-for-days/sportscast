import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSnapshots, type GscSnapshot } from '../src/lib/seo/gsc-monitor';
import { settledWindow, mapCoverageState, DATA_LAG_DAYS } from '../src/lib/seo/gsc-api';

// ── The weekly Search Console alarm ───────────────────────────────────────
//
// The whole risk with an alarm on search data at this site's volume is that
// it fires every week. A site with one click a quarter produces enormous
// percentage swings on tiny numbers, and a warning that cries weekly gets
// muted — taking the real one with it. That is the same rule
// data-source-health.ts is built on: alert when a customer would notice.
//
// So these pin the floor, not just the threshold.

function snap(impressions: number, pagesWithImpressions = 3): GscSnapshot {
  return {
    takenAt: '2026-09-08T12:00:00.000Z',
    windowDays: 28,
    siteUrl: 'sc-domain:wageronweather.com',
    totals: { clicks: 0, impressions, ctr: 0, position: 70 },
    pages: Array.from({ length: pagesWithImpressions }, (_, i) => ({
      url: `https://wageronweather.com/p${i}`,
      canonicalUrl: `https://wageronweather.com/p${i}`,
      impressions: 1,
      clicks: 0,
      ctr: 0,
      position: 70,
    })),
    topQueries: [],
  };
}

test('a big fall on tiny numbers is not an incident', () => {
  // 4 -> 1 is a 75% decline and means nothing. This is the case that would
  // have fired most weeks of the last quarter.
  const c = compareSnapshots(snap(4), snap(1));
  assert.equal(c.verdict, 'too-little-data');
});

test('a real fall on real volume is a drop', () => {
  const c = compareSnapshots(snap(200), snap(50));
  assert.equal(c.verdict, 'dropped');
  assert.equal(c.impressionsBefore, 200);
  assert.equal(c.impressionsAfter, 50);
});

test('ordinary week-to-week movement is steady, not an alert', () => {
  const c = compareSnapshots(snap(200), snap(170));
  assert.equal(c.verdict, 'steady');
});

test('a big rise is reported as improved rather than alerted on', () => {
  const c = compareSnapshots(snap(100), snap(300));
  assert.equal(c.verdict, 'improved');
});

test('the first ever snapshot has no baseline and cannot be a drop', () => {
  // Otherwise the very first run would alert on a fall from zero.
  const c = compareSnapshots(null, snap(500));
  assert.equal(c.verdict, 'no-baseline');
  assert.equal(c.changeFraction, null);
});

test('the floor is judged on the baseline, so growth off a small base is not muted into a drop', () => {
  const c = compareSnapshots(snap(10), snap(400));
  assert.equal(c.verdict, 'too-little-data', 'too small a baseline to judge either direction');
});

// ── The window we ask Search Console for ──────────────────────────────────

test('the window ends before the data-lag boundary, never today', () => {
  // GSC finalises on a lag; including the incomplete tail would make every
  // snapshot look like a decline against the last one.
  const now = new Date('2026-09-08T12:00:00Z');
  const w = settledWindow(28, now);
  assert.equal(w.endDate, '2026-09-05', `${DATA_LAG_DAYS} days back from the 8th`);
  assert.equal(w.startDate, '2026-08-09');
});

test('the window is the length asked for, inclusive of both ends', () => {
  const w = settledWindow(7, new Date('2026-09-08T12:00:00Z'));
  const days = (Date.parse(`${w.endDate}T00:00:00Z`) - Date.parse(`${w.startDate}T00:00:00Z`)) / 86400000 + 1;
  assert.equal(days, 7);
});

// ── Coverage prose to the enum gsc-types.ts already declares ──────────────

test('the two states this site actually sees map correctly', () => {
  // "Discovered - currently not indexed" is the dominant status on this
  // property (~39k URLs), so getting it wrong would misreport the main
  // problem the SEO work exists to fix.
  assert.equal(mapCoverageState('Discovered - currently not indexed', 'NEUTRAL'), 'discovered_not_indexed');
  assert.equal(mapCoverageState('Submitted and indexed', 'PASS'), 'submitted_and_indexed');
});

test('crawled-not-indexed is distinct from discovered-not-indexed', () => {
  // Different problems: one was fetched and rejected, the other was never
  // fetched at all. Collapsing them would hide which one we have.
  assert.equal(mapCoverageState('Crawled - currently not indexed', 'NEUTRAL'), 'crawled_not_indexed');
});

test('an unrecognised state is unknown rather than quietly counted as indexed', () => {
  assert.equal(mapCoverageState('Something new from Google', 'NEUTRAL'), 'unknown');
  assert.equal(mapCoverageState(undefined, undefined), 'unknown');
});

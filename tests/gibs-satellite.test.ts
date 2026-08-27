// ── Tests: NASA GIBS satellite layer ───────────────────────────────────
//
// The three ways GIBS differs from every other tile source on the map, pinned
// so a refactor cannot quietly undo them. See src/lib/gibs-satellite.ts.
//
// Rewritten 2026-08-27. The old live test asserted that a *computed* frame
// time resolves, which started failing because that premise is wrong: GIBS
// publishing lag varies, and individual frames go missing between two that
// exist. Measured that day at 16:50Z, 15:50Z was a 404 sitting between a
// healthy 15:40Z and a healthy 16:00Z, and the newest frame of any kind was
// 50 minutes old. So the code now probes instead of assuming, and these tests
// cover the probe, including the hole case, without needing the network.
//
// Run with `npm test`. Only the last test hits the network; it skips if offline.

import { test, skip } from 'node:test';
import assert from 'node:assert/strict';
import {
  gibsFrameTime,
  gibsCandidateTimes,
  gibsTileUrl,
  gibsProbeUrl,
  probeGibsFrameTime,
  getGibsFrameTime,
  resetGibsFrameCache,
  GIBS_PROBE_START_MINUTES,
  GIBS_FALLBACK_LAG_MINUTES,
  GIBS_PROBE_ATTEMPTS,
  GIBS_MAX_NATIVE_ZOOM,
  GIBS_MATRIX_SET,
} from '../src/lib/gibs-satellite';

const NOW = new Date('2026-08-12T14:37:22.481Z');

/** A fetch stand-in that answers 200 only for the frame times listed. */
function stubFetch(available: string[], onCall?: () => void) {
  return (async (url: string | URL | Request) => {
    onCall?.();
    const href = String(url);
    const ok = available.some(t => href.includes(t));
    return { ok, status: ok ? 200 : 404 } as Response;
  }) as unknown as typeof fetch;
}

// ── Frame time ─────────────────────────────────────────────────────────

test('the frame time is a whole 10-minute mark', () => {
  assert.match(gibsFrameTime(NOW), /T\d{2}:\d0:00Z$/);
});

test('seconds and milliseconds are cleared, not carried', () => {
  const t = gibsFrameTime(new Date('2026-08-12T14:00:59.999Z'));
  assert.match(t, /T\d{2}:\d0:00Z$/, `expected a clean 10-minute mark, got ${t}`);
});

test('the fallback frame time errs old, since nothing checked it', () => {
  const asked = new Date(gibsFrameTime(NOW));
  const lagMinutes = (NOW.getTime() - asked.getTime()) / 60_000;
  assert.equal(lagMinutes >= GIBS_FALLBACK_LAG_MINUTES, true, `fallback asked for imagery only ${lagMinutes} min old`);
  assert.ok(lagMinutes < GIBS_FALLBACK_LAG_MINUTES + 10, `${lagMinutes} min is more than one frame stale`);
});

test('the lag is applied before flooring, so it holds across a day boundary', () => {
  // 00:05Z minus the lag crosses back into the previous day.
  const t = gibsFrameTime(new Date('2026-08-12T00:05:00Z'));
  assert.ok(t.startsWith('2026-08-11T'), `expected the previous day, got ${t}`);
  assert.match(t, /T\d{2}:\d0:00Z$/);
});

// ── Candidates ─────────────────────────────────────────────────────────

test('candidates run newest first, exactly 10 minutes apart', () => {
  const times = gibsCandidateTimes(NOW, 4);
  assert.equal(times.length, 4);
  for (let i = 1; i < times.length; i++) {
    const gap = new Date(times[i - 1]).getTime() - new Date(times[i]).getTime();
    assert.equal(gap, 10 * 60_000, `candidates ${i - 1} and ${i} are not one frame apart`);
  }
});

test('the default candidate window reaches back two hours', () => {
  const times = gibsCandidateTimes(NOW);
  assert.equal(times.length, GIBS_PROBE_ATTEMPTS);
  const span = new Date(times[0]).getTime() - new Date(times[times.length - 1]).getTime();
  assert.ok(span >= 60 * 60_000, `probe window of ${span / 60_000} min is too narrow to ride out an outage`);
});

test('probing starts close to now, so the freshest frame wins', () => {
  // The point of probing rather than guessing: reach for recent imagery and
  // let GIBS say no, instead of pre-emptively settling for something stale.
  const newest = new Date(gibsCandidateTimes(NOW)[0]);
  const lagMinutes = (NOW.getTime() - newest.getTime()) / 60_000;
  assert.ok(lagMinutes >= GIBS_PROBE_START_MINUTES, `started ${lagMinutes} min back, ahead of the grid`);
  assert.ok(lagMinutes < 20, `probe starts ${lagMinutes} min back, too conservative to catch a fresh frame`);
});

// ── Probing ────────────────────────────────────────────────────────────

test('probes use HEAD, which is what makes a dozen of them affordable', async () => {
  const methods: string[] = [];
  const spy = (async (_url: unknown, init?: RequestInit) => {
    methods.push(init?.method ?? 'GET');
    return { ok: false, status: 404 } as Response;
  }) as unknown as typeof fetch;

  await probeGibsFrameTime(NOW, spy);
  assert.deepEqual([...new Set(methods)], ['HEAD'],
    'a GET probe downloads a ~50KB tile per candidate on a customer connection');
});

test('the probe takes the newest frame that actually exists', async () => {
  const times = gibsCandidateTimes(NOW);
  const found = await probeGibsFrameTime(NOW, stubFetch([times[0]]));
  assert.equal(found, times[0]);
});

test('the probe walks past a hole to the next published frame', async () => {
  // The exact 2026-08-27 shape: the two newest are missing, the third is fine.
  const times = gibsCandidateTimes(NOW);
  const found = await probeGibsFrameTime(NOW, stubFetch([times[2]]));
  assert.equal(found, times[2]);
});

test('the probe returns null when the whole window is empty', async () => {
  const found = await probeGibsFrameTime(NOW, stubFetch([]));
  assert.equal(found, null);
});

test('a network failure stops the walk instead of retrying twelve times', async () => {
  let calls = 0;
  const failing = (async () => { calls++; throw new Error('offline'); }) as unknown as typeof fetch;
  const found = await probeGibsFrameTime(NOW, failing);
  assert.equal(found, null);
  assert.equal(calls, 1, `an offline customer made ${calls} requests`);
});

// ── Caching ────────────────────────────────────────────────────────────
//
// The tile layer and the "as of" stamp both ask for the frame time. They must
// get one answer, or the map shows one moment while the caption names another.

test('two callers within the TTL share a single probe', async () => {
  resetGibsFrameCache();
  let calls = 0;
  const times = gibsCandidateTimes(NOW);
  const counting = stubFetch([times[0]], () => { calls++; });

  const a = await getGibsFrameTime(NOW, counting);
  const b = await getGibsFrameTime(NOW, counting);

  assert.equal(a, b, 'the imagery and its caption disagreed about the frame');
  assert.equal(calls, 1, `probed ${calls} times for one frame`);
});

test('a failed probe is not cached, so the next render tries again', async () => {
  resetGibsFrameCache();
  let calls = 0;
  const empty = stubFetch([], () => { calls++; });

  const first = await getGibsFrameTime(NOW, empty);
  const callsAfterFirst = calls;
  await getGibsFrameTime(NOW, empty);

  assert.equal(first, gibsFrameTime(NOW), 'a failed probe should fall back, not return null');
  assert.ok(calls > callsAfterFirst, 'a failure was cached, stranding the map on the fallback');
});

// ── URL shape ──────────────────────────────────────────────────────────

test('tiles are addressed {z}/{y}/{x}, not Leaflet default {z}/{x}/{y}', () => {
  // The whole point: WMTS is row-before-column. Reversing these does not throw
  // — it renders a convincing picture of somewhere else entirely.
  const url = gibsTileUrl('2026-08-12T13:50:00Z');
  assert.ok(url.endsWith('/{z}/{y}/{x}.png'), `wrong tile axis order: ${url}`);
  assert.ok(!url.includes('/{z}/{x}/{y}'), 'tile order was flipped to the XYZ convention');
});

test('the URL carries the matrix set that sets our zoom ceiling', () => {
  const url = gibsTileUrl('2026-08-12T13:50:00Z');
  assert.ok(url.includes(GIBS_MATRIX_SET));
  // Level7 publishes zoom 0-7. If the matrix set ever changes, this must too.
  assert.equal(GIBS_MAX_NATIVE_ZOOM, 7);
  assert.ok(GIBS_MATRIX_SET.endsWith(String(GIBS_MAX_NATIVE_ZOOM)),
    `matrix set ${GIBS_MATRIX_SET} disagrees with maxNativeZoom ${GIBS_MAX_NATIVE_ZOOM}`);
});

test('the probe URL is a single zoom-0 tile, not a template', () => {
  const url = gibsProbeUrl('2026-08-12T13:50:00Z');
  assert.ok(!url.includes('{'), `probe URL still has placeholders: ${url}`);
  assert.ok(url.endsWith('/0/0/0.png'), `probe should ask for the cheapest tile: ${url}`);
});

// ── Live contract ──────────────────────────────────────────────────────

test('GIBS is serving a frame somewhere in our probe window', async () => {
  // Deliberately asserts the property the product depends on (there is SOME
  // recent imagery to show) rather than that one guessed timestamp exists.
  let found: string | null;
  try {
    found = await probeGibsFrameTime(new Date(), (url, init) =>
      fetch(url as string, { ...init, signal: AbortSignal.timeout(15_000) }));
  } catch {
    return skip('no network');
  }
  if (found === null) return skip('GIBS published nothing in the last 2 hours');

  const res = await fetch(gibsProbeUrl(found));
  assert.equal(res.status, 200, `probe picked ${found} but it does not resolve`);
  assert.match(res.headers.get('content-type') ?? '', /image/);
});

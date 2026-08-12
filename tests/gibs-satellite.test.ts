// ── Tests: NASA GIBS satellite layer ───────────────────────────────────
//
// The three ways GIBS differs from every other tile source on the map, pinned
// so a refactor cannot quietly undo them. See src/lib/gibs-satellite.ts.
//
// Run with `npm test`. The last test hits the network and skips if offline.

import { test, skip } from 'node:test';
import assert from 'node:assert/strict';
import {
  gibsFrameTime,
  gibsTileUrl,
  GIBS_MAX_NATIVE_ZOOM,
  GIBS_MATRIX_SET,
} from '../src/lib/gibs-satellite';

// ── Frame time ─────────────────────────────────────────────────────────

test('the frame time is a whole 10-minute mark', () => {
  // 14:37Z minus the 40-minute lag is 13:57 -> floors to 13:50.
  assert.equal(gibsFrameTime(new Date('2026-08-12T14:37:22.481Z')), '2026-08-12T13:50:00Z');
});

test('seconds and milliseconds are cleared, not carried', () => {
  const t = gibsFrameTime(new Date('2026-08-12T14:00:59.999Z'));
  assert.match(t, /T\d{2}:\d0:00Z$/, `expected a clean 10-minute mark, got ${t}`);
});

test('the frame time never runs ahead of what GIBS has published', () => {
  const now = new Date('2026-08-12T14:37:22.481Z');
  const asked = new Date(gibsFrameTime(now));
  const lagMinutes = (now.getTime() - asked.getTime()) / 60_000;
  assert.ok(lagMinutes >= 40, `asked for imagery only ${lagMinutes} min old — GIBS will 404`);
  assert.ok(lagMinutes < 60, `asking for ${lagMinutes} min old imagery is needlessly stale`);
});

test('the lag is applied before flooring, so it holds across an hour boundary', () => {
  // 00:05Z minus 40 min crosses back into the previous day.
  assert.equal(gibsFrameTime(new Date('2026-08-12T00:05:00Z')), '2026-08-11T23:20:00Z');
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

// ── Live contract ──────────────────────────────────────────────────────

test('a real tile resolves at the frame time we compute', async t => {
  const url = gibsTileUrl(gibsFrameTime())
    .replace('{z}', '5').replace('{y}', '12').replace('{x}', '8'); // Columbia SC

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  } catch {
    return skip('no network');
  }

  assert.equal(res.status, 200, `GIBS rejected our frame time: ${url}`);
  assert.match(res.headers.get('content-type') ?? '', /image/);
});

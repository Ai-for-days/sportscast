// ── Tests: wind particle field ─────────────────────────────────────────
//
// The animated wind layer is cosmetic, but a cosmetic layer pointing the wrong
// way is worse than none — it looks authoritative. These pin the direction
// convention, the vector interpolation, and the edge-of-coverage behaviour.
// See src/lib/wind-particles.ts.
//
// Run with `npm test`. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toScreenVector,
  buildWindField,
  sampleWindField,
  buildScreenField,
  sampleScreenField,
  particleCount,
  frameDelta,
  type WindPoint,
} from '../src/lib/wind-particles';

const near = (a: number, b: number, tol = 1e-6, msg?: string) =>
  assert.ok(Math.abs(a - b) < tol, msg ?? `expected ${a} ≈ ${b}`);

// ── Direction convention ───────────────────────────────────────────────

test('a north wind blows DOWN the screen', () => {
  // dir 0 = wind FROM the north, so it travels south, and south is +y on a canvas.
  const v = toScreenVector(10, 0);
  near(v.dx, 0);
  near(v.dy, 10);
});

test('a west wind blows to the RIGHT', () => {
  const v = toScreenVector(10, 270);
  near(v.dx, 10);
  near(v.dy, 0);
});

test('an east wind blows to the LEFT', () => {
  const v = toScreenVector(10, 90);
  near(v.dx, -10);
  near(v.dy, 0);
});

test('a south wind blows UP the screen', () => {
  const v = toScreenVector(10, 180);
  near(v.dx, 0);
  near(v.dy, -10);
});

test('vector magnitude is the wind speed, at any angle', () => {
  for (const dir of [17, 45, 123, 200, 318]) {
    const v = toScreenVector(23, dir);
    near(Math.hypot(v.dx, v.dy), 23, 1e-5, `magnitude wrong at ${dir}°`);
  }
});

test('a non-finite speed or direction yields no motion, not NaN', () => {
  assert.deepEqual(toScreenVector(NaN, 90), { dx: 0, dy: 0 });
  assert.deepEqual(toScreenVector(10, undefined as unknown as number), { dx: 0, dy: 0 });
});

// ── Field indexing + sampling ──────────────────────────────────────────

/** 2x2 lattice, all 10 mph from the west (so every vector is +x). */
function uniformGrid(): WindPoint[] {
  const pts: WindPoint[] = [];
  for (const lat of [34, 35]) {
    for (const lon of [-81, -80]) {
      pts.push({ lat, lon, speed: 10, gust: 25, dir: 270 });
    }
  }
  return pts;
}

test('an empty or single-row grid produces no field', () => {
  assert.equal(buildWindField([], 'speed'), null);
  assert.equal(buildWindField(null, 'speed'), null);
  assert.equal(
    buildWindField([{ lat: 34, lon: -81, speed: 5, gust: 9, dir: 90 }], 'speed'),
    null,
  );
});

test('the gust key selects gust speed, not wind speed', () => {
  const wind = sampleWindField(buildWindField(uniformGrid(), 'speed'), 34.5, -80.5)!;
  const gust = sampleWindField(buildWindField(uniformGrid(), 'gust'), 34.5, -80.5)!;
  near(wind.dx, 10);
  near(gust.dx, 25);
});

test('sampling outside the grid footprint returns null', () => {
  const f = buildWindField(uniformGrid(), 'speed');
  assert.equal(sampleWindField(f, 36, -80.5), null, 'north of the grid');
  assert.equal(sampleWindField(f, 34.5, -79), null, 'east of the grid');
  assert.ok(sampleWindField(f, 34.5, -80.5), 'dead centre should sample');
});

test('a uniform field interpolates to the same vector everywhere inside it', () => {
  const f = buildWindField(uniformGrid(), 'speed');
  for (const [lat, lon] of [[34, -81], [34.5, -80.5], [34.9, -80.1], [35, -80]] as const) {
    const v = sampleWindField(f, lat, lon)!;
    near(v.dx, 10, 1e-5, `dx wrong at ${lat},${lon}`);
    near(v.dy, 0, 1e-5, `dy wrong at ${lat},${lon}`);
  }
});

test('interpolation runs on vectors, not on compass angles', () => {
  // 350° and 10° are 20° apart. Averaging the numbers gives 180° — a wind
  // blowing due the opposite way. Averaging the vectors gives due north.
  const grid: WindPoint[] = [
    { lat: 34, lon: -81, speed: 10, gust: 10, dir: 350 },
    { lat: 34, lon: -80, speed: 10, gust: 10, dir: 10 },
    { lat: 35, lon: -81, speed: 10, gust: 10, dir: 350 },
    { lat: 35, lon: -80, speed: 10, gust: 10, dir: 10 },
  ];
  const v = sampleWindField(buildWindField(grid, 'speed'), 34.5, -80.5)!;
  near(v.dx, 0, 1e-5, 'east/west components should cancel');
  assert.ok(v.dy > 9.8, `a north wind must still blow down-screen, got dy=${v.dy}`);
});

test('a value halfway between two nodes is the average of the two', () => {
  const grid: WindPoint[] = [
    { lat: 34, lon: -81, speed: 0, gust: 0, dir: 270 },
    { lat: 34, lon: -80, speed: 20, gust: 20, dir: 270 },
    { lat: 35, lon: -81, speed: 0, gust: 0, dir: 270 },
    { lat: 35, lon: -80, speed: 20, gust: 20, dir: 270 },
  ];
  const v = sampleWindField(buildWindField(grid, 'speed'), 34.5, -80.5)!;
  near(v.dx, 10, 1e-5);
});

// ── Screen field ───────────────────────────────────────────────────────

// Canvas 200x100 mapped inside the uniformGrid() footprint, with margin to
// spare. The margin is not artificial: computeWind() pads the requested bounds
// by a full grid step, so the fetched grid always overhangs the viewport — which
// it must, because the screen lattice itself overhangs the canvas by up to one
// step at the right and bottom edges.
const toLatLon = (x: number, y: number) => ({
  lat: 34.9 - (y / 100) * 0.8, // top of canvas = north
  lon: -80.9 + (x / 200) * 0.8,
});

test('the screen field covers a canvas that sits inside the grid', () => {
  const sf = buildScreenField(200, 100, 14, buildWindField(uniformGrid(), 'speed'), toLatLon);
  assert.equal(sf.coverage, 1, 'every node should carry wind');
  const v = sampleScreenField(sf, 100, 50)!;
  near(v.dx, 10, 1e-4);
  near(v.dy, 0, 1e-4);
});

test('the screen field lattice spans the whole canvas, including the far edge', () => {
  const sf = buildScreenField(200, 100, 14, buildWindField(uniformGrid(), 'speed'), toLatLon);
  assert.ok((sf.cols - 1) * sf.step >= 200, 'lattice stops short of the right edge');
  assert.ok((sf.rows - 1) * sf.step >= 100, 'lattice stops short of the bottom edge');
  assert.ok(sampleScreenField(sf, 200, 100), 'the bottom-right corner should sample');
});

test('pixels off the canvas sample as null', () => {
  const sf = buildScreenField(200, 100, 14, buildWindField(uniformGrid(), 'speed'), toLatLon);
  assert.equal(sampleScreenField(sf, -1, 50), null);
  assert.equal(sampleScreenField(sf, 201, 50), null);
  assert.equal(sampleScreenField(sf, 100, 101), null);
  assert.equal(sampleScreenField(sf, NaN, 50), null);
});

test('with no wind data at all, nothing samples and coverage is zero', () => {
  const sf = buildScreenField(200, 100, 14, null, toLatLon);
  assert.equal(sf.coverage, 0);
  assert.equal(sampleScreenField(sf, 100, 50), null);
});

test('a partly-covered canvas samples inside coverage and dies outside it', () => {
  // Canvas runs off the east edge of the grid about a quarter of the way across.
  const wide = (x: number, y: number) => ({
    lat: 34.9 - (y / 100) * 0.8,
    lon: -80.9 + (x / 200) * 1.6,
  });
  const sf = buildScreenField(400, 100, 14, buildWindField(uniformGrid(), 'speed'), wide);
  assert.ok(sf.coverage > 0.2 && sf.coverage < 0.8, `expected partial coverage, got ${sf.coverage}`);
  assert.ok(sampleScreenField(sf, 20, 50), 'left side is inside the grid');
  assert.equal(sampleScreenField(sf, 380, 50), null, 'right side is outside the grid');
});

// ── Tuning helpers ─────────────────────────────────────────────────────

test('particle count scales with area but stays within bounds', () => {
  assert.equal(particleCount(10, 10), 120, 'a tiny canvas still gets the floor');
  assert.equal(particleCount(4000, 4000), 1000, 'a huge canvas is capped');
  const small = particleCount(400, 350);
  const large = particleCount(900, 400);
  assert.ok(large > small, 'a bigger map should carry more particles');
});

test('frame delta is 1 at 60 fps and clamped after a long stall', () => {
  near(frameDelta(1000, 1000 + 1000 / 60), 1, 1e-9);
  assert.equal(frameDelta(0, 5000), 1, 'the first frame advances by exactly one');
  assert.equal(frameDelta(1000, 60_000), 3, 'a backgrounded tab must not teleport particles');
  assert.equal(frameDelta(2000, 1000), 0, 'a clock that goes backwards freezes rather than reverses');
});

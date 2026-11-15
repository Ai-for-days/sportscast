// WOW-020: wind/gust numbers at named towns. Pure helper, offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeSampler, selectTownLabels, labelSpacingPx, MAX_TOWN_LABELS,
  type WindNode, type TownRef,
} from '../src/lib/wind-town-labels';

// 3 x 3 grid at lat 30,31,32 / lon -100,-99,-98.
function grid(f: (lat: number, lon: number) => Partial<WindNode> = () => ({})): WindNode[] {
  const out: WindNode[] = [];
  for (const lat of [30, 31, 32]) for (const lon of [-100, -99, -98]) {
    out.push({ lat, lon, speed: 10, gust: 20, dir: 180, ...f(lat, lon) });
  }
  return out;
}
const BOUNDS = { north: 32, south: 30, east: -98, west: -100 };
// Simple projection: 1° = 100 px.
const project = (lat: number, lon: number) => ({ x: (lon + 100) * 100, y: (32 - lat) * 100 });
const town = (name: string, lat: number, lon: number, tier = 1): TownRef => ({ name, lat, lon, tier });

test('t1: a town exactly on a node gets that node value', () => {
  const s = makeSampler(grid((lat, lon) => ({ speed: lat * 10 + lon + 100 })));
  assert.equal(s.sample(31, -99, 'wind')!.value, 311);
});

test('t2: a town at a cell centre gets the mean of its four corners', () => {
  const g = grid((lat, lon) => ({ speed: lat === 30 ? (lon === -100 ? 4 : 8) : (lon === -100 ? 12 : 16) }));
  assert.equal(makeSampler(g).sample(30.5, -99.5, 'wind')!.value, 10);
});

test('t3: a town outside the grid extent gets no label', () => {
  const s = makeSampler(grid());
  assert.equal(s.sample(32.01, -99, 'wind'), null);
  assert.equal(s.sample(31, -100.5, 'wind'), null);
  const labels = selectTownLabels({ grid: grid(), cities: [town('Out', 33, -99)], zoom: 6,
    bounds: { ...BOUNDS, north: 34 }, mode: 'wind', project });
  assert.equal(labels.length, 0);
});

test('t4: a town with one missing corner gets no label, never 0', () => {
  const g = grid().filter((p) => !(p.lat === 31 && p.lon === -99));
  assert.equal(makeSampler(g).sample(30.5, -99.5, 'wind'), null);
  const g2 = grid((lat, lon) => (lat === 30 && lon === -100 ? { gust: NaN } : {}));
  assert.equal(makeSampler(g2).sample(30.5, -99.5, 'gusts'), null);
});

test('t5: values stay within the corner range; gust >= speed is preserved', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let k = 0; k < 200; k++) {
    const g = grid(() => { const sp = rnd() * 30; return { speed: sp, gust: sp + rnd() * 20, dir: rnd() * 360 }; });
    const s = makeSampler(g);
    const lat = 30 + rnd() * 2, lon = -100 + rnd() * 2;
    const w = s.sample(lat, lon, 'wind')!, gu = s.sample(lat, lon, 'gusts')!;
    const sp = g.map((p) => p.speed), gs = g.map((p) => p.gust);
    assert.ok(w.value >= Math.min(...sp) - 1e-9 && w.value <= Math.max(...sp) + 1e-9);
    assert.ok(gu.value >= w.value - 1e-9, 'gust below speed');
    assert.ok(gu.value <= Math.max(...gs) + 1e-9);
  }
});

test('t6: direction comes from the nearest corner; 350 and 10 never give ~180', () => {
  const g = grid((lat, lon) => ({ dir: lon <= -100 ? 350 : 10 }));
  const s = makeSampler(g);
  for (const lon of [-99.9, -99.6, -99.4, -99.1]) {
    const d = s.sample(30.5, lon, 'wind')!.dir;
    const offNorth = Math.min(Math.abs(d), Math.abs(360 - d));
    assert.ok(offNorth <= 20, `dir ${d}`);
  }
});

test('t7: no two accepted anchors are closer than the spacing', () => {
  const cities: TownRef[] = [];
  for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) cities.push(town(`T${i}-${j}`, 30 + i * 0.1, -100 + j * 0.1));
  for (const zoom of [6, 8, 10]) {
    const labels = selectTownLabels({ grid: grid(), cities: cities.map((c) => ({ ...c, tier: 1 })), zoom, bounds: BOUNDS, mode: 'wind', project });
    const D = labelSpacingPx(zoom);
    const pts = labels.map((l) => project(l.lat, l.lon));
    for (let a = 0; a < pts.length; a++) for (let b = a + 1; b < pts.length; b++) {
      assert.ok(Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y) >= D);
    }
  }
});

test('t8: the cap holds at 40', () => {
  const cities: TownRef[] = [];
  for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) cities.push(town(`C${i}${j}`, 30 + i * 0.25, -100 + j * 0.25));
  // 1° = 1000 px so spacing never binds.
  const wide = (lat: number, lon: number) => ({ x: (lon + 100) * 1000, y: (32 - lat) * 1000 });
  assert.ok(cities.length >= 41);
  const labels = selectTownLabels({ grid: grid(), cities, zoom: 6, bounds: BOUNDS, mode: 'wind', project: wide });
  assert.equal(labels.length, MAX_TOWN_LABELS);
});

test('t9: tier 1 beats tier 5 on a collision; result is order-independent', () => {
  const a = town('Smallville', 31, -99, 4), b = town('Bigtown', 31.001, -99.001, 1);
  const run = (cs: TownRef[]) => selectTownLabels({ grid: grid(), cities: cs, zoom: 8, bounds: BOUNDS, mode: 'wind', project });
  const r1 = run([a, b]), r2 = run([b, a]);
  assert.deepEqual(r1, r2);
  assert.equal(r1.length, 1);
  assert.equal(r1[0].name, 'Bigtown');
});

test('t10: tier filter excludes a tier-5 town at zoom 6', () => {
  const labels = selectTownLabels({ grid: grid(), cities: [town('Tiny', 31, -99, 5)], zoom: 6, bounds: BOUNDS, mode: 'wind', project });
  assert.equal(labels.length, 0);
});

test('t11: empty grid gives no labels', () => {
  assert.deepEqual(selectTownLabels({ grid: [], cities: [town('A', 31, -99)], zoom: 6, bounds: BOUNDS, mode: 'wind', project }), []);
});

test("t12: mode 'wind' reads speed and 'gusts' reads gust", () => {
  const s = makeSampler(grid());
  assert.equal(s.sample(31, -99, 'wind')!.value, 10);
  assert.equal(s.sample(31, -99, 'gusts')!.value, 20);
});

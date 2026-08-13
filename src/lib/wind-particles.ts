/* ------------------------------------------------------------------ */
/*  Wind particle field — the math behind the animated wind map         */
/*                                                                      */
/*  The ZIP-page Wind/Gusts tabs draw a colour heatmap plus barbs. Both  */
/*  are static: they tell you the wind is 14 mph from the WSW, but not   */
/*  what that looks like. This module supplies the advection field for   */
/*  a particle animation drawn over the heatmap.                         */
/*                                                                      */
/*  Everything here is pure and screen-space, deliberately: the React    */
/*  layer owns Leaflet, the canvas, and the RAF loop; this file owns the */
/*  arithmetic, so the parts that are easy to get silently wrong (the    */
/*  direction convention, interpolating a vector field) are testable.    */
/*  See tests/wind-particles.test.ts.                                    */
/* ------------------------------------------------------------------ */

export interface WindPoint {
  lat: number;
  lon: number;
  speed: number;
  gust: number;
  dir: number;
}

/** A motion vector in canvas pixels: +dx is right/east, +dy is DOWN/south. */
export interface ScreenVector {
  dx: number;
  dy: number;
}

const ZERO: ScreenVector = { dx: 0, dy: 0 };

/**
 * Meteorological direction + speed -> a screen-space vector.
 *
 * `dir` is the direction the wind blows *from* (0 = a north wind), and canvas
 * y grows downward while latitude grows upward — two sign flips that cancel on
 * the y axis and don't on the x axis. Getting this wrong yields an animation
 * that looks plausible and points the wrong way, which is why it is its own
 * function with its own tests.
 */
export function toScreenVector(speed: number, dirDeg: number): ScreenVector {
  if (!Number.isFinite(speed) || !Number.isFinite(dirDeg)) return ZERO;
  const rad = (dirDeg * Math.PI) / 180;
  return { dx: -speed * Math.sin(rad), dy: speed * Math.cos(rad) };
}

/** The lat/lon lattice returned by /api/forecast-grid, indexed for lookup. */
export interface WindField {
  lats: number[]; // ascending, unique
  lons: number[]; // ascending, unique
  vec: Map<string, ScreenVector>;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

/**
 * Index a grid for sampling. Vectors are resolved up front so interpolation
 * happens on components, never on angles — averaging 350 deg and 10 deg as
 * numbers gives 180, i.e. exactly backwards.
 */
export function buildWindField(
  grid: WindPoint[] | null | undefined,
  valueKey: 'speed' | 'gust',
): WindField | null {
  if (!grid || grid.length === 0) return null;

  const lats = [...new Set(grid.map(p => p.lat))].sort((a, b) => a - b);
  const lons = [...new Set(grid.map(p => p.lon))].sort((a, b) => a - b);
  // A single row or column has nothing to interpolate between.
  if (lats.length < 2 || lons.length < 2) return null;

  const vec = new Map<string, ScreenVector>();
  for (const p of grid) {
    const raw = valueKey === 'gust' ? p.gust : p.speed;
    vec.set(`${p.lat},${p.lon}`, toScreenVector(raw, p.dir));
  }

  return {
    lats,
    lons,
    vec,
    minLat: lats[0],
    maxLat: lats[lats.length - 1],
    minLon: lons[0],
    maxLon: lons[lons.length - 1],
  };
}

/** Largest index i with sorted[i] <= v, clamped so i+1 is always in range. */
function lowerIndex(sorted: number[], v: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (sorted[mid] <= v) lo = mid;
    else hi = mid - 1;
  }
  return Math.min(lo, sorted.length - 2);
}

/**
 * Bilinear sample of the wind field. Returns null outside the grid's footprint
 * so the caller can retire the particle instead of extrapolating a vector out
 * of thin air.
 */
export function sampleWindField(
  field: WindField | null,
  lat: number,
  lon: number,
): ScreenVector | null {
  if (!field) return null;
  if (lat < field.minLat || lat > field.maxLat) return null;
  if (lon < field.minLon || lon > field.maxLon) return null;

  const i = lowerIndex(field.lats, lat);
  const j = lowerIndex(field.lons, lon);
  const la0 = field.lats[i];
  const la1 = field.lats[i + 1];
  const lo0 = field.lons[j];
  const lo1 = field.lons[j + 1];

  const tLa = la1 !== la0 ? (lat - la0) / (la1 - la0) : 0;
  const tLo = lo1 !== lo0 ? (lon - lo0) / (lo1 - lo0) : 0;

  const at = (a: number, o: number) => field.vec.get(`${a},${o}`) ?? ZERO;
  const v00 = at(la0, lo0);
  const v10 = at(la1, lo0);
  const v01 = at(la0, lo1);
  const v11 = at(la1, lo1);

  const w00 = (1 - tLa) * (1 - tLo);
  const w10 = tLa * (1 - tLo);
  const w01 = (1 - tLa) * tLo;
  const w11 = tLa * tLo;

  return {
    dx: v00.dx * w00 + v10.dx * w10 + v01.dx * w01 + v11.dx * w11,
    dy: v00.dy * w00 + v10.dy * w10 + v01.dy * w01 + v11.dy * w11,
  };
}

/* ----- screen-space field ----- */

/**
 * The wind field resampled onto a coarse pixel lattice over the canvas.
 *
 * Unprojecting a pixel to lat/lon is the expensive part, so it is done once per
 * view — roughly a thousand nodes — instead of once per particle per frame.
 * The animation loop then only does arithmetic.
 */
export interface ScreenField {
  step: number;
  cols: number;
  rows: number;
  width: number;
  height: number;
  dx: Float32Array;
  dy: Float32Array;
  ok: Uint8Array;
  /** Fraction of nodes that carry wind — 0 means nothing to animate. */
  coverage: number;
}

export function buildScreenField(
  width: number,
  height: number,
  step: number,
  field: WindField | null,
  toLatLon: (x: number, y: number) => { lat: number; lon: number },
): ScreenField {
  const cols = Math.max(2, Math.ceil(width / step) + 1);
  const rows = Math.max(2, Math.ceil(height / step) + 1);
  const n = cols * rows;
  const dx = new Float32Array(n);
  const dy = new Float32Array(n);
  const ok = new Uint8Array(n);
  let filled = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const { lat, lon } = toLatLon(c * step, r * step);
      const v = sampleWindField(field, lat, lon);
      if (!v) continue;
      const idx = r * cols + c;
      dx[idx] = v.dx;
      dy[idx] = v.dy;
      ok[idx] = 1;
      filled++;
    }
  }

  return { step, cols, rows, width, height, dx, dy, ok, coverage: n > 0 ? filled / n : 0 };
}

/**
 * Bilinear sample of the screen field at a canvas pixel. Returns null if the
 * pixel is off-canvas or any of its four corners lack data, so particles die at
 * the edge of coverage rather than drifting on a half-known vector.
 */
export function sampleScreenField(sf: ScreenField, x: number, y: number): ScreenVector | null {
  if (!(x >= 0) || !(y >= 0) || x > sf.width || y > sf.height) return null;

  const gx = x / sf.step;
  const gy = y / sf.step;
  const c0 = Math.min(Math.floor(gx), sf.cols - 2);
  const r0 = Math.min(Math.floor(gy), sf.rows - 2);
  const c1 = c0 + 1;
  const r1 = r0 + 1;

  const i00 = r0 * sf.cols + c0;
  const i01 = r0 * sf.cols + c1;
  const i10 = r1 * sf.cols + c0;
  const i11 = r1 * sf.cols + c1;
  if (!sf.ok[i00] || !sf.ok[i01] || !sf.ok[i10] || !sf.ok[i11]) return null;

  const tx = gx - c0;
  const ty = gy - r0;
  const w00 = (1 - tx) * (1 - ty);
  const w01 = tx * (1 - ty);
  const w10 = (1 - tx) * ty;
  const w11 = tx * ty;

  return {
    dx: sf.dx[i00] * w00 + sf.dx[i01] * w01 + sf.dx[i10] * w10 + sf.dx[i11] * w11,
    dy: sf.dy[i00] * w00 + sf.dy[i01] * w01 + sf.dy[i10] * w10 + sf.dy[i11] * w11,
  };
}

/* ----- animation tuning ----- */

/** Canvas pixels travelled per mph, per 60 fps frame. */
export const PIXELS_PER_MPH = 0.075;
/** No single frame may advance a particle further than this, whatever the wind. */
export const MAX_STEP_PX = 6;
/** Pixel spacing of the screen field lattice. */
export const FIELD_STEP_PX = 14;
/** Multiplied into every pixel's alpha each frame — this is the trail length. */
export const TRAIL_FADE = 0.88;

/** How many particles a canvas of this size should carry. */
export function particleCount(width: number, height: number): number {
  const area = Math.max(0, width) * Math.max(0, height);
  return Math.round(Math.min(1000, Math.max(120, area / 900)));
}

/**
 * Frames elapsed since the last animation frame, at a 60 fps reference.
 * Clamped so a backgrounded tab does not resume by teleporting every particle
 * across the map.
 */
export function frameDelta(prevTs: number, ts: number): number {
  if (!Number.isFinite(prevTs) || prevTs <= 0) return 1;
  return Math.min(3, Math.max(0, (ts - prevTs) / (1000 / 60)));
}

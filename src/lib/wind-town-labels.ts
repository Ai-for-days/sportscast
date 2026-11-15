// Wind / gust numbers at named towns (WOW-020).
//
// Pure: no Leaflet, no network. Given the wind grid the map already holds,
// pick which towns get a number and what that number is. The value is the
// same bilinear blend of the four surrounding grid nodes the heatmap uses to
// colour the pixel under the town, so a label always agrees with its shading.
//
// Never invents a value (project rule 5): a town outside the grid's extent,
// or one whose four corners are not all present and finite, gets no label —
// no clamping, no `?? 0`, no nearest-node fallback. Direction is taken from
// the nearest corner; angles are never averaged (350° and 10° would give 180°).

export interface WindNode { lat: number; lon: number; speed: number; gust: number; dir: number }
export interface TownRef { name: string; lat: number; lon: number; tier: number }
export interface ViewBounds { north: number; south: number; east: number; west: number }
export interface TownLabel { name: string; lat: number; lon: number; value: number; dir: number }

export const MAX_TOWN_LABELS = 40;

/** Minimum pixel gap between two label anchors at a zoom (barb size plus margin). */
export function labelSpacingPx(zoom: number): number {
  if (zoom >= 9) return 72;
  if (zoom >= 7) return 64;
  return 56;
}

/** Same tier rule as the Temp map's town layer and lib/forecast-grid.ts. */
export function tierForZoom(zoom: number): number {
  if (zoom <= 3) return 1;
  if (zoom <= 4) return 2;
  if (zoom <= 5) return 3;
  if (zoom <= 6) return 4;
  return 5;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const nodeKey = (lat: number, lon: number) => `${lat},${lon}`;

/** Index of the last sorted value <= x (x already known to be within range). */
function lowerIndex(sorted: number[], x: number): number {
  let lo = 0, hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (sorted[mid] <= x) lo = mid; else hi = mid - 1;
  }
  return lo;
}

export interface GridSampler {
  sample(lat: number, lon: number, mode: 'wind' | 'gusts'): { value: number; dir: number } | null;
}

export function makeSampler(grid: WindNode[]): GridSampler {
  const byKey = new Map<string, WindNode>();
  const latSet = new Set<number>(), lonSet = new Set<number>();
  for (const p of grid) {
    byKey.set(nodeKey(p.lat, p.lon), p);
    latSet.add(p.lat); lonSet.add(p.lon);
  }
  const lats = [...latSet].sort((a, b) => a - b);
  const lons = [...lonSet].sort((a, b) => a - b);

  return {
    sample(lat, lon, mode) {
      if (lats.length === 0 || lons.length === 0) return null;
      // Extent check: no labelled value outside the grid we were given.
      if (lat < lats[0] || lat > lats[lats.length - 1] || lon < lons[0] || lon > lons[lons.length - 1]) return null;

      const i = lowerIndex(lats, lat), j = lowerIndex(lons, lon);
      const lat0 = lats[i], lat1 = lats[Math.min(i + 1, lats.length - 1)];
      const lon0 = lons[j], lon1 = lons[Math.min(j + 1, lons.length - 1)];
      const corners = [
        byKey.get(nodeKey(lat0, lon0)), byKey.get(nodeKey(lat0, lon1)),
        byKey.get(nodeKey(lat1, lon0)), byKey.get(nodeKey(lat1, lon1)),
      ];
      for (const c of corners) {
        if (!c || !finite(c.speed) || !finite(c.gust) || !finite(c.dir)) return null;
      }
      const [c00, c01, c10, c11] = corners as WindNode[];

      // Zero-width cell (on a node or edge) gives weight 0 to the far side.
      const ty = lat1 === lat0 ? 0 : (lat - lat0) / (lat1 - lat0);
      const tx = lon1 === lon0 ? 0 : (lon - lon0) / (lon1 - lon0);
      const pick = (n: WindNode) => (mode === 'gusts' ? n.gust : n.speed);
      const value = (1 - ty) * ((1 - tx) * pick(c00) + tx * pick(c01))
        + ty * ((1 - tx) * pick(c10) + tx * pick(c11));

      // Direction from the nearest corner, never averaged.
      const near = (ty < 0.5 ? (tx < 0.5 ? c00 : c01) : (tx < 0.5 ? c10 : c11));
      return { value, dir: near.dir };
    },
  };
}

/**
 * Towns in view (tier filter by zoom), in deterministic priority order
 * (tier, name, lat), each given an interpolated value, accepted greedily only
 * if its projected anchor is at least labelSpacingPx(zoom) from every label
 * already accepted. At most MAX_TOWN_LABELS.
 */
export function selectTownLabels(args: {
  grid: WindNode[];
  cities: TownRef[];
  zoom: number;
  bounds: ViewBounds;
  mode: 'wind' | 'gusts';
  project: (lat: number, lon: number) => { x: number; y: number };
  maxLabels?: number;
}): TownLabel[] {
  const { grid, cities, zoom, bounds, mode, project } = args;
  const cap = args.maxLabels ?? MAX_TOWN_LABELS;
  if (grid.length === 0) return [];
  const maxTier = tierForZoom(zoom);
  const minGap = labelSpacingPx(zoom);
  const sampler = makeSampler(grid);

  const eligible = cities
    .filter((c) => c.tier <= maxTier
      && c.lat >= bounds.south && c.lat <= bounds.north
      && c.lon >= bounds.west && c.lon <= bounds.east)
    .slice()
    .sort((a, b) => a.tier - b.tier || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || a.lat - b.lat || a.lon - b.lon);

  const out: TownLabel[] = [];
  const placed: { x: number; y: number }[] = [];
  for (const c of eligible) {
    if (out.length >= cap) break;
    const s = sampler.sample(c.lat, c.lon, mode);
    if (!s) continue;
    const pt = project(c.lat, c.lon);
    if (placed.some((p) => Math.hypot(p.x - pt.x, p.y - pt.y) < minGap)) continue;
    placed.push(pt);
    out.push({ name: c.name, lat: c.lat, lon: c.lon, value: s.value, dir: s.dir });
  }
  return out;
}

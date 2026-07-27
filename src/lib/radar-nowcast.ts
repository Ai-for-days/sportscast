// Radar nowcast via RainViewer observed radar tiles. Samples the latest radar
// frame around an exact lat/lon to detect a precipitation cell that the
// forecast model (Open-Meteo) and the nearest NWS station can both miss.
//
// Sampling is deliberately ZIP-scale, not point-scale. A US ZIP code spans
// roughly 5-25 km while summer convection cells are only a few km across, so a
// tight sample at the ZIP centroid reports "dry" while it rains over most of
// the ZIP. Observed 2026-07-27 in 29209 (Columbia SC): it was raining on the
// ground and at the nearest station, but the closest radar echo sat 8.6 km
// from the centroid — far outside the old 1.5 km sample — so the page showed
// no rain until the station caught up 20+ minutes later.
//
// Best-effort and fully defensive: returns null on any failure (network,
// timeout, decode) so the caller degrades gracefully to model + station data.
// Detection is alpha-based (transparent tile pixel = no precip) which is robust
// across RainViewer color schemes; color only estimates intensity.

export type RadarNowcast = {
  precipitating: boolean;
  intensity: 'none' | 'light' | 'moderate' | 'heavy';
  /** Distance from the sampled point to the nearest radar echo, in km. Null when none found. */
  distanceKm: number | null;
} | null;

const RAINVIEWER_MAPS = 'https://api.rainviewer.com/public/weather-maps.json';
const ZOOM = 8; // ~0.5 km/pixel at mid-latitudes
const TILE_SIZE = 256;

/** How far from the point still counts as "precipitation in this ZIP". */
const SAMPLE_RADIUS_KM = 12;
/** Within this distance an echo is treated as overhead, so its true intensity is reported. */
const OVERHEAD_KM = 3;
/** Overhead echoes only need to clear radar speckle. */
const MIN_PRECIP_PIXELS = 2;
/**
 * A cell out toward the ZIP boundary has to be substantial before it counts —
 * roughly 1.5 km² of returns rather than a couple of stray pixels. Without this,
 * a speck 11 km away would keep every Southeast ZIP reading "rain" all summer.
 */
const MIN_PRECIP_PIXELS_DISTANT = 6;

function lonToTileFloat(lon: number, z: number) {
  return ((lon + 180) / 360) * Math.pow(2, z);
}
function latToTileFloat(lat: number, z: number) {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z);
}

/** Ground resolution of one tile pixel at this latitude and zoom, in metres. */
export function metresPerPixel(lat: number, z: number = ZOOM) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, z);
}

export async function fetchRadarNowcast(lat: number, lon: number): Promise<RadarNowcast> {
  try {
    const metaRes = await fetch(RAINVIEWER_MAPS, { signal: AbortSignal.timeout(4000) });
    if (!metaRes.ok) return null;
    const meta = await metaRes.json();
    const host: string = meta?.host;
    const past = meta?.radar?.past;
    if (!host || !Array.isArray(past) || past.length === 0) return null;
    const frame = past[past.length - 1]; // most recent observed radar frame
    if (!frame?.path) return null;

    const mpp = metresPerPixel(lat, ZOOM);
    if (!isFinite(mpp) || mpp <= 0) return null;
    const radiusPx = Math.max(1, Math.ceil((SAMPLE_RADIUS_KM * 1000) / mpp));

    // Work in global pixel space so the sample window can cross tile borders —
    // a point near a tile edge would otherwise lose most of its window.
    const gx = lonToTileFloat(lon, ZOOM) * TILE_SIZE;
    const gy = latToTileFloat(lat, ZOOM) * TILE_SIZE;
    const worldTiles = Math.pow(2, ZOOM);

    const centreTileX = Math.floor(gx / TILE_SIZE);
    const centreTileY = Math.floor(gy / TILE_SIZE);

    const wanted: { tx: number; ty: number }[] = [];
    for (let ty = Math.floor((gy - radiusPx) / TILE_SIZE); ty <= Math.floor((gy + radiusPx) / TILE_SIZE); ty++) {
      if (ty < 0 || ty >= worldTiles) continue; // past the poles — no tiles exist
      for (let tx = Math.floor((gx - radiusPx) / TILE_SIZE); tx <= Math.floor((gx + radiusPx) / TILE_SIZE); tx++) {
        wanted.push({ tx: ((tx % worldTiles) + worldTiles) % worldTiles, ty }); // wrap the dateline
      }
    }
    if (wanted.length === 0) return null;

    const sharp = (await import('sharp')).default;

    const tiles = await Promise.all(
      wanted.map(async ({ tx, ty }) => {
        try {
          // color scheme 2, no smoothing (crisper -> fewer false positives), snow flag on
          const url = `${host}${frame.path}/${TILE_SIZE}/${ZOOM}/${tx}/${ty}/2/0_1.png`;
          const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
          if (!res.ok) return null;
          const buf = Buffer.from(await res.arrayBuffer());
          const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
          return { tx, ty, data, info };
        } catch {
          return null;
        }
      }),
    );

    // The tile containing the point is the one that matters most; without it we
    // cannot say anything useful about this location.
    if (!tiles.some(t => t && t.tx === centreTileX && t.ty === centreTileY)) return null;

    let precipPixels = 0;
    let nearestPx = Infinity;
    let maxScore = 0; // 1 light, 2 moderate, 3 heavy
    let maxScoreNearestPx = Infinity;

    for (const tile of tiles) {
      if (!tile) continue;
      const { tx, ty, data, info } = tile;
      const ch = info.channels;
      const originX = tx * TILE_SIZE;
      const originY = ty * TILE_SIZE;

      for (let y = 0; y < info.height; y++) {
        const dy = originY + y - gy;
        if (Math.abs(dy) > radiusPx) continue;

        for (let x = 0; x < info.width; x++) {
          const dx = originX + x - gx;
          if (Math.abs(dx) > radiusPx) continue;

          const dist = Math.hypot(dx, dy);
          if (dist > radiusPx) continue; // circular sample, not square

          const idx = (y * info.width + x) * ch;
          const a = ch >= 4 ? data[idx + 3] : 255;
          if (a < 40) continue; // transparent enough -> no precip here

          precipPixels++;
          if (dist < nearestPx) nearestPx = dist;

          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          let score = 1;
          if (r > 170 && g < 130) score = 3; // reds/magenta -> heavy
          else if (r > 150 && g > 150 && b < 120) score = 2; // yellows -> moderate

          if (score > maxScore || (score === maxScore && dist < maxScoreNearestPx)) {
            maxScore = score;
            maxScoreNearestPx = dist;
          }
        }
      }
    }

    if (nearestPx === Infinity) {
      return { precipitating: false, intensity: 'none', distanceKm: null };
    }

    const nearestKm = (nearestPx * mpp) / 1000;
    const overhead = nearestKm <= OVERHEAD_KM;
    const required = overhead ? MIN_PRECIP_PIXELS : MIN_PRECIP_PIXELS_DISTANT;
    if (precipPixels < required) {
      return { precipitating: false, intensity: 'none', distanceKm: null };
    }

    let intensity: 'light' | 'moderate' | 'heavy' =
      maxScore >= 3 ? 'heavy' : maxScore === 2 ? 'moderate' : 'light';

    // A strong cell on the far side of the ZIP is not a downpour overhead —
    // only echoes close to the point carry their full intensity through.
    if ((maxScoreNearestPx * mpp) / 1000 > OVERHEAD_KM) intensity = 'light';

    return { precipitating: true, intensity, distanceKm: Math.round(nearestKm * 10) / 10 };
  } catch {
    return null;
  }
}

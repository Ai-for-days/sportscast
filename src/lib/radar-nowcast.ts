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
/**
 * ⛔ MAX 7. RainViewer serves real 256px radar only up to zoom 7. At z8+ it
 * returns a byte-identical grey "Zoom Level Not Supported" PNG as a 200 OK, so
 * nothing errors and the sampler happily reads the placeholder.
 *
 * This module shipped with ZOOM = 8, which means it never once read real radar.
 * Proof (2026-07-29): at z8, Columbia / Miami / Seattle / Chicago all returned
 * md5 2cc6649e1f2e — the same image — with 13,324 grey pixels and zero colour.
 * At z7 each location returns a different tile with real chromatic returns.
 * The dark pixels of that placeholder's lettering were being counted as a
 * permanent light-rain cell, which is what put "light rain" on a clear day.
 *
 * The map layer in ForecastMaps.tsx already knew this and pins maxNativeZoom: 7.
 * ~1 km/pixel at mid-latitudes — coarser than z8 would have been, but real.
 */
const ZOOM = 7;
const TILE_SIZE = 256;

/** How far out we look, for reporting the distance to the nearest cell. */
const SAMPLE_RADIUS_KM = 12;
/**
 * Only an echo this close makes us say it is RAINING HERE.
 *
 * 2026-07-29: this used to be the full 12 km, which put "Light rain" on 29209's
 * page while the ground, the nearest station, the model AND the site's own radar
 * map all showed clear. A ZIP is ~15 km across, so "raining somewhere in the ZIP"
 * is not "raining at your house" — and claiming the latter destroys trust in
 * every other number on the page. Rain nearby but not overhead is now reported
 * through `distanceKm` only; it no longer changes the conditions text.
 */
const OVERHEAD_KM = 3;
/**
 * Reject isolated radar speckle.
 *
 * ⛔ This must be counted INSIDE the overhead zone, not across the 12 km disc.
 * 2026-08-12: it was counted across the whole disc while the "is it overhead"
 * test looked only at the single nearest pixel, so the guard never actually
 * protected the decision that reaches the customer. One stray 1 km² bin over
 * the centroid, plus any unrelated cell out at 10 km, shipped "Light rain".
 * Caught live on 29209 at 20:40Z: 35 pixels in the disc, exactly 1 overhead,
 * page said Light rain while NWS said Mostly Clear and Open-Meteo had 0.00 mm
 * for all 24 hours. Sampling at z7 is ~1 km/pixel — a single pixel is noise.
 */
const MIN_PRECIP_PIXELS = 2;

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

/**
 * Minimum colour saturation for a pixel to count as precipitation.
 *
 * Alpha alone is NOT enough. The tiles carry non-precipitation greyscale pixels
 * — a sample of the 29209 tile on 2026-07-29 held 10 distinct colours and every
 * one was grey (r === g === b), including 11,210 pixels of solid rgba(0,0,0,140)
 * covering ~17% of the tile. Alpha-only detection read that basemap/mask as a
 * permanent light-rain cell 8.6 km from the centroid: same pixel, same colour,
 * every frame for hours. Real radar returns are chromatic (blues, greens,
 * yellows, reds), so requiring chroma rejects the artifact by construction.
 */
const MIN_CHROMA = 25;

/** True when a pixel's colour is plausibly a radar return rather than basemap. */
export function isPrecipitationColor(r: number, g: number, b: number): boolean {
  return Math.max(r, g, b) - Math.min(r, g, b) >= MIN_CHROMA;
}

/** What the pixel sample found, split by zone. Exported for testing. */
export type RadarSample = {
  /** Chromatic pixels anywhere in the 12 km sample disc. */
  discPixels: number;
  /** Chromatic pixels within OVERHEAD_KM of the point. */
  overheadPixels: number;
  /** Highest intensity score (1 light / 2 moderate / 3 heavy) among OVERHEAD pixels. */
  overheadMaxScore: number;
  /** Distance to the nearest chromatic pixel anywhere in the disc, in km. */
  nearestKm: number | null;
};

/**
 * Turn a pixel sample into the nowcast the page shows.
 *
 * Both the "is it raining" test and the intensity come from the OVERHEAD zone
 * only. A cell elsewhere in the ZIP is reported through `distanceKm` and
 * nothing else — it must not set the conditions text and must not inflate the
 * intensity of something that is overhead.
 */
export function decideNowcast(s: RadarSample): NonNullable<RadarNowcast> {
  const dry = { precipitating: false as const, intensity: 'none' as const };

  // Nothing anywhere, or lone speckle in the disc: say nothing at all.
  if (s.nearestKm === null || s.discPixels < MIN_PRECIP_PIXELS) {
    return { ...dry, distanceKm: null };
  }

  const distanceKm = Math.round(s.nearestKm * 10) / 10;

  // Rain in the ZIP but not overhead — a distance, not a claim that it is
  // raining at this address. Also the single-overhead-pixel case: noise.
  if (s.overheadPixels < MIN_PRECIP_PIXELS) {
    return { ...dry, distanceKm };
  }

  const intensity: 'light' | 'moderate' | 'heavy' =
    s.overheadMaxScore >= 3 ? 'heavy' : s.overheadMaxScore === 2 ? 'moderate' : 'light';

  return { precipitating: true, intensity, distanceKm };
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

    const overheadPx = (OVERHEAD_KM * 1000) / mpp;

    let precipPixels = 0;
    let nearestPx = Infinity;
    let overheadPixels = 0;
    let overheadMaxScore = 0; // 1 light, 2 moderate, 3 heavy — overhead only

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

          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          if (!isPrecipitationColor(r, g, b)) continue; // grey = basemap, not rain

          precipPixels++;
          if (dist < nearestPx) nearestPx = dist;

          // Intensity is only meaningful for echoes actually over the point;
          // a heavy cell 10 km away must not colour what we say is happening
          // here. Scored inside the overhead test for exactly that reason.
          if (dist <= overheadPx) {
            overheadPixels++;
            let score = 1;
            if (r > 170 && g < 130) score = 3; // reds/magenta -> heavy
            else if (r > 150 && g > 150 && b < 120) score = 2; // yellows -> moderate
            if (score > overheadMaxScore) overheadMaxScore = score;
          }
        }
      }
    }

    return decideNowcast({
      discPixels: precipPixels,
      overheadPixels,
      overheadMaxScore,
      nearestKm: nearestPx === Infinity ? null : (nearestPx * mpp) / 1000,
    });
  } catch {
    return null;
  }
}

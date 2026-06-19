// Radar nowcast via RainViewer observed radar tiles. Samples the latest radar
// frame at an exact lat/lon to detect a hyperlocal precipitation cell that the
// forecast model (Open-Meteo) and the nearest NWS station can both miss.
//
// Best-effort and fully defensive: returns null on any failure (network,
// timeout, decode) so the caller degrades gracefully to model + station data.
// Detection is alpha-based (transparent tile pixel = no precip) which is robust
// across RainViewer color schemes; color only estimates intensity.

export type RadarNowcast = {
  precipitating: boolean;
  intensity: 'none' | 'light' | 'moderate' | 'heavy';
} | null;

const RAINVIEWER_MAPS = 'https://api.rainviewer.com/public/weather-maps.json';
const ZOOM = 8; // ~0.6 km/pixel mid-latitude — fine enough for a neighborhood
const TILE_SIZE = 256;

function lonToTileFloat(lon: number, z: number) {
  return ((lon + 180) / 360) * Math.pow(2, z);
}
function latToTileFloat(lat: number, z: number) {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z);
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

    const xf = lonToTileFloat(lon, ZOOM);
    const yf = latToTileFloat(lat, ZOOM);
    const tileX = Math.floor(xf);
    const tileY = Math.floor(yf);
    const px = Math.min(TILE_SIZE - 1, Math.max(0, Math.floor((xf - tileX) * TILE_SIZE)));
    const py = Math.min(TILE_SIZE - 1, Math.max(0, Math.floor((yf - tileY) * TILE_SIZE)));

    // color scheme 2, no smoothing (crisper -> fewer false positives), snow flag on
    const tileUrl = `${host}${frame.path}/${TILE_SIZE}/${ZOOM}/${tileX}/${tileY}/2/0_1.png`;
    const tileRes = await fetch(tileUrl, { signal: AbortSignal.timeout(4000) });
    if (!tileRes.ok) return null;
    const buf = Buffer.from(await tileRes.arrayBuffer());

    const sharp = (await import('sharp')).default;
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const ch = info.channels;

    // Sample a 3x3 window around the point: count precip pixels (alpha present)
    // and track the strongest color to estimate intensity.
    let precipPixels = 0;
    let maxScore = 0; // 1 light, 2 moderate, 3 heavy
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = px + dx;
        const y = py + dy;
        if (x < 0 || y < 0 || x >= info.width || y >= info.height) continue;
        const idx = (y * info.width + x) * ch;
        const a = ch >= 4 ? data[idx + 3] : 255;
        if (a < 40) continue; // transparent enough -> no precip here
        precipPixels++;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        let score = 1;
        if (r > 170 && g < 130) score = 3; // reds/magenta -> heavy
        else if (r > 150 && g > 150 && b < 120) score = 2; // yellows -> moderate
        if (score > maxScore) maxScore = score;
      }
    }

    // Require >=2 precip pixels in the 3x3 window to reject isolated radar noise.
    if (precipPixels < 2) return { precipitating: false, intensity: 'none' };
    const intensity = maxScore >= 3 ? 'heavy' : maxScore === 2 ? 'moderate' : 'light';
    return { precipitating: true, intensity };
  } catch {
    return null;
  }
}

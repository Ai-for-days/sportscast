// NASA GIBS satellite imagery (GOES-East ABI GeoColor).
//
// A third opinion on what the sky is actually doing, independent of both the
// model (Open-Meteo) and the radar (RainViewer). No API key, no quota, US
// government imagery — provenance we can defend on a real-money site.
//
// ⛔ Three things GIBS does differently from every other tile source here:
//
// 1. TILE ORDER IS {z}/{y}/{x}. WMTS addresses TileRow before TileCol, the
//    reverse of the XYZ convention Leaflet assumes. Getting this wrong does not
//    error — it silently renders a plausible-looking picture of the wrong place.
//
// 2. MAX NATIVE ZOOM 7, set by the GoogleMapsCompatible_Level7 matrix set this
//    layer is published in. Verified 2026-08-12: Level6 and Level8 both return
//    400 for GeoColor. Unlike RainViewer — which answers an over-zoomed request
//    with a grey "Zoom Level Not Supported" PNG as a 200 OK, the trap that once
//    had the nowcast reading placeholder lettering as rain — GIBS 400s honestly,
//    so an over-zoom shows a gap rather than a lie.
//
// 3. TIME IS REQUIRED and must be a real 10-minute mark that has already been
//    published. Asking for "now" returns nothing, because the imagery lands
//    several minutes behind the wall clock.

export const GIBS_SATELLITE_LAYER = 'GOES-East_ABI_GeoColor';
export const GIBS_MATRIX_SET = 'GoogleMapsCompatible_Level7';

/** Max zoom the matrix set actually publishes. Beyond this GIBS returns 400. */
export const GIBS_MAX_NATIVE_ZOOM = 7;

/**
 * How far behind the wall clock to ask for. GOES-East publishes a full-disk
 * GeoColor frame every 10 minutes, but processing lands it a few minutes late;
 * 40 minutes is comfortably inside what has been published without looking
 * stale to a customer.
 */
export const GIBS_LAG_MINUTES = 40;

/** The most recent 10-minute GIBS timestamp we can expect to exist. */
export function gibsFrameTime(now: Date = new Date()): string {
  const t = new Date(now.getTime() - GIBS_LAG_MINUTES * 60_000);
  t.setUTCMinutes(t.getUTCMinutes() - (t.getUTCMinutes() % 10), 0, 0);
  return t.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Note the {z}/{y}/{x} order — see (1) above. */
export function gibsTileUrl(time: string): string {
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${GIBS_SATELLITE_LAYER}`
    + `/default/${time}/${GIBS_MATRIX_SET}/{z}/{y}/{x}.png`;
}

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
// 3. TIME IS REQUIRED, and you cannot compute it. See below.

export const GIBS_SATELLITE_LAYER = 'GOES-East_ABI_GeoColor';
export const GIBS_MATRIX_SET = 'GoogleMapsCompatible_Level7';

/** Max zoom the matrix set actually publishes. Beyond this GIBS returns 400. */
export const GIBS_MAX_NATIVE_ZOOM = 7;

// ── Why the frame time is probed rather than calculated (2026-08-27) ────────
//
// This used to assume "now minus a fixed 40 minutes, rounded down to a
// 10-minute mark" was always a published frame. It is not, and the Satellite
// tab was rendering blank when it guessed wrong. Measured against the live
// service on 2026-08-27 at 16:50Z, every 10-minute mark from 12:50Z through
// 15:40Z returned 200, and then:
//
//     15:50Z  404   <- a hole, with published frames on BOTH sides of it
//     16:00Z  200
//     16:10Z  404   <- not published yet
//     16:20Z  404
//     16:30Z  404
//
// Two separate failure modes there, and a fixed lag cannot survive either one:
//
//   a) Publishing lag is variable. The newest frame was 50 minutes back, so
//      the old 40-minute setting asked for 16:10Z, which did not exist.
//   b) Individual frames go missing. 15:50Z is absent while 15:40Z and 16:00Z
//      are both fine, so even a perfectly tuned lag lands on a hole eventually.
//
// So: generate candidates newest-first and ask GIBS which one it actually has.
// One cheap z=0 probe answers it, and the result is cached, so the cost is one
// small request per five minutes for the whole page rather than per tile.

/**
 * Where the probe starts looking, in minutes behind the wall clock. One frame
 * back, deliberately optimistic: probes are HEAD requests that transfer no
 * body, so starting close to now and walking back costs almost nothing and
 * finds the freshest frame GIBS actually has rather than settling for a
 * conservative guess. Observed on 2026-08-27, the true lag swung between about
 * 30 and 50 minutes within half an hour.
 */
export const GIBS_PROBE_START_MINUTES = 10;

/**
 * The lag used when we cannot probe at all (server render, offline). No probe
 * means no way to check, so this errs old enough to usually exist.
 */
export const GIBS_FALLBACK_LAG_MINUTES = 50;

/** How far back to keep looking. 12 candidates at 10 minutes each is 2 hours. */
export const GIBS_PROBE_ATTEMPTS = 12;

/** How long a resolved frame time is reused before probing again. */
export const GIBS_RESOLVE_TTL_MS = 5 * 60_000;

function toGibsStamp(t: Date): string {
  return t.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Round down to the 10-minute grid GIBS publishes on. */
function floorToFrame(t: Date): Date {
  const f = new Date(t);
  f.setUTCMinutes(f.getUTCMinutes() - (f.getUTCMinutes() % 10), 0, 0);
  return f;
}

/**
 * Candidate frame times, newest first, on the 10-minute grid GIBS publishes.
 * Pure and deterministic: the network is only touched by the resolver below.
 */
export function gibsCandidateTimes(now: Date = new Date(), count: number = GIBS_PROBE_ATTEMPTS): string[] {
  const base = floorToFrame(new Date(now.getTime() - GIBS_PROBE_START_MINUTES * 60_000));

  const times: string[] = [];
  for (let i = 0; i < Math.max(1, count); i++) {
    times.push(toGibsStamp(new Date(base.getTime() - i * 10 * 60_000)));
  }
  return times;
}

/**
 * A frame time to show when probing cannot run: no network, or a server-side
 * render. It is a guess, not a checked answer, so it uses the conservative
 * fallback lag. Anything that can await should use getGibsFrameTime() instead.
 */
export function gibsFrameTime(now: Date = new Date()): string {
  return toGibsStamp(floorToFrame(new Date(now.getTime() - GIBS_FALLBACK_LAG_MINUTES * 60_000)));
}

/** Note the {z}/{y}/{x} order — see (1) above. */
export function gibsTileUrl(time: string): string {
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${GIBS_SATELLITE_LAYER}`
    + `/default/${time}/${GIBS_MATRIX_SET}/{z}/{y}/{x}.png`;
}

/**
 * The single whole-world tile at zoom 0, used to ask "does this frame exist?"
 * as cheaply as the service allows. A published frame answers 200; a missing
 * one answers 404 honestly rather than with a placeholder image. Probed with
 * HEAD, verified 2026-08-27 to return the same status with a zero-byte body,
 * which is what makes walking a dozen candidates affordable.
 */
export function gibsProbeUrl(time: string): string {
  return gibsTileUrl(time).replace('{z}', '0').replace('{y}', '0').replace('{x}', '0');
}

/**
 * Ask GIBS for the newest frame it actually has, newest candidate first.
 * Returns null when nothing in the window answers, or when the network itself
 * fails; callers fall back to gibsFrameTime().
 *
 * A network error stops the walk rather than continuing, so a customer who is
 * offline makes one failed request, not twelve.
 */
export async function probeGibsFrameTime(
  now: Date = new Date(),
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  for (const time of gibsCandidateTimes(now)) {
    let res: Response;
    try {
      res = await fetchImpl(gibsProbeUrl(time), { method: 'HEAD', cache: 'no-store' });
    } catch {
      return null;
    }
    if (res.ok) return time;
  }
  return null;
}

// ── Cached accessor ────────────────────────────────────────────────────────
//
// Module-level so the tile layer and the "as of" stamp resolve once between
// them instead of probing separately and, worse, disagreeing about what the
// customer is looking at.

let cachedFrame: { time: string; at: number } | null = null;
let inflight: Promise<string> | null = null;

/** Test seam: drop the cache so a test is not answered by a previous one. */
export function resetGibsFrameCache(): void {
  cachedFrame = null;
  inflight = null;
}

export async function getGibsFrameTime(
  now: Date = new Date(),
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (cachedFrame && now.getTime() - cachedFrame.at < GIBS_RESOLVE_TTL_MS) {
    return cachedFrame.time;
  }
  if (inflight) return inflight;

  inflight = probeGibsFrameTime(now, fetchImpl)
    .then((resolved) => {
      // A failed probe is deliberately NOT cached: the next render should try
      // again rather than sit on a fallback for five minutes.
      const time = resolved ?? gibsFrameTime(now);
      if (resolved) cachedFrame = { time, at: now.getTime() };
      return time;
    })
    .finally(() => { inflight = null; });

  return inflight;
}

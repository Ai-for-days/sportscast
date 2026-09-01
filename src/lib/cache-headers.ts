// ── Edge cache windows for pages that show live data ──────────────────────
//
// One place, so eleven Weatherboard routes cannot drift apart.
//
// The Weatherboards carry live scores, the period and game clock, live WES and
// open markets. They were served `s-maxage=60, stale-while-revalidate=300`,
// which means the edge could hand out a render up to **six minutes old** — 60
// seconds of cache plus five more minutes of deliberately serving the stale
// copy while it revalidated behind the reader.
//
// Found 2026-08-31 the way these things usually surface. Derek reported the new
// WES colors "are not being applied", and the page he was looking at really did
// show the old ones while the server returned the new ones: `X-Vercel-Cache:
// STALE`, `Age: 164`. The colors were the visible symptom; the same window
// applies to the scores, which is the part that actually matters on a board
// people read during a game.
//
// 30 and 30 bounds the worst case at about a minute while still absorbing the
// bulk of repeat traffic. Deliberately not zero: an uncached render costs real
// upstream work, and a board that is a few seconds behind is honest, whereas
// one that is six minutes behind is wrong.
export const WEATHERBOARD_CACHE_CONTROL = 'public, s-maxage=30, stale-while-revalidate=30';

// Venue pages carry a "Next Game" card with the same live state the boards do,
// so they get the same window. They were on the old 60/300.
export const VENUE_PAGE_CACHE_CONTROL = WEATHERBOARD_CACHE_CONTROL;

/**
 * ZIP weather pages.
 *
 * These sit in front of a SECOND cache — getForecast holds a location's
 * forecast in Redis for 10 minutes — and the two ages ADD. At the old
 * `s-maxage=300, stale-while-revalidate=1800` an edge copy could be 35 minutes
 * old, built from a forecast already 10 minutes old, so a page headlined
 * "current conditions" could be showing conditions from 45 minutes ago.
 *
 * 90 and 30 bounds the edge at two minutes, which puts the worst case around
 * 12 minutes: the forecast's own age now dominates, which is the right way
 * round. Rebuilding a ZIP page does NOT re-fetch the weather (that is what the
 * Redis layer is for), so the extra renders cost function invocations and add
 * nothing to Open-Meteo, which is already rate-limiting us.
 *
 * Deliberately still cached, and by a wide margin: this is 41,000 URLs and the
 * site's heaviest traffic. A cold render costs 7 to 9 seconds of live
 * Open-Meteo, NWS and consensus work.
 */
export const ZIP_PAGE_CACHE_CONTROL = 'public, s-maxage=90, stale-while-revalidate=30';

/**
 * A page whose content is temporarily unavailable, or otherwise must not be
 * remembered by anything.
 *
 * A ZIP page returns 503 when we hold no real forecast for that location (see
 * `[...slug].astro`). Without this it would inherit the page's normal
 * Cache-Control and the edge would happily serve that 503 to everyone for the
 * next minute and a half, turning a one-request blip into an outage for that
 * location.
 */
export const NO_STORE_CACHE_CONTROL = 'no-store';

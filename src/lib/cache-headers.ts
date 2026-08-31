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

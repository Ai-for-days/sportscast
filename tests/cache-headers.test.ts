import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WEATHERBOARD_CACHE_CONTROL,
  VENUE_PAGE_CACHE_CONTROL,
  ZIP_PAGE_CACHE_CONTROL,
  NO_STORE_CACHE_CONTROL,
} from '../src/lib/cache-headers';

// ── How stale a page is allowed to be ─────────────────────────────────────
//
// The Weatherboards were served `s-maxage=60, stale-while-revalidate=300`, so
// the edge could hand out a render up to six minutes old. It surfaced as "the
// new WES colors are not being applied" — the page really was showing the old
// ones while the server returned the new ones (X-Vercel-Cache: STALE, Age:
// 164). The colors were the visible symptom; the same window applied to the
// live score and the game clock, which is what the board is read for.
//
// These pin the ceilings rather than the exact strings, so the numbers stay
// tunable but nobody can quietly restore a six-minute window.

/**
 * Seconds for one Cache-Control directive.
 *
 * Deliberately split/startsWith rather than a regex. The first version of this
 * used `new RegExp(\`${name}=(\\d+)\`)`, the escape collapsed to a literal `d`
 * somewhere between editor and disk, every lookup returned 0, and every
 * assertion below passed against nothing at all. A helper that fails to zero
 * turns a whole test file into decoration, so the first test pins the helper.
 */
function directiveSeconds(header: string, name: string): number {
  const part = header
    .split(',')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name}=`));
  return part ? Number(part.slice(name.length + 1)) : 0;
}

function worstCaseSeconds(header: string): number {
  return directiveSeconds(header, 's-maxage') + directiveSeconds(header, 'stale-while-revalidate');
}

test('the helper actually reads the numbers', () => {
  // Pinned first and pinned literally: everything below is meaningless if this
  // quietly returns zero.
  assert.equal(directiveSeconds('public, s-maxage=42, stale-while-revalidate=7', 's-maxage'), 42);
  assert.equal(directiveSeconds('public, s-maxage=42, stale-while-revalidate=7', 'stale-while-revalidate'), 7);
  assert.equal(directiveSeconds('no-store', 's-maxage'), 0);
  assert.ok(worstCaseSeconds(WEATHERBOARD_CACHE_CONTROL) > 0, 'the board header must parse to a real number');
});

test('a board is never more than a minute behind the game it is showing', () => {
  const worst = worstCaseSeconds(WEATHERBOARD_CACHE_CONTROL);
  assert.ok(worst <= 60, `the edge can serve a ${worst}s-old board; live scores and clock cannot be that stale`);
});

test('the board is still cached — this is a bound, not an opt-out', () => {
  // Zero would be wrong in the other direction: an uncached render costs real
  // upstream work on every view, and a board a few seconds behind is honest.
  assert.ok(directiveSeconds(WEATHERBOARD_CACHE_CONTROL, 's-maxage') > 0, 'some edge caching must survive');
  assert.match(WEATHERBOARD_CACHE_CONTROL, /public/);
});

test('venue pages are as fresh as the boards, since they show the same live game', () => {
  assert.equal(VENUE_PAGE_CACHE_CONTROL, WEATHERBOARD_CACHE_CONTROL);
});

// ── The ZIP page sits on top of a second cache ────────────────────────────
//
// getForecast holds a location's forecast in Redis for 10 minutes, so the edge
// age and the forecast age ADD. At the old `s-maxage=300,
// stale-while-revalidate=1800` a page headlined "current conditions" could be
// showing conditions from 45 minutes ago: 35 at the edge on top of 10 in Redis.

const FORECAST_CACHE_SECONDS = 600;

test('the edge never dominates the forecast\'s own age on a ZIP page', () => {
  // The point is not a specific number, it is which layer is in charge. With
  // the edge window well under the forecast's, "how old is this page" is
  // answered by the weather data rather than by the cache sitting in front of
  // it. 45 minutes was the other way round.
  const edge = worstCaseSeconds(ZIP_PAGE_CACHE_CONTROL);
  assert.ok(edge > 0, 'the ZIP header must parse');
  assert.ok(
    edge < FORECAST_CACHE_SECONDS / 2,
    `the edge can hold a ZIP page for ${edge}s against a ${FORECAST_CACHE_SECONDS}s forecast; the cache is dominating the data`,
  );
});

test('an unavailable page is never stored', () => {
  // A ZIP page answers 503 when we hold no real forecast for it. Cached, that
  // turns one bad request into an outage for that location for as long as the
  // window lasts.
  assert.match(NO_STORE_CACHE_CONTROL, /no-store/);
  assert.doesNotMatch(NO_STORE_CACHE_CONTROL, /s-maxage|public/);
});

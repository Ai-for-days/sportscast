// ── Tests: an ambiguous city name resolves to the big one ──────────────────
//
// Found 2026-08-27 while checking Derek's report that the Forecast Tracker's
// pulled temperatures "seem strange". They were real temperatures, for the
// wrong town. searchLocal returned the FIRST match in a file ordered by ZIP
// code, so an ambiguous bare city name resolved to whichever state has the
// lowest ZIP prefix. "Denver" meant Denver, New York, population about 1,700.
//
// Nothing about that surfaces in the answer: you get a plausible temperature
// for a real place, logged against a forecast-accuracy record. Which is why
// these are pinned.
//
// Run with `npm test`. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchLocal } from '../src/lib/zip-lookup';

/** The first hit is what every caller of searchLocal actually uses. */
function top(query: string): string {
  const r = searchLocal(query);
  assert.ok(r.length > 0, `no match at all for "${query}"`);
  return `${r[0].city}, ${r[0].state}`;
}

test('a bare ambiguous city name resolves to the largest one', () => {
  assert.equal(top('Denver'), 'Denver, Colorado');
  assert.equal(top('Columbia'), 'Columbia, South Carolina');
  assert.equal(top('Portland'), 'Portland, Oregon');
  assert.equal(top('Kansas City'), 'Kansas City, Missouri');
});

test('the northeast bias is gone specifically', () => {
  // Every one of these was the answer before the fix, purely because those
  // states hold lower ZIP numbers.
  assert.notEqual(top('Denver'), 'Denver, New York');
  assert.notEqual(top('Columbia'), 'Columbia, Connecticut');
  assert.notEqual(top('Portland'), 'Portland, Maine');
});

test('an explicit state still wins over the size ranking', () => {
  // The ranking is a tie-break for ambiguity, not an override. An operator who
  // means the small one must still be able to say so.
  assert.equal(top('Denver, NY'), 'Denver, New York');
  assert.equal(top('Columbia, MO'), 'Columbia, Missouri');
  assert.equal(top('Portland, ME'), 'Portland, Maine');
});

test('an unambiguous name is unaffected', () => {
  assert.equal(top('Lawrence, KS'), 'Lawrence, Kansas');
  assert.equal(top('Milwaukee'), 'Milwaukee, Wisconsin');
});

test('results stay ordered largest first, not just the top one', () => {
  const denvers = searchLocal('Denver').filter(r => r.city.toLowerCase() === 'denver');
  assert.ok(denvers.length > 1, 'expected several Denvers to rank against each other');
  assert.equal(denvers[0].state, 'Colorado');
});

test('a five-digit query is still treated as a ZIP, not a city', () => {
  const r = searchLocal('29205');
  assert.ok(r.length > 0);
  assert.equal(r[0].state, 'South Carolina');
});

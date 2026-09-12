// ── Tests: retractable-roof status ─────────────────────────────────────────
//
// Reported live 2026-09-12 (Derek: "are you sure the toronto mlb game is
// outdoors?"). The board was narrating wind direction, gusts and sun glare for
// Rogers Centre before anyone had said which way the roof was, because an
// unknown roof was folded into "open".
//
// Roof state comes from MLB's own weather condition line, verified against the
// live API on 2026-09-12:
//   Final / Pre-Game -> populated: "Roof Closed" (loanDepot, Chase) or a real
//                       sky ("Sunny", "Clear") when open (Rogers, Milwaukee)
//   Scheduled        -> {} , genuinely unknown
//
// Run with `npm test`. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roofStatusFromCondition } from '../src/lib/mlb-schedule';
import { describeGameWeather } from '../src/lib/league-schedule';

test('an empty condition is unknown, never open', () => {
  // The whole bug in one assertion: a Scheduled game reports {} and the old
  // code turned that into "roof open" and then described the wind.
  assert.equal(roofStatusFromCondition(''), 'unknown');
  assert.equal(roofStatusFromCondition(undefined), 'unknown');
  assert.equal(roofStatusFromCondition(null), 'unknown');
  assert.equal(roofStatusFromCondition('   '), 'unknown');
});

test('"Roof Closed" is closed, whatever the casing', () => {
  assert.equal(roofStatusFromCondition('Roof Closed'), 'closed');
  assert.equal(roofStatusFromCondition('roof closed'), 'closed');
});

test('a real sky description means the sky is actually over the field', () => {
  for (const c of ['Sunny', 'Clear', 'Overcast', 'Partly Cloudy', 'Drizzle']) {
    assert.equal(roofStatusFromCondition(c), 'open', `${c} should read as open`);
  }
});

test('an unreported roof is flagged in the weather description, not asserted', () => {
  const base = {
    roofClosed: false, weatherMatters: true, state: 'pre' as const,
    weatherNarrative: 'Sunny and 72°F at first pitch, wind 6 mph.',
    day: null, forecastAccuracyWriteup: null, actualConditionsSummary: null,
  };
  const certain = describeGameWeather({ ...base, roofUncertain: false });
  const uncertain = describeGameWeather({ ...base, roofUncertain: true });

  assert.equal(certain, 'Sunny and 72°F at first pitch, wind 6 mph.',
    'a known-open roof reads exactly as before');
  assert.match(uncertain, /Roof status not yet reported/,
    'an unknown roof must say so before describing open-air conditions');
  assert.ok(uncertain.includes(base.weatherNarrative),
    'the forecast is still shown, just no longer asserted');
});

test('a closed roof still short-circuits everything', () => {
  const out = describeGameWeather({
    roofClosed: true, roofUncertain: false, weatherMatters: false, state: 'pre',
    weatherNarrative: 'should not appear', day: null,
    forecastAccuracyWriteup: null, actualConditionsSummary: null,
  });
  assert.match(out, /Roof closed/);
  assert.ok(!out.includes('should not appear'));
});

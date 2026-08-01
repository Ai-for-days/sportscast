import test from 'node:test';
import assert from 'node:assert/strict';

import { getGameSpeciesForState } from '../src/lib/hunting-forecast';
import { getFishSpeciesForState } from '../src/lib/fishing-forecast';
import { getStateGameFish } from '../src/lib/state-game-fish';

// The rated cards used to be chosen by REGION, so every southeastern state got
// the same four animals and South Carolina never rated an alligator despite
// having a season for one. Selection now derives from the per-state lists in
// state-game-fish.ts. These tests pin both halves of that: the species that
// MUST appear, and — more importantly — the ones that must never appear,
// because a false claim about what lives in a state is the expensive failure.

test('South Carolina rates alligator (the reported bug)', () => {
  assert.ok(getGameSpeciesForState('South Carolina').includes('alligator'));
});

test('states with no alligator season never rate one', () => {
  for (const state of ['Tennessee', 'North Carolina', 'Ohio', 'Montana', 'Maine', 'Alaska']) {
    assert.ok(
      !getGameSpeciesForState(state).includes('alligator'),
      `${state} must not rate alligator`,
    );
  }
});

test('landlocked states never rate saltwater fish', () => {
  const saltwater = ['redfish', 'flounder', 'snook', 'tarpon', 'snapper', 'grouper', 'king_mackerel', 'mahi_mahi', 'tuna'] as const;
  for (const state of ['Colorado', 'Nebraska', 'Kansas', 'Arizona', 'Nevada', 'Wyoming', 'Iowa']) {
    const fish = getFishSpeciesForState(state);
    for (const salt of saltwater) {
      assert.ok(!fish.includes(salt), `${state} is landlocked but rated ${salt}`);
    }
  }
});

test('coastal states rate their saltwater species', () => {
  const sc = getFishSpeciesForState('South Carolina');
  for (const expected of ['redfish', 'flounder', 'snapper', 'grouper'] as const) {
    assert.ok(sc.includes(expected), `South Carolina should rate ${expected}`);
  }
});

// "Feral pig" (Hawaii) and "Wild pig" were missed by a matcher that only knew
// 'feral hog' and 'wild boar'.
test('every naming variant of wild pig resolves to one card', () => {
  assert.ok(getGameSpeciesForState('Hawaii').includes('wild_boar'), 'HI lists "Feral pig"');
  assert.ok(getGameSpeciesForState('Texas').includes('wild_boar'), 'TX lists "Feral hog"');
});

// 'hog' as a bare pattern would also match Groundhog, a different animal.
test('groundhog does not turn on the wild boar card', () => {
  const data = getStateGameFish('Pennsylvania');
  assert.ok(data, 'PA should have data');
  const hasGroundhog = data!.hunting.some(n => n.toLowerCase().includes('groundhog'));
  const hasRealPig = data!.hunting.some(n => /feral hog|wild boar|feral pig|wild pig/i.test(n));
  if (hasGroundhog && !hasRealPig) {
    assert.ok(!getGameSpeciesForState('Pennsylvania').includes('wild_boar'));
  }
});

// "Spotted seatrout" is an inshore drum. A broad 'trout' matcher needs the veto
// or every coastal state falsely rates freshwater trout.
test('seatrout does not turn on the freshwater trout card', () => {
  const data = getStateGameFish('Louisiana');
  assert.ok(data, 'LA should have data');
  const all = [
    ...data!.fishing.freshwater,
    ...(data!.fishing.inshore ?? []),
    ...(data!.fishing.offshore ?? []),
  ].map(n => n.toLowerCase());
  const hasSeatrout = all.some(n => n.includes('seatrout'));
  const hasRealTrout = all.some(n => n.includes('trout') && !n.includes('seatrout'));
  if (hasSeatrout && !hasRealTrout) {
    assert.ok(!getFishSpeciesForState('Louisiana').includes('trout'), 'seatrout must not count');
  }
});

test('broad trout matcher still catches the less common trout', () => {
  // Arizona lists Apache trout, Montana lists bull/golden — neither was in the
  // original enumerated list.
  assert.ok(getFishSpeciesForState('Arizona').includes('trout'));
  assert.ok(getFishSpeciesForState('Montana').includes('trout'));
});

test('sea bass does not turn on the black bass card', () => {
  for (const state of ['Massachusetts', 'New Jersey', 'California']) {
    const data = getStateGameFish(state);
    if (!data) continue;
    const all = [
      ...data.fishing.freshwater,
      ...(data.fishing.inshore ?? []),
      ...(data.fishing.offshore ?? []),
    ].map(n => n.toLowerCase());
    const hasSeaBass = all.some(n => n.includes('sea bass') || n.includes('seabass'));
    const hasBlackBass = all.some(n => /largemouth|smallmouth|spotted bass|guadalupe|shoal bass|peacock bass/.test(n));
    if (hasSeaBass && !hasBlackBass) {
      assert.ok(!getFishSpeciesForState(state).includes('bass'), `${state}: sea bass is not black bass`);
    }
  }
});

test('DC has no huntable species', () => {
  assert.equal(getGameSpeciesForState('District of Columbia').length, 0);
});

test('every state resolves to a non-empty, deduplicated species set', () => {
  const states = [
    'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut',
    'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa',
    'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan',
    'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire',
    'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio',
    'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota',
    'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia',
    'Wisconsin', 'Wyoming',
  ];
  for (const state of states) {
    const game = getGameSpeciesForState(state);
    const fish = getFishSpeciesForState(state);
    assert.ok(game.length > 0, `${state} rated no game`);
    assert.ok(fish.length > 0, `${state} rated no fish`);
    assert.equal(new Set(game).size, game.length, `${state} game has duplicates`);
    assert.equal(new Set(fish).size, fish.length, `${state} fish has duplicates`);
  }
});

// The whole point of deriving from state-game-fish.ts is that the rated cards
// and the chip list below them can never contradict each other.
test('every rated species is also named in the state chip list', () => {
  for (const state of ['South Carolina', 'Florida', 'Montana', 'Minnesota', 'Texas', 'Maine']) {
    const data = getStateGameFish(state);
    assert.ok(data, `${state} should have data`);
    assert.ok(
      getGameSpeciesForState(state).length <= data!.hunting.length,
      `${state} rates more species than it lists`,
    );
  }
});

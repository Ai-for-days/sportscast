import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMarketDesign } from '../src/lib/wager-market-design';
import type { CreateWagerInput } from '../src/lib/wager-types';

function futureDate(daysOut: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOut);
  return d.toISOString().slice(0, 10);
}

const TAMPA = { name: 'Tampa, FL', lat: 27.9759, lon: -82.5033 };
const DETROIT = { name: 'Detroit, MI', lat: 42.3390, lon: -83.0485 };

test('over/under skew warning explains why lopsided implied probabilities matter, not just the number', async () => {
  const input: CreateWagerInput = {
    kind: 'over-under',
    title: 'Tropicana Field Low Day Temp',
    metric: 'low_temp',
    targetDate: futureDate(3),
    location: TAMPA,
    line: 91,
    over: { odds: 132 },
    under: { odds: -159 },
  };

  const review = await analyzeMarketDesign(input, { reviewerId: 'test-operator', persist: false });

  const skewWarning = review.warnings.find((w) => w.startsWith('Significant side skew'));
  assert.ok(skewWarning, `expected a side-skew warning, got: ${JSON.stringify(review.warnings)}`);
  assert.match(skewWarning!, /^Significant side skew \(18%\) — implied probabilities lopsided:/);
  // Per Derek (2026-08-26): a warning must say WHY it matters, not just restate the number.
  assert.match(skewWarning!, /50\/50/);
  assert.match(skewWarning!, /unattractive|risk/);
});

test('over/under high edge warning explains the comfort-ceiling threshold and player impact', async () => {
  const input: CreateWagerInput = {
    kind: 'over-under',
    title: 'High edge O/U',
    metric: 'high_temp',
    targetDate: futureDate(3),
    location: TAMPA,
    line: 90,
    over: { odds: -120 },
    under: { odds: -120 },
  };

  const review = await analyzeMarketDesign(input, { reviewerId: 'test-operator', persist: false });
  const edgeWarning = review.warnings.find((w) => w.startsWith('Edge'));
  assert.ok(edgeWarning, `expected an edge warning, got: ${JSON.stringify(review.warnings)}`);
  assert.match(edgeWarning!, /8% comfort ceiling/);
  assert.match(edgeWarning!, /stacked against them/);
});

test('pointspread heavy skew warning explains the underdog-side impact', async () => {
  const input: CreateWagerInput = {
    kind: 'pointspread',
    title: 'Tropicana Field vs Comerica Park',
    metric: 'high_temp',
    targetDate: futureDate(3),
    locationA: TAMPA,
    locationB: DETROIT,
    spread: -10,
    locationAOdds: -260,
    locationBOdds: 210,
  };

  const review = await analyzeMarketDesign(input, { reviewerId: 'test-operator', persist: false });
  const skewWarning = review.warnings.find((w) => w.startsWith('Heavy side skew'));
  assert.ok(skewWarning, `expected a heavy side-skew warning, got: ${JSON.stringify(review.warnings)}`);
  assert.match(skewWarning!, /far from an even split/);
  assert.match(skewWarning!, /underdog side offers little realistic chance/);
});

test('pointspread large spread-magnitude warning explains why the contest is decided in advance', async () => {
  const input: CreateWagerInput = {
    kind: 'pointspread',
    title: 'Huge spread',
    metric: 'high_temp',
    targetDate: futureDate(3),
    locationA: TAMPA,
    locationB: DETROIT,
    spread: 35,
    locationAOdds: -110,
    locationBOdds: -110,
  };

  const review = await analyzeMarketDesign(input, { reviewerId: 'test-operator', persist: false });
  const magnitudeWarning = review.warnings.find((w) => w.startsWith('Spread magnitude'));
  assert.ok(magnitudeWarning, `expected a spread-magnitude warning, got: ${JSON.stringify(review.warnings)}`);
  assert.match(magnitudeWarning!, /nearly determined before the day starts/);
  assert.match(magnitudeWarning!, /no real contest/);
});

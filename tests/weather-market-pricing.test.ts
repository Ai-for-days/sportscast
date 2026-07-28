// ── Tests: weather market pricing ───────────────────────────────────────
//
// The idea generator used to stamp a hardcoded -110 on both sides of every
// pointspread, so a 10°F gap five days out priced identically to a 10°F gap
// tomorrow. These cover the model that replaced it.
//
// Run with `npm test`. Pure functions, no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalCdf,
  sideSigmaF,
  spreadSigmaF,
  priceSpread,
  probabilityToAmericanOdds,
  americanOddsToProbability,
  balancedSpreadF,
  DEFAULT_TARGET_HOLD,
} from '../src/lib/weather-market-pricing';

// ── Math ───────────────────────────────────────────────────────────────

test('normalCdf matches known values', () => {
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-6);
  assert.ok(Math.abs(normalCdf(1.96) - 0.975) < 1e-3);
  assert.ok(Math.abs(normalCdf(-1.96) - 0.025) < 1e-3);
});

test('odds conversion round-trips', () => {
  for (const p of [0.25, 0.4, 0.5, 0.6, 0.75]) {
    const odds = probabilityToAmericanOdds(p);
    assert.ok(Math.abs(americanOddsToProbability(odds) - p) < 0.01, `p=${p} odds=${odds}`);
  }
});

test('an even market prices at -110 either side', () => {
  // Sanity anchor: 50/50 plus the default hold is the classic -110.
  const odds = probabilityToAmericanOdds(0.5 * (1 + DEFAULT_TARGET_HOLD));
  assert.ok(Math.abs(odds - -110) <= 3, `expected about -110, got ${odds}`);
});

// ── Uncertainty grows with horizon ─────────────────────────────────────

test('forecast sigma grows with the horizon', () => {
  const d1 = sideSigmaF(1);
  const d5 = sideSigmaF(5);
  assert.ok(d5 > d1 * 1.5, `5-day sigma (${d5}) should be well above 1-day (${d1})`);
});

test('sigma keeps growing past the table', () => {
  assert.ok(sideSigmaF(10) > sideSigmaF(6));
});

test('daily lows carry more uncertainty than highs', () => {
  assert.ok(sideSigmaF(2, 'daily_low') > sideSigmaF(2, 'daily_high'));
});

test('same-region pairs are more predictable than cross-region', () => {
  // Correlated errors partly cancel in a difference.
  const same = spreadSigmaF({ daysAhead: 3, sameRegion: true });
  const cross = spreadSigmaF({ daysAhead: 3, sameRegion: false });
  assert.ok(same < cross, `same-region ${same} should be below cross-region ${cross}`);
});

test('source disagreement widens sigma', () => {
  const calm = spreadSigmaF({ daysAhead: 2 });
  const split = spreadSigmaF({ daysAhead: 2, sourceDisagreementF: 6 });
  assert.ok(split > calm * 1.2, 'a 6F source split should materially widen sigma');
});

// ── Pricing behaviour ──────────────────────────────────────────────────

test('a line at the forecast difference prices close to even', () => {
  const p = priceSpread({ forecastDifferenceF: 10, spreadF: -10, sigmaF: 5 });
  assert.ok(Math.abs(p.fairProbabilityA - 0.5) < 0.05, `got ${p.fairProbabilityA}`);
  assert.ok(Math.abs(p.oddsA - p.oddsB) <= 12, 'both sides should price similarly');
});

test('a line off the forecast moves the price', () => {
  // Forecast says A wins by 10; the line asks A to win by 14.
  const p = priceSpread({ forecastDifferenceF: 10, spreadF: -14, sigmaF: 5 });
  assert.ok(p.fairProbabilityA < 0.35, `A should be an underdog, got ${p.fairProbabilityA}`);
  assert.ok(p.oddsA > 0, 'A should be plus money');
  assert.ok(p.oddsB < 0, 'B should be favoured');
});

test('THE POINT OF THIS MODULE: horizon changes the price', () => {
  const sameLine = { forecastDifferenceF: 10, spreadF: -13 };
  const tomorrow = priceSpread({ ...sameLine, sigmaF: spreadSigmaF({ daysAhead: 1 }) });
  const fiveDays = priceSpread({ ...sameLine, sigmaF: spreadSigmaF({ daysAhead: 5 }) });
  // Same gap, same line — but at five days the outcome is far less certain, so
  // the underdog side must be priced closer to even.
  assert.ok(
    fiveDays.fairProbabilityA > tomorrow.fairProbabilityA + 0.05,
    `5-day ${fiveDays.fairProbabilityA} should be nearer 50% than 1-day ${tomorrow.fairProbabilityA}`,
  );
});

test('probabilities and push sum to one', () => {
  const p = priceSpread({ forecastDifferenceF: 7, spreadF: -7, sigmaF: 4 });
  assert.ok(Math.abs(p.fairProbabilityA + p.fairProbabilityB - 1) < 1e-6, 'conditional probs sum to 1');
  assert.ok(p.pushProbability > 0 && p.pushProbability < 1);
});

test('a tight forecast makes pushes more likely than a loose one', () => {
  const tight = priceSpread({ forecastDifferenceF: 8, spreadF: -8, sigmaF: 1.5 });
  const loose = priceSpread({ forecastDifferenceF: 8, spreadF: -8, sigmaF: 8 });
  assert.ok(tight.pushProbability > loose.pushProbability);
});

test('the offered price carries a hold, the fair price does not', () => {
  const p = priceSpread({ forecastDifferenceF: 10, spreadF: -10, sigmaF: 5 });
  const offered = americanOddsToProbability(p.oddsA) + americanOddsToProbability(p.oddsB);
  const fair = americanOddsToProbability(p.fairOddsA) + americanOddsToProbability(p.fairOddsB);
  assert.ok(offered > 1.0, 'offered book must be overround');
  assert.ok(Math.abs(fair - 1.0) < 0.02, `fair book should be ~100%, got ${fair}`);
  assert.ok(p.holdPct > 0.01 && p.holdPct < 0.12, `hold out of range: ${p.holdPct}`);
});

test('a custom hold is respected', () => {
  const low = priceSpread({ forecastDifferenceF: 5, spreadF: -5, sigmaF: 4, targetHold: 0.02 });
  const high = priceSpread({ forecastDifferenceF: 5, spreadF: -5, sigmaF: 4, targetHold: 0.09 });
  assert.ok(high.holdPct > low.holdPct);
});

test('degenerate sigma does not produce absurd prices', () => {
  const p = priceSpread({ forecastDifferenceF: 10, spreadF: -10, sigmaF: 0 });
  assert.ok(Number.isFinite(p.oddsA) && Number.isFinite(p.oddsB));
  assert.ok(Math.abs(p.oddsA) <= 2000 && Math.abs(p.oddsB) <= 2000);
});

// ── Line granularity ───────────────────────────────────────────────────

test('whole-degree lines negate and round the forecast difference', () => {
  assert.equal(balancedSpreadF(10.4, 'whole'), -10);
  assert.equal(balancedSpreadF(-7.6, 'whole'), 8);
});

test('half-degree lines land on a .5 and default to half', () => {
  // A 10F forecast gap becomes a 10.5 line: the favourite must win by 11+.
  assert.equal(balancedSpreadF(10), -10.5);
  assert.equal(balancedSpreadF(10, 'half'), -10.5);
  assert.equal(balancedSpreadF(-7), 7.5);
  for (const d of [0, 3, 8.2, 12.7, -4, -11.5]) {
    const line = balancedSpreadF(d, 'half');
    assert.equal(Math.abs(line % 1), 0.5, `line ${line} for d=${d} must be a half-degree`);
  }
});

test('half-degree lines make a push arithmetically impossible', () => {
  // Whole-degree observations can never tie a .5 line.
  const p = priceSpread({ forecastDifferenceF: 10, spreadF: balancedSpreadF(10), sigmaF: 4 });
  assert.equal(p.pushProbability, 0, `expected zero push, got ${p.pushProbability}`);
  assert.ok(Math.abs(p.fairProbabilityA + p.fairProbabilityB - 1) < 1e-6);
});

test('the half-degree tie going to the underdog is reflected in the odds', () => {
  // The favourite must clear the gap outright, so it is NOT a 50/50 line —
  // the price has to compensate, which a fixed -110 could never do.
  const p = priceSpread({ forecastDifferenceF: 10, spreadF: balancedSpreadF(10), sigmaF: 4 });
  assert.ok(p.fairProbabilityA < 0.5, `A should be under 50%, got ${p.fairProbabilityA}`);
  assert.ok(p.oddsA > p.oddsB, 'A must be the longer price');
});

test('a whole-degree line on the same market still pushes', () => {
  const whole = priceSpread({ forecastDifferenceF: 10, spreadF: balancedSpreadF(10, 'whole'), sigmaF: 4 });
  assert.ok(whole.pushProbability > 0.05, `expected a real push rate, got ${whole.pushProbability}`);
});

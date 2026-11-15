// ── Tests: weather → play impact honesty (WOW-021 slice A) ─────────────────
//
// The impact card must not make claims it has no evidence for (scoring,
// "gap between teams", fades), must not count humidity as a factor when it is
// cool, must mention big gusts, and must not silently use an hourly point far
// from the requested time. Run with `npm test`. No network — all pure.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeWeatherImpact, pickHourlyPoint } from '../src/lib/weather-play-impact';

const BANNED = [
  'lower scoring',
  'gap between teams',
  'fade',
  'edge',
  'value',
  'lock',
  'measurable effect',
  'heavy rain',
];

function outputText(a: ReturnType<typeof analyzeWeatherImpact>): string[] {
  return [a.summary, a.keyInsight, ...a.factors.flatMap(f => [f.factor, f.detail])];
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local, offset-free hourly times like Open-Meteo's timezone=auto output. */
function hourlySeries(start: Date, hours: number): { time: string }[] {
  const out: { time: string }[] = [];
  for (let i = 0; i < hours; i++) {
    const d = new Date(start.getTime() + i * 3600_000);
    out.push({
      time: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:00`,
    });
  }
  return out;
}

test('t1: no banned claim phrases in any output text across an input grid', () => {
  const temps = [20, 25, 26, 40, 41, 60, 74, 75, 84, 85, 95, 105];
  const hums = [10, 40, 59, 60, 79, 80, 90, 100];
  const winds = [0, 5, 12, 14, 15, 19, 20, 30, 40];
  const gustAdds: (number | undefined)[] = [undefined, 0, 5, 10, 15, 25];
  const precips = [0, 20, 39, 40, 69, 70, 85, 100];
  let checked = 0;
  for (const tempF of temps)
    for (const humidity of hums)
      for (const windSpeedMph of winds)
        for (const ga of gustAdds)
          for (const precipProbability of precips) {
            const a = analyzeWeatherImpact({
              tempF,
              humidity,
              windSpeedMph,
              windGustMph: ga === undefined ? undefined : windSpeedMph + ga,
              precipProbability,
            });
            for (const text of outputText(a)) {
              const lower = text.toLowerCase();
              for (const phrase of BANNED) {
                assert.ok(
                  !lower.includes(phrase),
                  `"${phrase}" found in "${text}" (t=${tempF} h=${humidity} w=${windSpeedMph} g=${ga} p=${precipProbability})`,
                );
              }
            }
            checked++;
          }
  assert.ok(checked > 1000);
});

test('t2: 7-day hourly array with a day-10 target returns null', () => {
  const start = new Date(2026, 10, 15, 0, 0, 0);
  const hourly = hourlySeries(start, 7 * 24);
  const target = new Date(2026, 10, 25, 13, 0, 0); // day 10
  assert.equal(pickHourlyPoint(hourly, target, 90), null);
});

test('pickHourlyPoint: a point 89 minutes away is returned, 91 minutes away is null', () => {
  const hourly = [{ time: '2026-11-15T12:00' }];
  const base = new Date('2026-11-15T12:00');
  const at89 = new Date(base.getTime() + 89 * 60_000);
  const at91 = new Date(base.getTime() + 91 * 60_000);
  assert.deepEqual(pickHourlyPoint(hourly, at89, 90), hourly[0]);
  assert.equal(pickHourlyPoint(hourly, at91, 90), null);
});

test('pickHourlyPoint: picks the closest point within tolerance', () => {
  const hourly = hourlySeries(new Date(2026, 10, 15, 0, 0, 0), 48);
  const target = new Date(2026, 10, 15, 13, 20, 0);
  const p = pickHourlyPoint(hourly, target, 90);
  assert.ok(p);
  assert.equal(p!.time, '2026-11-15T13:00');
});

test('t3: humidity 90% at 45°F is level "none"', () => {
  const a = analyzeWeatherImpact({ tempF: 45, humidity: 90, windSpeedMph: 5, precipProbability: 10 });
  const h = a.factors.find(f => f.factor === 'Humidity');
  assert.ok(h);
  assert.equal(h!.level, 'none');
});

test('humidity 90% at 80°F is still level "high"', () => {
  const a = analyzeWeatherImpact({ tempF: 80, humidity: 90, windSpeedMph: 5, precipProbability: 10 });
  assert.equal(a.factors.find(f => f.factor === 'Humidity')!.level, 'high');
});

test('t4: gust text appears at 12 mph sustained with 25 mph gusts, absent with 15 mph gusts', () => {
  const withGust = analyzeWeatherImpact({ tempF: 60, humidity: 50, windSpeedMph: 12, windGustMph: 25, precipProbability: 0 });
  const w1 = withGust.factors.find(f => f.factor === 'Wind')!;
  assert.match(w1.detail.toLowerCase(), /gusts to 25 mph/);

  const smallGust = analyzeWeatherImpact({ tempF: 60, humidity: 50, windSpeedMph: 12, windGustMph: 15, precipProbability: 0 });
  const w2 = smallGust.factors.find(f => f.factor === 'Wind')!;
  assert.doesNotMatch(w2.detail.toLowerCase(), /gust/);
  // No new level threshold: gusts do not change the wind level.
  assert.equal(w1.level, w2.level);
});

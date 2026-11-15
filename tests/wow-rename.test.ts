// WOW-025 R0: WES -> "WOW Score" display rename. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { effectiveFactorWeights, computeGameWes, DEFAULT_WES_CONFIG } from '../src/lib/wes';
import type { ForecastPoint } from '../src/lib/types';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

test('R0: no source file references /what-is-wes; vercel.json has exactly one 301 to /wow-score', () => {
  const hits = walk('src').filter((p) => readFileSync(p, 'utf8').includes('/what-is-wes'));
  assert.deepEqual(hits, []);
  const vj = JSON.parse(readFileSync('vercel.json', 'utf8'));
  const r = vj.redirects.filter((x: any) => x.source === '/what-is-wes');
  assert.equal(r.length, 1);
  assert.equal(r[0].destination, '/wow-score');
  assert.ok(r[0].statusCode === 301 || r[0].permanent === true);
});

test('R0: the new page exists and the sitemap lists it', () => {
  assert.ok(readFileSync('src/pages/wow-score.astro', 'utf8').includes('The WOW Score'));
  assert.ok(readFileSync('src/lib/seo/sitemap-shards.ts', 'utf8').includes('/wow-score'));
});

test('R0: public badges say WOW, not WES', () => {
  for (const p of ['src/components/forecast/DailyForecast.tsx', 'src/components/forecast/WeatherHero.tsx',
    'src/components/schedule/WeatherboardTable.astro', 'src/components/schedule/WeatherboardExtendedTable.astro',
    'src/components/layout/Header.astro']) {
    const s = readFileSync(p, 'utf8');
    assert.ok(!/>WES<|What's WES\?|WHAT IS WES/.test(s), p);
  }
});

test('WOW-022: effective factor weights reproduce the Professor hand derivation', () => {
  const w = effectiveFactorWeights();
  const want: Record<string, number> = {
    temperatureScore: 0.370, precipitationScore: 0.220, humidityScore: 0.130, windScore: 0.100,
    solarScore: 0.077, visibilityScore: 0.053, severeWeatherScore: 0.031, gustScore: 0.020,
  };
  for (const [k, v] of Object.entries(want)) assert.ok(Math.abs((w as any)[k] - v) < 0.0015, `${k} ${(w as any)[k]}`);
  assert.ok(Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

const KICKOFF_MS = Date.parse('2026-11-14T18:00:00Z');
function hourly(o: Partial<ForecastPoint>): ForecastPoint[] {
  return Array.from({ length: 8 }, (_, h) => ({
    time: new Date(KICKOFF_MS + h * 3600000).toISOString().slice(0, 16), tempK: 300, tempF: 72, tempC: 22, humidity: 50,
    dewPointF: 52, precipMm: 0, precipProbability: 5, windSpeedMph: 6, windDirectionDeg: 180, windGustMph: 12,
    cloudCover: 20, pressure: 1013, feelsLikeF: 72, uvIndex: 4, visibility: 10, description: 'Clear', icon: '01d', ...o,
  }));
}
const game = (o: Partial<ForecastPoint>) => computeGameWes(hourly(o), new Date(KICKOFF_MS).toISOString(), 0, 40, -83, [], DEFAULT_WES_CONFIG)!;

test('WOW-022: the three hand scores reproduce within 1 point (uncapped raw)', () => {
  const windy = game({ feelsLikeF: 65, tempF: 65, windSpeedMph: 25, windGustMph: 40 });
  assert.ok(Math.abs(windy.wesRaw - 94) <= 1, `windy raw ${windy.wesRaw}`);
  assert.ok(Math.abs(windy.environmental - 88.4) <= 1, `windy E ${windy.environmental}`);
  const cold = game({ feelsLikeF: 20, tempF: 20, windSpeedMph: 3, windGustMph: 5, uvIndex: 0, cloudCover: 0 });
  assert.ok(Math.abs(cold.wesRaw - 74) <= 1, `cold raw ${cold.wesRaw}`);
});

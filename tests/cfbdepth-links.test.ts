// DBD 2026-11-17: college football venue pages link the home team's depth chart on cfbdepth.com.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cfbdepthDepthChart, CFBDEPTH_TEAM_COUNT } from '../src/lib/cfbdepth-links';
import { venues } from '../src/lib/venue-data';

test('Vanderbilt links its depth chart, named by school', () => {
  assert.deepEqual(cfbdepthDepthChart('Vanderbilt Commodores'), { school: 'Vanderbilt', url: 'https://cfbdepth.com/vanderbilt/depth-chart' });
  assert.deepEqual(cfbdepthDepthChart('Georgia Bulldogs'), { school: 'Georgia', url: 'https://cfbdepth.com/uga/depth-chart' });
  assert.deepEqual(cfbdepthDepthChart("Louisiana Ragin' Cajuns"), { school: 'Louisiana', url: 'https://cfbdepth.com/louisiana/depth-chart' });
  assert.equal(cfbdepthDepthChart('Nobody FC'), null);
  assert.equal(cfbdepthDepthChart(undefined), null);
});

const FBS = new Set(['ACC', 'Big Ten', 'Big 12', 'SEC', 'Pac-12', 'American', 'AAC', 'Mountain West', 'MAC', 'Sun Belt',
  'Conference USA', 'C-USA', 'CUSA', 'Independent', 'FBS Independent', 'Independents']);

test('every FBS venue team has a depth chart link (cfbdepth.com covers the FBS schools)', () => {
  const fbs = venues.filter((v) => v.league === 'ncaa-football' && v.team && FBS.has(v.conference ?? ''));
  assert.ok(fbs.length >= 130, String(fbs.length));
  const missing = fbs.filter((v) => !cfbdepthDepthChart(v.team)).map((v) => v.team);
  assert.deepEqual(missing, []);
  assert.ok(CFBDEPTH_TEAM_COUNT >= 130);
});

test('the venue page shows the link on the city line, college football only', () => {
  const s = readFileSync('src/pages/venues/weather/[league]/[city].astro', 'utf8');
  assert.ok(s.includes("venue.league === 'ncaa-football' ? cfbdepthDepthChart(venue.team) : null"));
  assert.ok(s.includes('{cfbDepth.school} football depth chart</a> from CFBDepth.com'));
  assert.ok(s.indexOf('Weather Now in {venue.city}') < s.indexOf('football depth chart</a>'));
});

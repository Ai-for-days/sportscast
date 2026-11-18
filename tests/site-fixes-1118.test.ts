import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sideMarketGroups, outcomeLabel, legLabel, splitTeams } from '../src/lib/sidebar-markets';
import { gameWeatherWagers, feedGameForVenues, venueForFeedTeam, etDate } from '../src/lib/game-pairing';
import { fillRotationsFromFeedNames } from '../src/lib/odds-source';
import { getVenueById, getVenuesByLeague } from '../src/lib/venue-data';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// Shapes taken from the live /api/sportsbook/games answer for Iowa State @ Central Florida, 2026-11-18.
const UCF = {
  '2W-12': [{ key: '2W-12', description: 'Moneyline', outcomes: [
    { id: '1', type: 'A', description: 'Iowa State', american: '+110', handicap: null },
    { id: '2', type: 'H', description: 'Central Florida', american: '-130', handicap: null }] }],
  '2W-HCAP': [
    { key: '2W-HCAP', description: 'Point Spread', outcomes: [
      { id: '3', type: 'A', description: 'Iowa State', american: '-112', handicap: '2.5' },
      { id: '4', type: 'H', description: 'Central Florida', american: '-108', handicap: '-2.5' }] },
    { key: '2W-HCAP', description: 'Spread', outcomes: [
      { id: '5', type: 'A', description: 'Iowa State', american: '+110', handicap: '-1.0' },
      { id: '6', type: 'H', description: 'Central Florida', american: '-145', handicap: '1.0' }] }],
  '2W-OU': [
    { key: '2W-OU', description: 'Total', outcomes: [
      { id: '7', type: 'O', description: 'Over', american: '-112', handicap: '49.5' },
      { id: '8', type: 'U', description: 'Under', american: '-108', handicap: '49.5' }] },
    { key: '2W-OU', description: 'Total Points', outcomes: [
      { id: '9', type: 'O', description: 'Over', american: '-150', handicap: '47.5' },
      { id: '10', type: 'U', description: 'Under', american: '+115', handicap: '47.5' }] },
    { key: '2W-OU', description: 'Total Points - Central Florida', outcomes: [
      { id: '11', type: 'O', description: 'Over', american: '+110', handicap: '27.5' },
      { id: '12', type: 'U', description: 'Under', american: '-145', handicap: '27.5' }] }],
  'GAME-PROP-12': [{ key: 'GAME-PROP-12', description: 'Alternate Passing Yards - Jaylen Raynor (ISU)', outcomes: [
    { id: '13', type: 'X', description: '175+ Passing Yards', american: '-130', handicap: null }] }],
  'GAME-PROP-DYN': [{ key: 'GAME-PROP-DYN', description: 'Winning Margin', outcomes: [
    { id: '14', type: 'H', description: 'Central Florida by 1-6 points', american: '+370', handicap: null }] }],
};

describe('sidebar markets read as real bets (DBD 2026-11-18)', () => {
  const groups = sideMarketGroups(UCF as any);
  const all = groups.flatMap((g) => g.markets);

  it('every market has its own id and a distinct, meaningful title', () => {
    assert.equal(new Set(all.map((m) => m.id)).size, all.length);
    assert.deepEqual(all.map((m) => m.title).filter((t) => t === 'Spread' || t === 'Over/Under'), []);
    assert.ok(all.some((m) => m.title === 'Point Spread'));
    assert.ok(all.some((m) => m.title === 'Alternate Spread'));
    assert.ok(all.some((m) => m.title === 'Total (Over/Under)'));
    assert.ok(all.some((m) => m.title === 'Alternate Total'));
    assert.ok(all.some((m) => m.title === 'Team Total - Central Florida'));
  });
  it('every outcome carries its team or side and its line', () => {
    const labels = all.flatMap((m) => m.outcomes.map((o) => o.label));
    for (const l of ['Iowa State +2.5', 'Central Florida -2.5', 'Over 49.5', 'Under 47.5', 'Iowa State -1', 'Over 27.5']) {
      assert.ok(labels.includes(l), l);
    }
    assert.equal(outcomeLabel({ description: 'Iowa State', type: 'A', handicap: '0' }), 'Iowa State PK');
  });
  it('groups in a fixed order with props split out', () => {
    assert.deepEqual(groups.map((g) => g.name), ['Main Lines', 'Alternate Lines', 'Team Totals', 'Player Props', 'Game Props']);
  });
  it('bet slip names the team, not AWAY/HOME', () => {
    const d = 'Iowa State @ Central Florida';
    assert.deepEqual(splitTeams(d), { away: 'Iowa State', home: 'Central Florida' });
    assert.equal(legLabel({ gameDescription: d, oddsType: 'moneyline', side: 'away' }), 'Iowa State moneyline');
    assert.equal(legLabel({ gameDescription: d, oddsType: 'spread', side: 'home', line: -2.5 }), 'Central Florida -2.5');
    assert.equal(legLabel({ gameDescription: d, oddsType: 'total', side: 'over', line: 49.5 }), 'Over 49.5');
    assert.equal(legLabel({ gameDescription: d, oddsType: 'prop', marketDescription: 'Alternate Total', outcomeDescription: 'Over 47.5' }), 'Alternate Total: Over 47.5');
  });
  it('the card shows team names and the bet slip uses legLabel', () => {
    assert.match(read('src/components/betting/GamesList.tsx'), /teamName\(side\)/);
    assert.match(read('src/components/betting/BetSlip.tsx'), /legLabel\(leg\)/);
  });
});

describe('game page weather markets and Bovada odds (DBD 2026-11-18)', () => {
  const duke = getVenueById('ncaa-duke')!;
  const clem = getVenueById('ncaa-clemson')!;
  const loc = (v: any) => ({ name: v.name, lat: v.lat, lon: v.lon });
  const ou = (metric: string, v: any) => ({ id: metric, kind: 'over-under', status: 'open', metric, location: loc(v), lockTime: '2099-01-01T00:00:00Z' });

  it('includes the game-start over/under (actual_temp) the board shows', () => {
    const got = gameWeatherWagers([ou('actual_temp', duke), ou('high_temp', clem), ou('actual_wind', duke)] as any, duke, clem);
    assert.deepEqual(got.map((w) => w.id).sort(), ['actual_temp', 'high_temp']);
  });
  it('finds the feed game either way round, on the right Eastern date only', () => {
    const start = Date.parse('2026-11-21T00:30:00Z'); // Friday 7:30 PM ET
    const feed = [
      { id: 'x', startTime: start, home: 'Duke', away: 'Clemson' },
      { id: 'y', startTime: start, home: 'Duke', away: 'Wake Forest' },
    ];
    assert.equal(etDate(start), '2026-11-20');
    assert.equal(feedGameForVenues('ncaa-football', feed, duke, clem, '2026-11-20')?.id, 'x');
    assert.equal(feedGameForVenues('ncaa-football', feed, clem, duke, '2026-11-20')?.id, 'x');
    assert.equal(feedGameForVenues('ncaa-football', feed, duke, clem, '2026-11-21'), null);
  });
  it('maps feed team names back to our venues', () => {
    const v = getVenuesByLeague('ncaa-football');
    assert.equal(venueForFeedTeam('ncaa-football', v, 'Duke')?.id, 'ncaa-duke');
    assert.equal(venueForFeedTeam('ncaa-football', v, 'Clemson')?.id, 'ncaa-clemson');
  });
  it('the odds page puts Wager on Weather last; the wager page shows Bovada below and full cards', () => {
    assert.match(read('src/components/odds/GameOdds.tsx'), /\.\.\.\(weatherWagers \? \[WEATHER_TAB\] : \[\]\)\]/);
    assert.match(read('src/pages/weatherboard/game/[id].astro'), /weatherWagers=\{weatherWagers\}/);
    const page = read('src/pages/wagers/game.astro');
    assert.ok(page.indexOf('<GameWagerGrid') < page.indexOf('<GameOdds'));
    assert.match(read('src/components/public/GameWagerGrid.tsx'), /<WagerCard wager=\{w\} full \/>/);
  });
});

describe('rotation numbers fall back to the feed names (Akron, DBD 2026-11-18)', () => {
  it('fills a missing pair from the feed game names, flipping a swapped match', async () => {
    const rots: any[] = [null, { homeRotation: 1, awayRotation: 2 }, null];
    const seen: string[] = [];
    await fillRotationsFromFeedNames('ncaa-football', rots, [
      { s: { home: 'Massachusetts', away: 'Akron', startTime: 0 }, swapped: false },
      { s: { home: 'X', away: 'Y', startTime: 0 }, swapped: false },
      { s: { home: 'Duke', away: 'Clemson', startTime: 0 }, swapped: true },
    ], {
      configured: () => true,
      lines: (async (_l: string, h: string, a: string) => { seen.push(`${a}@${h}`); return h === 'Massachusetts' ? { homeRotation: 310, awayRotation: 309 } : null; }) as any,
      pairs: (async (_l: string, gs: any[]) => gs.map((g) => (g.homeTeam === 'Duke' ? { home: 400, away: 399 } : null))) as any,
    });
    assert.deepEqual(rots[0], { homeRotation: 310, awayRotation: 309 });
    assert.deepEqual(rots[1], { homeRotation: 1, awayRotation: 2 });
    assert.deepEqual(rots[2], { homeRotation: 399, awayRotation: 400 });
    assert.deepEqual(seen, ['Akron@Massachusetts', 'Clemson@Duke']);
  });
});

describe('calendar and WOW bubbles (DBD 2026-11-18)', () => {
  it('the date box is a form with Go, settles before navigating, and resets after Back', () => {
    for (const f of ['src/components/schedule/LeagueWeatherboard.astro', 'src/components/schedule/LeagueWeatherboardExtended.astro']) {
      const s = read(f);
      assert.match(s, /<form method="get" action=\{basePath\} id="wb-date-form"/);
      assert.match(s, />Go<\/button>/);
      assert.match(s, /setTimeout\(go, 700\)/);
      assert.match(s, /pageshow/);
    }
  });
  it('WOW bubble text has a white outline', () => {
    assert.match(read('src/styles/global.css'), /\.wes-chip > span \{\s*text-shadow: -1px -1px 0 #fff/);
  });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFeedPayload, mainLinesFromGame, holdPercent, fairAmerican, parseAmerican, parseHandicap,
  appendHistory, mergeMainIntoFull, marketSignature, HISTORY_POINTS_PER_MARKET,
  type FeedGame, type FeedMarket,
} from '../src/lib/odds-feed';
import { nameScore, matchFeedGame } from '../src/lib/odds-feed-match';

const KICK = Date.parse('2026-10-17T19:30:00Z');

function market(id: string, key: string, description: string, outcomes: [string, string, string | null, string?][], period: Partial<FeedMarket['period']> = {}): FeedMarket {
  return {
    id, key, description, status: 'O',
    period: { description: 'Game', abbreviation: 'G', live: false, main: true, ...period },
    outcomes: outcomes.map(([type, american, handicap, status], i) => ({
      id: `${id}-${i}`, description: type, type, status: status ?? 'O', price: { american, handicap },
    })),
  };
}

function game(over: Partial<FeedGame> = {}): FeedGame {
  return {
    id: '31989180', league: 'ncaa-football', description: 'Florida International @ Jacksonville State',
    startTime: KICK, live: false, scope: 'full',
    competitors: [{ name: 'Jacksonville State', home: true }, { name: 'Florida International', home: false }],
    groups: [{
      description: 'Game Lines',
      markets: [
        market('ml', '2W-12', 'Moneyline', [['A', '+175', null], ['H', '-230', null]]),
        market('sp', '2W-HCAP', 'Point Spread', [['A', '-110', '6.5'], ['H', '-110', '-6.5']]),
        market('tot', '2W-OU', 'Total', [['O', '-105', '52.5'], ['U', '-115', '52.5']]),
        market('ml1h', '2W-12', 'Moneyline', [['A', '+160', null], ['H', '-200', null]], { description: 'First Half', main: false }),
      ],
    }, {
      description: 'TD Scorer Props',
      markets: [market('td', 'GAME-PROP', 'Anytime Touchdown Scorer', [['X', '+300', null], ['X', '+450', null], ['X', '+900', null], ['X', '+1200', null]])],
    }],
    ...over,
  };
}

test('prices: EVEN is +100, split soccer handicaps average', () => {
  assert.equal(parseAmerican('EVEN'), 100);
  assert.equal(parseAmerican('+120'), 120);
  assert.equal(parseAmerican('-110'), -110);
  assert.equal(parseAmerican('abc'), null);
  assert.equal(parseHandicap('-0.5,-1.0'), -0.75);
  assert.equal(parseHandicap(null), null);
});

test('main lines come from the main-period game markets, not first half', () => {
  const l = mainLinesFromGame(game(), KICK - 3600_000)!;
  assert.equal(l.moneylineAway, 175);
  assert.equal(l.moneylineHome, -230);
  assert.deepEqual(l.spreadHome, { point: -6.5, price: -110 });
  assert.deepEqual(l.total, { point: 52.5, overPrice: -105, underPrice: -115 });
  assert.equal(l.live, false);
});

test('a started live game prefers its in-game markets', () => {
  const g = game({ live: true });
  g.groups[0].markets.push(market('liveml', '2W-12', 'Moneyline', [['A', '+400', null], ['H', '-600', null]], { description: 'Live Game', live: true }));
  const l = mainLinesFromGame(g, KICK + 3600_000)!;
  assert.equal(l.moneylineAway, 400);
  assert.equal(l.live, true);
});

test('soccer uses the 3-way moneyline when there is no 2-way one', () => {
  const g = game({ league: 'mls' });
  g.groups[0].markets = [market('x', '3W-1X2', '3-Way Moneyline', [['H', '+150', null], ['D', '+240', null], ['A', '+170', null]], { description: 'Regulation Time' })];
  const l = mainLinesFromGame(g, 0)!;
  assert.equal(l.moneylineHome, 150);
  assert.equal(l.moneylineAway, 170);
});

test('hold and no-vig fair odds for a two-way market; none for long prop lists', () => {
  const sp = game().groups[0].markets[1];
  assert.ok(Math.abs(holdPercent(sp)! - 4.76) < 0.01);
  assert.equal(fairAmerican(sp, sp.outcomes[0]), 100);
  assert.equal(holdPercent(game().groups[1].markets[0]), null);
});

test('a suspended outcome is left out of the hold', () => {
  const m = market('m', '2W-12', 'Moneyline', [['A', '+150', null], ['H', '-170', null, 'S']]);
  assert.equal(holdPercent(m), null);
});

test('payload validation drops bad games but keeps good ones', () => {
  const r = parseFeedPayload({ v: 1, source: 'scraper', sentAt: 1, games: [game(), { id: 'x', league: 'cricket' }], seen: [{ id: '1', league: 'nfl' }, { id: '2', league: 'nba' }] });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.payload.games.length, 1);
  assert.equal(r.value.dropped.length, 1);
  assert.deepEqual(r.value.payload.seen, [{ id: '1', league: 'nfl' }]);
  assert.equal(parseFeedPayload({ v: 2, games: [] }).ok, false);
  assert.equal(parseFeedPayload({ v: 1, games: new Array(401).fill(game()) }).ok, false);
});

test('history is capped per market', () => {
  let h: any[] = [];
  for (let i = 0; i < HISTORY_POINTS_PER_MARKET + 20; i++) h = appendHistory(h, [i, []]);
  assert.equal(h.length, HISTORY_POINTS_PER_MARKET);
  assert.equal(h[0][0], 20);
});

test('signature changes only when a price or line moves', () => {
  const a = game().groups[0].markets[1];
  const b = structuredClone(a);
  assert.equal(marketSignature(a), marketSignature(b));
  b.outcomes[0].price.handicap = '7';
  assert.notEqual(marketSignature(a), marketSignature(b));
});

test('a live update merges in and never removes the props', () => {
  const live = game({ scope: 'main', live: true, groups: [{ description: 'Game Lines', markets: [market('ml', '2W-12', 'Moneyline', [['A', '+300', null], ['H', '-400', null]])] }] });
  const merged = mergeMainIntoFull(game(), live);
  assert.equal(merged.groups.length, 2);
  assert.equal(merged.groups[1].markets.length, 1);
  assert.equal(merged.groups[0].markets.find((m) => m.id === 'ml')!.outcomes[0].price.american, '+300');
  assert.equal(merged.groups[0].markets.length, 4);
});

test('team names: school name matches our name-with-mascot, not a different school', () => {
  assert.equal(nameScore('ncaa-football', 'Alabama', 'Alabama Crimson Tide'), 2);
  assert.equal(nameScore('ncaa-football', 'Alabama', 'Alabama State Hornets'), 0);
  assert.equal(nameScore('ncaa-football', 'Mississippi State (#16)', 'Mississippi State Bulldogs'), 2);
  assert.equal(nameScore('ncaa-football', 'Middle Tennessee State', 'Middle Tennessee Blue Raiders'), 3);
  assert.equal(nameScore('ncaa-football', 'Miami Florida', 'Miami Hurricanes'), 3);
  assert.equal(nameScore('ncaa-football', 'Miami', 'Miami (OH) RedHawks'), 0);
  assert.equal(nameScore('mls', 'Orlando City', 'Orlando City SC'), 2);
  assert.equal(nameScore('nfl', 'Seattle Seahawks', 'Seattle Seahawks'), 3);
});

test('game match needs both teams and the nearest start wins a doubleheader', () => {
  const ours = { homeTeam: 'Chicago Cubs', awayTeam: 'Milwaukee Brewers', kickoffUTC: '2026-10-17T23:05:00Z' };
  const cands = [
    { id: 'g1', startTime: Date.parse('2026-10-17T18:05:00Z'), home: 'Chicago Cubs', away: 'Milwaukee Brewers' },
    { id: 'g2', startTime: Date.parse('2026-10-17T23:10:00Z'), home: 'Chicago Cubs', away: 'Milwaukee Brewers' },
    { id: 'x', startTime: Date.parse('2026-10-17T23:05:00Z'), home: 'Chicago Cubs', away: 'St. Louis Cardinals' },
  ];
  assert.equal(matchFeedGame('mlb', ours, cands)?.id, 'g2');
  assert.equal(matchFeedGame('mlb', { ...ours, kickoffUTC: '2026-10-20T23:05:00Z' }, cands), null);
});

test('neutral-site games may be listed the other way round', () => {
  const ours = { homeTeam: 'Georgia Bulldogs', awayTeam: 'Florida Gators', kickoffUTC: '2026-10-31T19:30:00Z', neutralSite: true };
  const m = matchFeedGame('ncaa-football', ours, [{ id: 'n', startTime: Date.parse('2026-10-31T19:30:00Z'), home: 'Florida', away: 'Georgia' }]);
  assert.equal(m?.swapped, true);
  assert.equal(matchFeedGame('ncaa-football', { ...ours, neutralSite: false }, [{ id: 'n', startTime: Date.parse('2026-10-31T19:30:00Z'), home: 'Florida', away: 'Georgia' }]), null);
});

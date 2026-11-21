// WOW-038: the public game page's sportsbook section and weather cards.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { publicGroups, priceClick, isLiveMarket, GRADING_NOTE } from '../src/lib/public-odds';
import GameOdds from '../src/components/odds/GameOdds';
import GameWagerGrid, { weatherCardClick } from '../src/components/public/GameWagerGrid';
import type { FeedGroup, FeedMarket } from '../src/lib/odds-feed';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const NOW = Date.UTC(2026, 10, 20, 18);

const mk = (id: string, description: string, period: string, status = 'O', outs: [string, string, string?][] = [['Iowa State', '-115'], ['Central Florida - a very long team label', '-105']]): FeedMarket => ({
  id, description, status, period: { description: period },
  outcomes: outs.map(([d, p, st], i) => ({ id: `${id}-${i}`, description: d, status: st ?? 'O', type: i ? 'H' : 'A', price: { american: p, handicap: null } as any })),
});
const GROUPS: FeedGroup[] = [
  { description: 'Game Lines', markets: [
    mk('ml', 'Moneyline', 'Game'),
    mk('ml1h', 'Moneyline', 'Live First Half', 'S'),
    mk('ml3q', 'Moneyline', 'Live 3rd Quarter', 'O'),          // open but in-game: hidden
    mk('tot', 'Total', 'Game', 'S'),                               // suspended market: hidden
    mk('spr', 'Point Spread', 'Game', 'O', [['Iowa State', '-110', 'S'], ['Central Florida', '-110']]), // one outcome suspended
  ] },
  { description: 'Live Props', markets: [mk('lp', 'Next Score', 'Live Game')] },
];

describe('what the game page shows', () => {
  const pub = publicGroups(GROUPS);
  const ids = pub.flatMap((g) => g.markets.map((m) => m.id));
  it('hides every "Live ..." market, including an open "Live 3rd Quarter"', () => {
    assert.deepEqual(ids.sort(), ['ml', 'spr']);
    assert.equal(isLiveMarket(mk('x', 'Moneyline', '  live 2nd quarter')), true);
    assert.equal(isLiveMarket(mk('x', 'Moneyline', 'Game')), false);
  });
  it('hides suspended markets and suspended outcomes; drops empty groups', () => {
    const spr = pub[0].markets.find((m) => m.id === 'spr')!;
    assert.deepEqual(spr.outcomes.map((o) => o.description), ['Central Florida']);
    assert.equal(pub.length, 1);
  });
  it('a game with nothing left shows the empty state', () => {
    const html = renderToString(React.createElement(GameOdds, { gameId: 'g', groups: [GROUPS[1]], awayName: 'A', homeName: 'H', startTime: NOW + 3600e3 }));
    assert.match(html, /Game lines appear here before kickoff\./);
  });
  it('rendered output has no hold, no no-vig text, no truncation, full labels, and price buttons', () => {
    const html = renderToString(React.createElement(GameOdds, { gameId: 'g', groups: GROUPS, awayName: 'A', homeName: 'H', startTime: Date.now() + 3600e3 }));
    assert.doesNotMatch(html, /Hold/);
    assert.doesNotMatch(html, /no-vig/i);
    assert.doesNotMatch(html, /truncate/);
    assert.doesNotMatch(html, /Live 3rd Quarter|Live First Half/);
    assert.match(html, /Central Florida - a very long team label/);
    assert.match(html, /<button[^>]*type="button"[^>]*>(?:(?!<\/button>).)*-115/s);
  });
  it('after kickoff the prices are disabled and the market says betting closed', () => {
    const html = renderToString(React.createElement(GameOdds, { gameId: 'g', groups: GROUPS, awayName: 'A', homeName: 'H', startTime: Date.now() - 60e3 }));
    assert.match(html, /Betting closed at kickoff/);
    assert.match(html, /<button[^>]*disabled=""/);
  });
});

describe('what a click on a price does', () => {
  it('signed out: the sign-up prompt', () => assert.equal(priceClick(false, NOW + 1, NOW), 'signup'));
  it('signed in: the grading note, never a bet slip', () => {
    assert.equal(priceClick(true, NOW + 1, NOW), 'grading-note');
    assert.match(GRADING_NOTE, /opens once results grading is live/);
  });
  it('after kickoff: nothing, signed in or out', () => {
    assert.equal(priceClick(false, NOW, NOW), 'closed');
    assert.equal(priceClick(true, NOW - 1, NOW), 'closed');
  });
  it('unknown sign-in state: nothing yet', () => assert.equal(priceClick(null, NOW + 1, NOW), 'wait'));
  it('the odds component never touches the bet slip or the bet API', () => {
    const src = read('src/components/odds/GameOdds.tsx');
    assert.doesNotMatch(src, /useBetting|BettingContext|addLeg|\/api\/bets/);
  });
});

describe('weather cards on the game page', () => {
  const view = (status: string) => ({
    id: `w_${status}`, ticketNumber: 'T1', title: `Card ${status}`, kind: 'odds', status, metric: 'high_temp',
    targetDate: '2026-11-20', lockTime: new Date(NOW).toISOString(), locationSummary: 'Somewhere', termsSummary: '',
    outcomes: [{ label: 'Over', displayedOdds: -110 }], displayedOddsLabel: '-110',
  }) as any;
  it('click routing: open + signed out = sign-up; open + signed in = its page; locked = nothing', () => {
    assert.equal(weatherCardClick('open', false), 'signup');
    assert.equal(weatherCardClick('open', true), 'open-page');
    assert.equal(weatherCardClick('locked', false), 'none');
    assert.equal(weatherCardClick('locked', true), 'none');
  });
  it('a locked card has no link and is labelled; an open card links to its page', () => {
    const html = renderToString(React.createElement(GameWagerGrid, { wagers: [view('locked'), view('open')] }));
    assert.match(html, /Locked at game time/);
    assert.doesNotMatch(html, /href="\/wagers\/w_locked"/);
    assert.match(html, /href="\/wagers\/w_open"/);
  });
});

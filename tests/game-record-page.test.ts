// WOW-032 S2: what the /games/... page shows (game-record-view.ts), its
// markup rules, and the no-name rule on every new public surface.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildGamePageView, visibleText, FROZEN_GAME_CACHE_CONTROL } from '../src/lib/game-record-view';
import { buildGameRecord, gameRecordPath } from '../src/lib/game-record';
import { renderUrlSet } from '../src/lib/seo/sitemap-shards';
import { KICK, MIN, game, feedLine, lines, ouWager, psWager, input, venue } from './helpers/game-record-fixtures';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const BRAND = /bovada|bodog/i;
const BANNED_PHRASES = /\bthe market\b|consensus|\bvegas\b/i;

const view = (o: Parameters<typeof input>[0] = {}) => buildGamePageView(buildGameRecord(input(o)));
const sportsEvent = (v: ReturnType<typeof buildGamePageView>) => v.jsonLd.find((x: any) => x['@type'] === 'SportsEvent') as any;

describe('game page JSON-LD (WOW-031 2)', () => {
  it('BreadcrumbList and SportsEvent only, with exactly the ruled properties', () => {
    const v = view();
    assert.deepEqual(v.jsonLd.map((x: any) => x['@type']), ['BreadcrumbList', 'SportsEvent']);
    assert.deepEqual(Object.keys(sportsEvent(v)).sort(), [
      '@context', '@type', 'awayTeam', 'description', 'eventAttendanceMode', 'eventStatus', 'homeTeam', 'location', 'name', 'sport', 'startDate', 'url',
    ].sort());
    const se = sportsEvent(v);
    assert.equal(se.name, 'Buffalo Bills at Kansas City Chiefs');
    assert.equal(se.startDate, '2026-11-16T13:00:00-05:00');
    assert.equal(se.eventStatus, 'https://schema.org/EventScheduled');
    assert.equal(se.eventAttendanceMode, 'https://schema.org/OfflineEventAttendanceMode');
    assert.equal(se.location['@type'], 'StadiumOrArena');
    assert.equal(se.location.address['@type'], 'PostalAddress');
    assert.equal(se.location.geo['@type'], 'GeoCoordinates');
    assert.equal(se.homeTeam['@type'], 'SportsTeam');
    assert.equal(se.url, 'https://wageronweather.com/games/nfl/2026-11-16/buffalo-at-kansas-city');
  });
  it('every SportsEvent value is visible on the page', () => {
    const v = view();
    const text = visibleText(v);
    const se = sportsEvent(v);
    for (const s of [se.name, se.description, se.location.name, se.location.address.addressLocality, se.location.address.addressRegion, String(se.location.geo.latitude), String(se.location.geo.longitude), se.homeTeam.name, se.awayTeam.name, se.sport]) {
      assert.ok(text.includes(s), s);
    }
    assert.ok(text.includes('Monday, November 16, 2026, 1:00 PM ET'));
    assert.ok(text.includes('Final (played as scheduled)'));
    assert.ok(text.includes('In-person event'));
  });
  it('postponed games say so in the markup and on the page', () => {
    const v = view({ game: game({ statusDetail: 'Postponed' }), wagers: [] });
    assert.equal(sportsEvent(v).eventStatus, 'https://schema.org/EventPostponed');
    assert.match(v.summary, /was postponed\.$/);
    assert.equal(v.gradesNote, 'Not graded: the game was postponed.');
  });
  it('no Offer, Product, Rating, Review, FAQPage, endDate or dateModified anywhere', () => {
    const blob = JSON.stringify(view().jsonLd) + read('src/pages/games/[league]/[date]/[matchup].astro') + read('src/lib/game-record-view.ts');
    assert.doesNotMatch(blob, /"Offer"|AggregateOffer|"Product"|AggregateRating|"Rating"|"Review"|FAQPage|endDate|dateModified/);
  });
});

describe('game page content', () => {
  it('answer-first summary with the score, place, date and stored weather', () => {
    assert.equal(view().summary, 'Kansas City Chiefs beat Buffalo Bills 27-20 at GEHA Field at Arrowhead Stadium on Monday, November 16, 2026. The WOW Score at kickoff was 72. Observed near kickoff: 44°F, wind 14 mph (NWS station KMKC).');
  });
  it('lines table carries the labels and capture times; grades name their source', () => {
    const v = view();
    assert.equal(v.lines!.rows[1][0], 'Sportsbook closing line, captured 12:42 PM ET, 18 min before kickoff');
    assert.match(v.lines!.rows[0][0], /^Sportsbook opening line \(captured Nov 10, 1:00 PM ET\)$/);
    assert.deepEqual(v.lines!.rows[1].slice(1), ['+150', '-175', '+3.5 (-110)', '-3.5 (-110)', '47.5 (Over -110 / Under -110)']);
    assert.ok(v.grades!.source.startsWith('Graded from the stored close (Sportsbook closing line, captured'));
    assert.deepEqual(v.grades!.rows.map((r) => r[1]), ['Kansas City Chiefs won', 'Kansas City Chiefs covered', 'Under']);
  });
  it('every table has units in its headings and a source line', () => {
    const v = view();
    for (const t of [v.score, v.lines, v.grades, v.weather, v.markets]) {
      assert.ok(t, 'table present');
      assert.ok(t!.source.length > 10);
    }
    assert.ok(v.lines!.head.some((h) => /American odds/.test(h)));
    assert.ok(v.weather!.rows.some((r) => r[1].endsWith('°F')));
    assert.ok(v.weather!.rows.some((r) => r[2].startsWith('Observed, NWS station KMKC')));
    assert.ok(v.weather!.rows.some((r) => r[2].startsWith('Wager on Weather forecast')));
  });
  it('a pending market reads "Result pending"', () => {
    const v = view({ wagers: [ouWager('w1', { status: 'locked' })] });
    assert.deepEqual(v.markets!.rows[0].slice(2), ['Result pending', 'Result pending']);
  });
  it('neutral site prints "(neutral site)"', () => {
    const jax = venue('nfl-jax');
    const v = view({
      league: 'ncaa-football', slug: 'georgia-at-florida', feedOpen: null, wagers: [],
      game: game({ homeTeam: 'Florida Gators', awayTeam: 'Georgia Bulldogs', venue: jax, homeTeamVenue: venue('ncaa-florida'), awayVenue: venue('ncaa-uga'), neutralSite: true, gameSiteName: jax.name }),
      feedClose: feedLine({ home: 'Georgia', away: 'Florida', league: 'ncaa-football' }),
    });
    assert.equal(v.neutralSite, true);
    assert.ok(visibleText(v).includes('(neutral site)'));
    assert.match(v.summary, /at EverBank Stadium \(neutral site\)/);
    assert.equal(v.path, '/games/college-football/2026-11-16/georgia-at-florida');
  });
  it('a pre-Oct 13 row and a row without capture time get their labels', () => {
    const old = buildGamePageView(buildGameRecord(input({
      game: game({ kickoffUTC: '2026-10-05T17:00:00Z' }), feedClose: null, feedOpen: null,
      boardClose: { lines: lines({ bookmaker: 'DraftKings' }), capturedAt: null, origin: 'backfill' },
    })));
    assert.equal(old.lines!.rows[0][0], 'Sportsbook line (different data source before Oct 13, 2026)');
    const noTime = buildGamePageView(buildGameRecord(input({ feedClose: null, feedOpen: null, boardClose: { lines: lines(), capturedAt: null, origin: 'backfill' } })));
    assert.equal(noTime.lines!.rows[0][0], 'Stored sportsbook line (capture time not recorded)');
  });
});

describe('indexing and caching', () => {
  it('indexable and cached for a day once frozen with a close and a result', () => {
    const v = view();
    assert.equal(v.indexable, true);
    assert.equal(v.cacheControl, FROZEN_GAME_CACHE_CONTROL);
    assert.match(v.cacheControl, /s-maxage=86400/);
  });
  it('noindex,follow when the close or the result is missing; short cache while unfrozen', () => {
    assert.equal(view({ feedClose: null }).indexable, false);
    assert.equal(view({ game: game({ statusDetail: 'Postponed' }) }).indexable, false);
    const open = view({ wagers: [ouWager('w1', { status: 'locked' })] });
    assert.doesNotMatch(open.cacheControl, /86400/);
    const page = read('src/pages/games/[league]/[date]/[matchup].astro');
    assert.match(page, /noIndexFollow=\{!view \|\| !view\.indexable\}/);
  });
});

describe('the sportsbook is never named on a public surface (WOW-032 B, DBD 2026-11-18)', () => {
  it('no Bovada or Bodog in any page string or JSON-LD, even when the stored data carries the name', () => {
    const shapes = [
      view(),
      view({ feedClose: null, boardClose: { lines: lines({ bookmaker: 'Bovada' }), capturedAt: new Date(KICK - 30 * MIN).toISOString(), origin: 'board-freeze' } }),
      view({ feedClose: feedLine({ home: 'Kansas City Chiefs', away: 'Buffalo Bills' }, { bookmaker: 'Bodog' }) }),
      view({ wagers: [ouWager('w1', { status: 'locked' }), psWager('w2')] }),
      view({ game: game({ statusDetail: 'Postponed' }) }),
    ];
    for (const v of shapes) {
      const all = visibleText(v) + JSON.stringify(v.jsonLd) + v.title + v.metaDescription;
      assert.doesNotMatch(all, BRAND);
      assert.doesNotMatch(all, BANNED_PHRASES);
    }
  });
  it('the stored record itself drops the name', () => {
    const rec = buildGameRecord(input({ feedClose: null, boardClose: { lines: lines({ bookmaker: 'Bovada' }), capturedAt: new Date(KICK - 30 * MIN).toISOString(), origin: 'board-freeze' } }));
    assert.doesNotMatch(JSON.stringify(rec), BRAND);
  });
  it('the sitemap output carries no name', () => {
    const xml = renderUrlSet([{ loc: `https://wageronweather.com${gameRecordPath('nfl', '2026-11-16', 'buffalo-at-kansas-city')}`, lastmod: '2026-11-17T14:00:00.000Z' }]);
    assert.doesNotMatch(xml, BRAND);
  });
  it('no string literal in the new public files names it', () => {
    for (const p of [
      'src/pages/games/[league]/[date]/[matchup].astro', 'src/lib/game-record-view.ts', 'src/lib/game-record.ts',
      'src/pages/sitemap-games.xml.ts', 'src/pages/weatherboard/[date].astro',
    ]) {
      read(p).split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line)) return;
        // The one permitted mention is the pattern that strips the name from stored data.
        if (/\/bovada\|bodog\/i/.test(line)) return;
        assert.doesNotMatch(line, />[^<{]*(bovada|bodog)|['"`][^'"`]*(bovada|bodog)[^'"`]*['"`]/i, `${p}:${i + 1}`);
      });
    }
  });
});

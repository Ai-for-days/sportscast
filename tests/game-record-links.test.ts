// WOW-032 S2: /weatherboard/<date> links each NFL / CFB game to its game page.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gamePageLinks } from '../src/lib/game-record';
import { KICK, game, venue } from './helpers/game-record-fixtures';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('gamePageLinks', () => {
  it('links only games whose record is held', () => {
    const a = game();
    const b = game({ id: '2', awayVenue: venue('nfl-nyj'), venue: venue('nfl-ne'), homeTeamVenue: venue('nfl-ne') });
    const links = gamePageLinks('nfl', [a, b], ['gamerec:nfl:2026-11-16:buffalo-at-kansas-city']);
    assert.deepEqual([...links], [['401772900', '/games/nfl/2026-11-16/buffalo-at-kansas-city']]);
  });
  it('a second game of the same matchup on the date gets -g2, in kickoff order', () => {
    const early = game({ id: 'e' });
    const late = game({ id: 'l', kickoffUTC: new Date(KICK + 5 * 3600_000).toISOString() });
    const links = gamePageLinks('nfl', [late, early], ['gamerec:nfl:2026-11-16:buffalo-at-kansas-city', 'gamerec:nfl:2026-11-16:buffalo-at-kansas-city-g2']);
    assert.equal(links.get('e'), '/games/nfl/2026-11-16/buffalo-at-kansas-city');
    assert.equal(links.get('l'), '/games/nfl/2026-11-16/buffalo-at-kansas-city-g2');
  });
  it('a neutral-site game uses the home team\'s own park for its slug', () => {
    const jax = venue('nfl-jax');
    const g = game({ neutralSite: true, venue: jax, homeTeamVenue: venue('ncaa-florida'), awayVenue: venue('ncaa-uga') });
    assert.equal(gamePageLinks('ncaa-football', [g], ['gamerec:ncaa-football:2026-11-16:georgia-at-florida']).get(g.id), '/games/college-football/2026-11-16/georgia-at-florida');
  });
});

describe('the date page wiring', () => {
  it('reads the record index for NFL and CFB only, and never for future dates', () => {
    const page = read('src/pages/weatherboard/[date].astro');
    assert.match(page, /if \(!tooFarOut && daysOut <= 0\)/);
    assert.match(page, /GAME_RECORD_LEAGUES\.includes/);
    assert.match(page, /gameRecordKeysInRange\(/);
    assert.match(page, /game pages<\/h2>/);
  });
});

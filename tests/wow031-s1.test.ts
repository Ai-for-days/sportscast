import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { closingWriteCandidates } from '../src/lib/game-closing-odds';
import { getOrganizationSchema, getWebSiteSchema, getSpecialAnnouncementSchema } from '../src/lib/schema-markup';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-21T00:30:00Z');
const lines = (extra: Record<string, unknown> = {}) => ({
  bookmaker: 'Bovada', lastUpdate: '2026-11-21T00:10:00Z', moneylineHome: -150, moneylineAway: 130,
  spreadHome: { point: -3.5, price: -110 }, spreadAway: { point: 3.5, price: -110 },
  total: { point: 44.5, overPrice: -110, underPrice: -110 }, homeRotation: 1, awayRotation: 2, ...extra,
}) as any;

describe('closing line is never an in-play price (WOW-031 S1e)', () => {
  it('skips lines flagged live even while ESPN still says pre', () => {
    const got = closingWriteCandidates([{ key: 'k', state: 'pre', lines: lines({ live: true, feedStartTime: NOW + 60_000 }) }], new Map(), NOW);
    assert.deepEqual(got, []);
  });
  it('skips feed lines once the feed start time has passed, even while ESPN still says pre', () => {
    const got = closingWriteCandidates([{ key: 'k', state: 'pre', lines: lines({ live: false, feedStartTime: NOW - 60_000 }) }], new Map(), NOW);
    assert.deepEqual(got, []);
  });
  it('still writes an ordinary pre-game line (regression)', () => {
    const before = closingWriteCandidates([{ key: 'k', state: 'pre', lines: lines({ live: false, feedStartTime: NOW + 600_000 }) }], new Map(), NOW);
    assert.equal(before.length, 1);
    const noFeedTime = closingWriteCandidates([{ key: 'k2', state: 'pre', lines: lines() }], new Map(), NOW);
    assert.equal(noFeedTime.length, 1);
  });
  it('still refuses started games and unchanged prices', () => {
    assert.deepEqual(closingWriteCandidates([{ key: 'k', state: 'in', lines: lines() }], new Map(), NOW), []);
    const known = new Map([['k', { lines: lines(), capturedAt: '2026-11-20T23:00:00Z' } as any]]);
    assert.deepEqual(closingWriteCandidates([{ key: 'k', state: 'pre', lines: lines() }], known, NOW), []);
  });
  it('the feed carries its start time onto the board lines', () => {
    assert.match(read('src/lib/odds-source.ts'), /feedStartTime: s\?\.startTime \?\? null/);
  });
});

describe('schema hygiene (WOW-031 S1a, S1d)', () => {
  it('WebSite has no SearchAction; Organization says game-day weather and has no empty sameAs', () => {
    assert.equal((getWebSiteSchema() as any).potentialAction, undefined);
    const org = getOrganizationSchema() as any;
    assert.equal(org.sameAs, undefined);
    assert.doesNotMatch(org.description, /41,000/);
    assert.match(org.description, /[Gg]ame-day weather/);
  });
  it('SpecialAnnouncement never invents datePosted', () => {
    const base = { event: 'Wind Advisory', headline: 'h', description: 'd', city: 'Akron', state: 'OH', url: '/x' };
    assert.equal('datePosted' in getSpecialAnnouncementSchema(base), false);
    assert.equal(getSpecialAnnouncementSchema({ ...base, onset: '2026-11-18T10:00:00-05:00' }).datePosted, '2026-11-18T10:00:00-05:00');
  });
});

describe('date pages and wager pages (WOW-031 S1b, S1c)', () => {
  it('a past date with no record is a 404; empty or far-out future dates are noindex,follow', () => {
    const s = read('src/pages/weatherboard/[date].astro');
    assert.match(s, /if \(noArchiveForDate\) Astro\.response\.status = 404;/);
    assert.match(s, /const dateNoIndexFollow = noArchiveForDate \|\| tooFarOut \|\| \(!isPast && !hasAnyGames\);/);
    assert.match(s, /noIndexFollow=\{dateNoIndexFollow\}/);
  });
  it('every single-market page is noindex,follow, open ones included', () => {
    assert.match(read('src/pages/wagers/[id].astro'), /noIndexFollow=\{!!view\}/);
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { espnScoreboardUrl, formatLivePeriodClock } from '../src/lib/espn-scoreboard';

// ESPN answered every scoreboard request from our Vercel egress with 403 on
// 2026-08-29, which took the period and clock (and, for most games, the score
// itself) off every NFL / college football / MLS row on the site. These pin the
// two things that fix depends on: the mirror host is tried, and a live game is
// labeled from ESPN's structured period/clock rather than its status text.

test('the canonical host and its mirror share one path shape', () => {
  const params = { dates: '20260829-20260906', limit: '1000' };
  assert.equal(
    espnScoreboardUrl('site.api.espn.com', 'football/college-football', params),
    'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=20260829-20260906&limit=1000',
  );
  // Verified against a live game on 2026-08-29: same path, same response shape.
  assert.equal(
    espnScoreboardUrl('site.web.api.espn.com', 'football/college-football', params),
    'https://site.web.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=20260829-20260906&limit=1000',
  );
});

test('a scoreboard url with no params carries no trailing question mark', () => {
  assert.equal(
    espnScoreboardUrl('site.api.espn.com', 'soccer/usa.1', {}),
    'https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/scoreboard',
  );
});

test('football counts quarters, then overtime', () => {
  assert.equal(formatLivePeriodClock('football', 3, '6:49'), 'Q3 6:49');
  assert.equal(formatLivePeriodClock('football', 1, '15:00'), 'Q1 15:00');
  assert.equal(formatLivePeriodClock('football', 5, '4:12'), 'OT 4:12');
  assert.equal(formatLivePeriodClock('football', 6, '2:00'), 'OT 2:00');
});

test('soccer counts halves, then extra time', () => {
  assert.equal(formatLivePeriodClock('soccer', 1, "32'"), "1st Half 32'");
  assert.equal(formatLivePeriodClock('soccer', 2, "90'+5'"), "2nd Half 90'+5'");
  assert.equal(formatLivePeriodClock('soccer', 3, "105'"), "ET 105'");
});

test('a period with no clock yet is still worth showing', () => {
  // ESPN reports 0:00 both at a period break and before the clock starts. The
  // period alone beats the bare "In Progress" this replaced.
  assert.equal(formatLivePeriodClock('football', 2, '0:00'), 'Q2');
  assert.equal(formatLivePeriodClock('football', 2, undefined), 'Q2');
});

test('no period means no badge, rather than a half-empty one', () => {
  assert.equal(formatLivePeriodClock('football', 0, '15:00'), null);
  assert.equal(formatLivePeriodClock('football', undefined, '15:00'), null);
  assert.equal(formatLivePeriodClock('soccer', 0, "1'"), null);
});

// DBD 2026-11-20 batch: 48-hour chart alignment, WOW chip outline, Sun & Moon
// accuracy plus first/last light, admin-added players, server-priced sportsbook bets.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getSunTimes } from '../src/lib/sun-times';
import { getMoonTimes, getMoonIllumination } from '../src/lib/weather-utils';
import { checkLeg, currentPrice, MAX_LINE_AGE_MS } from '../src/lib/sportsbook-bet-check';
import { makeTempPassword } from '../src/pages/api/admin/users/create';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const hm = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

// U.S. Naval Observatory, aa.usno.navy.mil/api/rstt/oneday, fetched 2026-11-20.
// [name, lat, lon, utc offset h, date, first light, sunrise, sunset, last light, moonrise, moonset, % lit]
const USNO: [string, number, number, number, string, string, string, string, string, string, string, number][] = [
  ['Chicago', 41.8864, -87.6186, -6, '2026-11-20', '06:16', '06:46', '16:26', '16:56', '13:53', '02:04', 81],
  ['Miami', 25.7791, -80.1978, -5, '2026-11-20', '06:18', '06:42', '17:30', '17:55', '14:33', '02:27', 81],
  ['Denver', 39.7525, -104.9995, -7, '2026-11-20', '06:21', '06:50', '16:41', '17:10', '14:05', '02:15', 81],
  ['Seattle', 47.6114, -122.3305, -8, '2026-11-20', '06:48', '07:22', '16:27', '17:02', '14:08', '02:32', 82],
  ['Houston', 29.7564, -95.3631, -6, '2026-11-20', '06:25', '06:50', '17:24', '17:49', '14:32', '02:32', 81],
  ['Anchorage', 61.2167, -149.8767, -9, '2026-11-20', '08:26', '09:19', '16:10', '17:04', '14:38', '03:41', 82],
  ['Chicago CDT', 41.8864, -87.6186, -5, '2026-06-21', '04:41', '05:15', '20:29', '21:04', '12:47', '00:25', -1],
];

describe('Sun & Moon match the USNO', () => {
  for (const [name, lat, lon, tz, date, first, rise, set, last, mrise, mset, lit] of USNO) {
    it(`${name} ${date}`, () => {
      const [y, m, d] = date.split('-').map(Number);
      const s = getSunTimes(y, m, d, lat, lon, tz * 3600);
      assert.equal(s.firstLight, hm(first), 'first light');
      assert.equal(s.sunrise, hm(rise), 'sunrise');
      assert.equal(s.sunset, hm(set), 'sunset');
      assert.equal(s.lastLight, hm(last), 'last light');
      const mt = getMoonTimes(y, m, d, lat, lon, tz * 3600);
      assert.ok(Math.abs(mt.rise - hm(mrise)) <= 1, `moonrise ${mt.rise} vs ${hm(mrise)}`);
      assert.ok(Math.abs(mt.set - hm(mset)) <= 1, `moonset ${mt.set} vs ${hm(mset)}`);
      if (lit >= 0) {
        const il = getMoonIllumination(Date.UTC(y, m - 1, d, 12) - tz * 3600000).illumination;
        assert.ok(Math.abs(Math.round(il) - lit) <= 1, `illumination ${il}`);
      }
    });
  }
  it('no first/last light in Anchorage at midsummer (twilight all night), as the USNO says', () => {
    const s = getSunTimes(2026, 6, 21, 61.2167, -149.8767, -8 * 3600);
    assert.equal(s.firstLight, -1);
    assert.equal(s.lastLight, -1);
    assert.equal(s.sunrise, hm('04:20'));
    assert.equal(s.sunset, hm('23:43'));
  });
  it('the card shows First light and Last light, uses ZIP-local "now", and labels next-day moon times', () => {
    const src = read('src/components/forecast/WeatherDetailCards.tsx');
    assert.match(src, />First light</);
    assert.match(src, />Last light</);
    assert.match(src, /Date\.now\(\) \/ 60000 \+ utcOffsetSeconds \/ 60/);
    assert.doesNotMatch(src, /now\.getHours\(\)/);
    assert.match(src, /\(next day\)/);
  });
});

describe('48-hour chart: cards line up with the graph', () => {
  const src = read('src/components/forecast/TemperatureChart.tsx');
  it('numeric X axis centred on equal columns, cards indented by the Y axis width', () => {
    assert.match(src, /domain=\{\[-0\.5, n - 0\.5\]\}/);
    assert.match(src, /type="number"/);
    assert.match(src, /paddingLeft: Y_AXIS_W/);
    assert.match(src, /gridTemplateColumns: `repeat\(\$\{n\}, minmax\(0, 1fr\)\)`/);
    assert.match(src, /width=\{Y_AXIS_W\}/);
    assert.match(src, /margin=\{\{ left: 0, right: 0/);
  });
  it('every label shows on mobile (no skipped ticks)', () => {
    assert.doesNotMatch(src, /interval=\{isMobile \? 1 : 0\}/);
  });
});

describe('WOW chips: thin black outline', () => {
  it('white text with a 1px black stroke painted under the fill', () => {
    const css = read('src/styles/global.css');
    assert.match(css, /\.wes-chip,\s*\.wes-chip > span \{\s*color: #fff;\s*-webkit-text-stroke: 1px #000;\s*paint-order: stroke fill;/);
  });
});

const lines = {
  bookmaker: 'Bovada', lastUpdate: '', live: false, feedGameId: 'g1', homeRotation: null, awayRotation: null,
  moneylineHome: -150, moneylineAway: 130,
  spreadHome: { point: -3.5, price: -110 }, spreadAway: { point: 3.5, price: -110 },
  total: { point: 44.5, overPrice: -105, underPrice: -115 },
} as any;
const NOW = Date.UTC(2026, 10, 20, 18);
const summary = (over: Record<string, unknown> = {}) => ({
  id: 'g1', league: 'nfl', startTime: NOW + 3600_000, description: 'Colts @ Texans', home: 'Texans', away: 'Colts',
  homeShort: null, awayShort: null, lines, liveLines: null, marketCount: 10, groups: [],
  fullAt: NOW - 60_000, seenAt: NOW - 60_000, liveAt: null, liveSeenAt: null, ...over,
}) as any;

describe('sportsbook bets are priced by the server', () => {
  it('accepts the exact current price and point', () => {
    const r = checkLeg({ gameId: 'g1', oddsType: 'spread', side: 'home', odds: -110, line: -3.5 }, summary(), NOW);
    assert.equal(r.ok, true);
  });
  it('rejects a doctored price and says the real one', () => {
    const r = checkLeg({ gameId: 'g1', oddsType: 'moneyline', side: 'away', odds: 5000 }, summary(), NOW);
    assert.equal(r.ok, false);
    if (!r.ok) { assert.equal(r.status, 409); assert.match(r.error, /\+130/); }
  });
  it('rejects a moved point on a total', () => {
    const r = checkLeg({ gameId: 'g1', oddsType: 'total', side: 'over', odds: -105, line: 41.5 }, summary(), NOW);
    assert.equal(r.ok, false);
  });
  it('rejects a game that has started (frozen "live" prices after the final, D1 2026-11-20)', () => {
    const r = checkLeg({ gameId: 'g1', oddsType: 'moneyline', side: 'home', odds: -150 }, summary({ startTime: NOW - 1 }), NOW);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /started/);
  });
  it('rejects stale lines and unknown games', () => {
    const stale = summary({ seenAt: NOW - MAX_LINE_AGE_MS - 1, fullAt: NOW - MAX_LINE_AGE_MS - 1 });
    assert.equal(checkLeg({ gameId: 'g1', oddsType: 'moneyline', side: 'home', odds: -150 }, stale, NOW).ok, false);
    assert.equal(checkLeg({ gameId: 'x', oddsType: 'moneyline', side: 'home', odds: -150 }, null, NOW).ok, false);
  });
  it('wrong side for a market is not offered', () => {
    assert.equal(currentPrice(lines, 'moneyline', 'over'), null);
    assert.equal(currentPrice(lines, 'total', 'home'), null);
  });
  it('place.ts checks every leg and blocks temporary-password and frozen accounts', () => {
    const src = read('src/pages/api/bets/place.ts');
    assert.match(src, /checkLeg\(leg, summary\)/);
    assert.match(src, /leg\.odds = check\.odds/);
    assert.match(src, /user\.mustChangePassword/);
    assert.match(src, /user\.frozen/);
    assert.match(read('src/pages/api/bets.ts'), /user\.mustChangePassword/);
  });
});

describe('admin-added players', () => {
  it('temporary passwords are 12 characters from an unambiguous alphabet', () => {
    for (let i = 0; i < 50; i++) {
      const p = makeTempPassword();
      assert.equal(p.length, 12);
      assert.match(p, /^[A-HJ-NP-Za-km-np-z2-9]+$/);
    }
  });
  it('create endpoint is admin-only, hashes the password, flags it, and defaults to $100,000', () => {
    const src = read('src/pages/api/admin/users/create.ts');
    assert.match(src, /requireAdmin\(request\)/);
    assert.match(src, /passwordHash: await hashPassword\(tempPassword\)/);
    assert.match(src, /mustChangePassword: true/);
    assert.match(src, /DEFAULT_START_DOLLARS = 100_000/);
  });
  it('setting a password clears the flag, and every sign-in form sends flagged players to /set-password', () => {
    assert.match(read('src/pages/api/auth/change-password.ts'), /mustChangePassword: false/);
    assert.match(read('src/pages/api/auth/login.ts'), /mustChangePassword: !!user\.mustChangePassword/);
    for (const f of ['src/components/auth/LoginForm.tsx', 'src/components/LoginModal.tsx', 'src/pages/auth/login.astro', 'src/components/player/PlayerDashboard.tsx']) {
      assert.match(read(f), /mustChangePassword\) \{ window\.location\.href = '\/set-password'/, f);
    }
  });
});

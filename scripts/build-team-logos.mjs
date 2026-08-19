#!/usr/bin/env node
/**
 * Match venue-data.ts team names against ESPN's team lists (which carry
 * real, verified logo CDN URLs) and emit venueId -> logoUrl JSON at
 * src/data/team-logos.json. Same pattern as convert-zip-data.js for
 * us-zip-codes.json: run by hand when venue-data.ts changes, review the
 * unmatched report, commit the result.
 *
 * NCAA and MLS/NWSL logos are keyed by ESPN's internal numeric team ID,
 * not a stable abbreviation like MLB/NFL — hand-guessing those IDs would
 * risk wrong or broken images, so this always resolves them from ESPN's
 * live team list rather than a hardcoded map.
 *
 * Run: node scripts/build-team-logos.mjs
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const VENUE_DATA_PATH = resolve(ROOT, 'src', 'lib', 'venue-data.ts');
const OUT_PATH = resolve(ROOT, 'src', 'data', 'team-logos.json');

const src = readFileSync(VENUE_DATA_PATH, 'utf8');

// Extract { id, team, league } triples via regex (consistent object-literal format).
const venueRe = /\{\s*id:\s*'([^']+)'[^}]*?team:\s*'([^']*)'[^}]*?league:\s*'([^']+)'/g;
const venues = [];
let m;
while ((m = venueRe.exec(src))) {
  const [, id, team, league] = m;
  if (team) venues.push({ id, team, league });
}
console.error(`Parsed ${venues.length} venues with a team name from venue-data.ts`);

const LEAGUE_ENDPOINTS = {
  mlb: ['https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams?limit=50'],
  nfl: ['https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams?limit=50'],
  'ncaa-football': ['https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams?limit=1000'],
  // venue-data.ts labels both MLS and NWSL venues as league:'mls' — search both ESPN leagues for that bucket.
  mls: [
    'https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/teams?limit=60',
    'https://site.api.espn.com/apis/site/v2/sports/soccer/usa.nwsl/teams?limit=30',
  ],
};

// Hand-verified aliases for real naming mismatches between venue-data.ts
// and ESPN's displayName (abbreviation expansions, brand-name reordering,
// shortenings) — confirmed by manually checking ESPN's team list, not guessed.
const ALIASES = {
  'usf bulls': 'south florida bulls',
  'ulm warhawks': 'ul monroe warhawks',
  'fiu panthers': 'florida international panthers',
  'umass minutemen': 'massachusetts minutemen',
  'appalachian state mountaineers': 'app state mountaineers',
  'los angeles fc': 'lafc',
  'new york red bulls': 'red bull new york',
  'nj ny gotham fc': 'gotham fc',
  'utah royals fc': 'utah royals',
};

function stripDiacritics(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function normalize(s) {
  const n = stripDiacritics(s)
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\bst\b/g, 'saint')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return ALIASES[n] || n;
}

async function fetchEspnTeams(url) {
  const res = await fetch(url);
  const data = await res.json();
  return data.sports[0].leagues[0].teams.map((t) => ({
    displayName: t.team.displayName,
    shortName: t.team.shortDisplayName,
    name: t.team.name,
    location: t.team.location,
    logo: t.team.logos?.[0]?.href || null,
  }));
}

const result = {};
const unmatched = [];

for (const [league, urls] of Object.entries(LEAGUE_ENDPOINTS)) {
  const espnTeams = (await Promise.all(urls.map(fetchEspnTeams))).flat();
  console.error(`${league}: fetched ${espnTeams.length} ESPN teams`);

  const byNorm = new Map();
  for (const t of espnTeams) {
    if (!t.logo) continue;
    byNorm.set(normalize(t.displayName), t.logo);
    byNorm.set(normalize(`${t.location} ${t.name}`), t.logo);
    byNorm.set(normalize(t.shortName), t.logo);
  }

  const leagueVenues = venues.filter((v) => v.league === league);
  for (const v of leagueVenues) {
    const n = normalize(v.team);
    let logo = byNorm.get(n);
    if (!logo) {
      // Fallback: substring match against displayName list.
      const hit = espnTeams.find(
        (t) => t.logo && (normalize(t.displayName).includes(n) || n.includes(normalize(t.displayName))),
      );
      logo = hit?.logo;
    }
    if (logo) {
      result[v.id] = logo;
    } else {
      unmatched.push({ id: v.id, team: v.team, league: v.league });
    }
  }
}

const sorted = Object.fromEntries(Object.keys(result).sort().map((k) => [k, result[k]]));
writeFileSync(OUT_PATH, JSON.stringify(sorted, null, 2) + '\n');
console.error(`\nWritten to ${OUT_PATH}`);
console.error(`Matched ${Object.keys(result).length} of ${venues.length} venues.`);
if (unmatched.length) {
  console.error(`Unmatched (${unmatched.length}) — add an ALIASES entry once you've confirmed the real ESPN name:`);
  console.error(JSON.stringify(unmatched, null, 2));
}

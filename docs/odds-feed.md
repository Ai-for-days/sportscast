# Pushed sportsbook odds feed

Built 2026-10-13 from Derek's brief "replace DraftKings odds with Bovada on wageronweather.com".
The Weatherboard's moneyline, spread and total come from Derek's own scraper instead of The Odds API,
and every market the book offers is stored and shown on a per-game page.

**Customer-facing copy never names the source**, and no page links to a sportsbook (Derek, 2026-10-13).

## Pieces

| Where | What |
|---|---|
| Cryptokie `Documents\Scrapers\bovada\bovada_scraper.py` | Every 15 min (scheduled task "Bovada Odds Scraper"): NFL, CFB, MLB, MLS, NWSL; list + per-game detail (all markets). Writes the CSVs as before, then pushes. |
| `...\bovada\push.py` | Push format + transport. Gzip JSON, `Authorization: Bearer <token>`; only games whose prices changed; unchanged ones go in a `seen` list (keeps them fresh, doubles as heartbeat). Failed pushes saved in `push_state\pending` and retried next run. |
| `...\bovada\live_pusher.py` | Runs continuously (scheduled task "Bovada Live Pusher" relaunches it every 15 min if it died). Every 20 s while games are in progress (2 min when none): live-only list, main lines of started games, ONE request with only the changed games. |
| `...\bovada\push_config.json` | `{url, token}`. Private, gitignored. |
| `src/pages/api/odds/ingest.ts` | Token check (constant time, fails closed), 4 MB body cap, gunzip with 40 MB cap, validation, store. |
| `src/lib/odds-feed.ts` | Pure: payload types + validation, main lines, hold / fair odds, line-history helpers, live merge. |
| `src/lib/odds-feed-store.ts` | Redis layout (below), ingest, reads. |
| `src/lib/odds-feed-match.ts` + `odds-team-aliases.ts` | Matching feed games to our games. **Edit the alias file** to fix an unmatched game. |
| `src/lib/odds-source.ts` | `ODDS_SOURCE` switch, staleness, rotation numbers from The Odds API. |
| `src/pages/weatherboard/game/[id].astro` + `components/odds/GameOdds.tsx` | Every market in tabs, search, hold, fair odds on hover, line charts. noindex. |
| `src/pages/admin/system/odds-feed.astro` | Status, unmatched games, refused pushes. |

## Payload (v1)

```
{ v: 1, source: "scraper" | "live", sentAt: <ms>,
  games: [ { id, league: "nfl"|"ncaa-football"|"mlb"|"mls", leagueName, sportPath, description, link,
             startTime: <ms UTC>, live, status, numMarkets,
             competitors: [{ id, name, shortName, home }],
             scope: "full" | "main",
             groups: [ { id, description, order,
                         markets: [ { id, key, description, descriptionKey, marketTypeId, status,
                                      period: { id, description, abbreviation, live, main },
                                      outcomes: [ { id, description, type, status, competitorId,
                                                    price: { handicap, american, decimal } } ] } ] } ] } ],
  seen: [ { id, league } ] }
```

Bovada's own structure and names. Nothing lists market names, so new market families appear on the game page
automatically. NWSL is sent as league `mls` because the site files NWSL venues under `mls`.

## Redis

| Key | Holds |
|---|---|
| `oddsfeed:game:<id>` | Full game (10 days) |
| `oddsfeed:live:<id>` | Latest in-game main lines (1 day) |
| `oddsfeed:sig:<id>` | Hash market id -> price signature |
| `oddsfeed:hist:<id>` | Hash market id -> line history, 150 points per market, a point only when the price or line moves |
| `oddsfeed:summary:<league>` | Hash game id -> teams, start, main lines, freshness. What the board reads. Pruned 36 h after start. |
| `oddsfeed:last-ingest` | Last push of any kind |
| `oddsfeed:rejected` | Last 100 refused games |

## Rules

- **Empty never overwrites.** A `full` game with zero markets is refused and the stored copy kept. The scraper also
  retries an empty detail response (plain address, then the v2 address) and logs a WARNING with the game name.
  Background: with `?lang=en` Bovada answered NFL detail requests with an empty list (found 2026-10-13).
- **Live updates merge, never remove.** A `main` push replaces markets by id and leaves the props alone.
- **Stale means no line.** A game not confirmed within 45 min shows no price; in-game lines need a confirmation within
  3 min, else the row falls back to the pre-game view. A started game shows the in-game line flagged **Live line**;
  after that the frozen pre-kickoff **Closing line** (game-closing-odds.ts), as before.
- **Rotation numbers** still come from The Odds API (the feed has none), so that cost is unchanged.
- **Before the first push ever arrives** the board stays on The Odds API, so deploying ahead of the token does not
  blank the board.
- **Health:** `odds-feed` in data-source-health.ts. No push for 45 min while the board renders = failure; 3 in a row
  raises a critical alert.

## Matching

Same league, start within 6 h, both teams match by name (exact or alias = 3; our name starts with theirs and the next
word is not a school qualifier like State/Tech/A&M = 2; the feed's "State"/"St" dropped = 1, only with the other team
at 2+). Nearest start wins, which separates MLB doubleheaders. Neutral-site games may match the other way round, with
home and away prices swapped.

## Switching back

`ODDS_SOURCE=oddsapi` in Vercel, then redeploy. Nothing was removed from `sportsbook-odds.ts`.

## Costs to watch

- Live pushes: at most one request per 20 s while games are on, and only when a line moved (a seen-only
  request at most once a minute otherwise). Each changed game costs a handful of Redis commands.
- The 15-min run sends only games that changed, one request per game (a big NFL game is ~240 KB raw, ~25 KB gzipped).

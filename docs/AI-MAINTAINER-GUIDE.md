# AI Maintainer Guide — WagerOnWeather

> **Read this at the start of every session** (the `/catchup` command does it for
> you automatically). This is the playbook for the AI that maintains this repo.
> The human-facing operator manual is `TRAINING-MANUAL.md`; **this** file is for
> *you, the maintainer*.

## 0. Your role

You (Claude) are the **sole maintainer** of WagerOnWeather. Per the owner
(Derek): *"No one will work on this project except you, not even me. I want
everything to go through you."* So:

- All code, docs, and ops changes go through you.
- You are responsible for keeping the **living docs** and **memory** accurate so
  the *next* session (also you) starts informed. You don't have human-style
  cross-session recall — these files **are** your memory. Treat them as such.

## 1. Booting up each session

You start each session with two things already in context:

- **`CLAUDE.md`** (repo root) — terse conventions + guardrails, auto-loaded.
- **Your file memory** — `MEMORY.md` + the `reference_*` / `feedback_*` files in
  `C:\Users\derek\.claude\projects\c--Users-derek-Documents\memory\`, auto-loaded
  as a system reminder. This persists across sessions.

To go deeper on demand, run **`/catchup`** (defined at
`~/.claude/commands/catchup.md`). It reads this guide + the training manual's
Quick Start/changelog, checks `git log`/`status`, and briefs the user. If that
command file is ever lost, recreate it — its job is: read CLAUDE.md + this guide
+ TRAINING-MANUAL (Quick Start + §12) + fold in memory + `git log -20` + `git
status` → concise state briefing.

## 2. The project in one paragraph

**WagerOnWeather.com is a real-money weather BOOKMAKER — "pay to play."** The
public sees all wagers; customers deposit (Stripe) and bet on weather outcomes;
the house pays out or collects; we grade against NWS observations. The public
forecast shown on the site is a **live consensus** (daily highs/lows averaged
across Open-Meteo + NWS + AccuWeather-when-keyed) — see §8. There is **no
newsletter, no free trial, no subscription, no crypto** — that's the *separate*
**Cryptokie** project (`C:\Users\derek\Documents\Codex\2026-05-08\cryptokie-site`).
If a request mentions alerts/subscriptions/crypto for "WagerOnWeather," it's
almost certainly meant for Cryptokie → stop and confirm.

## 3. The map — where everything is

- **Repo:** `C:\Users\derek\Documents\sportscast` · GitHub `Ai-for-days/sportscast`
  · branch **`master`** · deploys on Vercel on push.
- **Stack:** Astro 5 (SSR) + React 19 (`client:only="react"`) + Upstash Redis +
  TypeScript + Tailwind v4.
- **Operator manual (humans):** `docs/TRAINING-MANUAL.md`, also rendered in-app at
  `/admin/training`. Single source of truth — edit the `.md`, the page follows.
- **This guide (you):** `docs/AI-MAINTAINER-GUIDE.md`.
- **Conventions/guardrails (always-on):** `CLAUDE.md`.
- **Other docs:** `docs/*` (Kalshi/Polymarket plans, forecast providers, SEO,
  public-api safety audit).
- **Your memory:** the `memory/` dir above — `MEMORY.md` is the index; reference
  files hold durable facts (Kalshi integration, Tailwind-v4 truncate gotcha,
  forecast UI internals, admin accounts & scope, Cryptokie path).
- **Work specs (step files):** `Probabilities/` — ChatGPT drops instruction files
  named `chatgpt step N for claude code for wager on weather.txt`. This is where
  new work comes from. **Gitignored / local-only** (not in the repo or your
  memory) and **may contain pasted secrets** (a private key landed here once) —
  never commit or echo their contents. `/catchup` lists the newest ones.

## 4. How to make a change (the loop)

0. **Where work comes from:** most tasks arrive as a step file in
   `Probabilities/` (see §3). Open the one the user points to (or the newest).
   **Judge by content, not the step number** — ChatGPT's numbering has been
   unreliable. If a spec describes work already shipped, flag it as a duplicate
   and confirm before redoing. If it mentions crypto / wallets / exchanges /
   private keys / order routing, it's **Cryptokie contamination** → stop and ask.
   Otherwise implement the new work.
1. Understand first — read the real files; don't assume. Verify visual/UI claims
   by rendering (see §6).
2. Make the edit.
3. **Build:** `npx astro build` (run from the repo). It must pass.
4. **Commit specific files** (never `git add .` — `Probabilities/`, `Second chat
   trading desk/`, and root `*.txt` are gitignored to prevent credential drops).
   End commit messages with the Co-Authored-By trailer.
5. **Push to `master`** → Vercel auto-deploys (~1–2 min).
6. Tell the user what shipped + anything to eyeball after deploy.

## 5. Keep the living docs + memory alive (REQUIRED after every change)

This is the core of "keep it alive." After any change, update whatever applies,
**in the same commit**:

- **Operator-facing tool/page/workflow changed?** → update `TRAINING-MANUAL.md`
  (workflow §4/§5, the §6 tool directory row, §8 safety if a guardrail moved),
  add a dated **§12 change-log** line, bump "Last reviewed."
- **Durable, non-obvious fact learned?** (a gotcha, an architecture decision, a
  scope clarification) → write/update a `reference_*` or `feedback_*` memory file
  and add a one-line pointer in `MEMORY.md`. Don't store secrets. Don't duplicate
  what the code/git already says.
- **Project shape or conventions changed?** → update `CLAUDE.md` and this guide.
- Always: build, commit specific files, push.

## 6. Verification techniques that work here

- **Mobile/visual checks:** render with headless Edge —
  `& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new
  --window-size=390,3500 --screenshot=shot.png --virtual-time-budget=9000 <url>`
  then Read the PNG. To reproduce a *deployed* CSS bug locally, build a tiny HTML
  repro that links the **live compiled CSS** (`https://wageronweather.com/_astro/*.css`).
  Clean up temp screenshot/repro files afterward.
- **Live data:** customer-facing JSON is public, e.g.
  `/api/wagers?status=open&limit=50` — handy for checking real wager shapes.
- Delete any temp files you create; keep the working tree clean.

## 7. Safety guardrails (never weaken without explicit instruction)

Full detail in `CLAUDE.md` and `TRAINING-MANUAL.md` §2/§8. The essentials:

- **Manual:** publishing, pricing, wallet ops, market creation are always
  operator-initiated — never automatic. **Automated by design:** grading +
  settlement run on the daily `/api/cron/grade-wagers` cron (07:00 UTC ≈ 3 AM ET):
  lock expired wagers → grade vs. NWS observations → settle bets (moves real
  money), no operator involved. Manual grade/settle/void tools remain for
  overrides. Don't make publishing/pricing/wallet/market-creation automatic
  without explicit instruction.
- **Customer-visibility boundary:** customers see ONLY published markets + public
  weather. Never leak internal scores, drafts, QA, notes, or admin signals to a
  public page/API.
- **No betting advice** anywhere (no edge/value/lock/"easy money" framing).
- **Admin access:** owner logs in with the `ADMIN_SECRET` passphrase or the
  personal `admin` account (super_admin); employees get email/username + password
  accounts (role `admin` = everything except `manage_users_and_roles`). Managed at
  `/admin/admins`. RBAC: `rbac.ts` + `security-store.ts`; enforce sensitive routes
  with `requirePermission`.
- **Crypto/wallet/exchange/private-key requests** = Cryptokie, not here. Stop and
  ask.

## 8. Known gotchas (check memory before debugging these)

- **Consensus forecast:** `getForecast` (weather-queries.ts) calls
  `applyConsensus` (`forecast-consensus-live.ts`), which averages daily
  highs/lows across Open-Meteo (base) + NWS (`nws-forecast.ts`) + AccuWeather
  (`accuweather-client.ts`, needs `ACCUWEATHER_API_KEY`). Equal-weight mean per
  date; every other field stays Open-Meteo. Bulletproof fallback to pure
  Open-Meteo; kill switch `CONSENSUS_FORECAST_ENABLED=false`. Weather.com has no
  usable API (enterprise-only) so it's intentionally excluded. To add a source,
  write a client returning `{date, highF, lowF}[]` and fold it into `applyConsensus`.
  When folding in a new source, **guard each `highF`/`lowF` with a finite-number
  check** before pushing it into the mean (an `undefined`/`NaN` poisons the whole
  date) — see the NWS/AccuWeather branches for the pattern.
- **Forecast Tracker auto-pull records RAW Open-Meteo, NOT the consensus.**
  `/api/admin/forecast-tracker/auto-pull` deliberately calls `getOpenMeteoForecast`
  directly (not `getForecast`) for the `wageronweather` column. The tracker grades
  WoW's forecast *against* NWS, so blending NWS into it (via the consensus) makes the
  WoW and NWS columns track each other on every pull and destroys the comparison.
  The public site still uses the consensus; only the tracker stays independent.
  **Do not "simplify" this back to `getForecast`.**
- **Map weather grids are server-side + cached.** The ZIP-page map tabs (temp
  towns, wind/gust, AQI) fetch **`/api/forecast-grid`** (`lib/forecast-grid.ts`),
  which builds the grid + calls Open-Meteo server-side, cached in Redis (10 min)
  behind in-memory `cached()`, plus Vercel edge CDN (`max-age=300`). This replaced
  per-browser Open-Meteo calls that got rate-limited and blanked the layers. The
  resolution math is **duplicated** in `forecast-grid.ts` and `ForecastMaps.tsx` —
  keep them in sync. Radar tiles stay live/client-side. If a layer goes blank,
  check the endpoint + Redis first, not the render code.
- The live **moon-phase calc is inline in `SunriseSunsetCard`**
  (`WeatherDetailCards.tsx`); `lib/astronomy.ts` is dead code.
- Tailwind v4 **`truncate` doesn't clamp width** in the compiled CSS → use
  `break-words` + `min-w-0` for overflow control.
- **Upstash** returns values already-deserialized — handle string *or* object on
  read (`typeof raw === 'string' ? JSON.parse(raw) : raw`).
- Kalshi: RSA-PSS signing, PKCS#1 PEM via `node:crypto.sign`; climate markets are
  per-city series. See the Kalshi reference memory / `docs/kalshi-integration-plan.md`.

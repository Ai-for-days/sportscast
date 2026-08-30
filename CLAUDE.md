# CLAUDE.md — WagerOnWeather (sportscast)

Project conventions and guardrails for anyone (human or AI) working in this repo.

## 🚀 Session boot-up (you are the sole maintainer)
You (Claude) are the **only** one who works on this project — everything goes
through you. You don't have human cross-session recall, so your memory IS the
files: `MEMORY.md` + `reference_*`/`feedback_*` (auto-loaded each session) and
the docs below. To get fully up to speed, run **`/catchup`** (it reads the
maintainer guide + training manual + `git log`/`status` and briefs the user), or
read **`docs/AI-MAINTAINER-GUIDE.md`** — your playbook. After any change, **keep
the living docs + memory alive** (see that guide §5).

### ⛔ FIRST COMMAND, EVERY SESSION: `git fetch origin && git status -sb`
**Do this before reading code, diagnosing anything, or answering a question
about how the code behaves.** Despite the "sole maintainer" line above, this
working copy has repeatedly been found many commits behind `origin/master` —
on 2026-07-27 it was **19 commits behind** while a production bug was being
diagnosed against the stale tree. That is how you produce a confident, wrong
answer: the code you are reading is not the code that is running.

If you are behind, rebase (`git pull --rebase origin master`) **before** you
draw conclusions, and check whether the incoming commits touch the files you
are about to reason about. Local `git log` is NOT evidence of what is
deployed — for that, check the Vercel deployment's commit SHA.

## What this is
WagerOnWeather.com — a **weather forecasting site + weather-market platform**.
Public ZIP weather pages + customer wagers; a large admin/operator suite for
researching forecasts, designing/publishing markets, and resolving/settling
outcomes. Astro 5 (hybrid SSR) + React 19 + Upstash Redis + TypeScript, deployed
on Vercel (auto-deploys on push to **`master`**).

- Build: `npx astro build` (or `npm run build`)
- Test: `npm test` (tsx + `node --test`, suites in `tests/*.test.ts`). Added
  2026-07-27 — the project had no runner before that, so most code is still
  uncovered. Add tests alongside new logic rather than assuming they exist.
  Note `npx tsc --noEmit` reports a **pre-existing backlog** (72 errors as of
  2026-07-27); check the count moved the right way rather than expecting zero.
- Forecasts: a **live consensus** that averages daily highs/lows across
  Open-Meteo + NWS (+ AccuWeather when `ACCUWEATHER_API_KEY` is set), labeled
  "WagerOnWeather Consensus" (`forecast-consensus-live.ts`, applied in
  `getForecast`). Bulletproof: falls back to pure Open-Meteo on any failure.
  Kill switch: `CONSENSUS_FORECAST_ENABLED=false`. Settlement truth is still
  NWS observations (unaffected by the forecast blend).
- External markets (read-only intel): Kalshi, Polymarket.

## ⭐ Keep the training manual updated (REQUIRED)
`docs/TRAINING-MANUAL.md` is a **living** operator/admin manual, mirrored in-app
at `/admin/training`. **When you add, rename, remove, or change the behavior of
any operator-facing tool, admin page, or workflow, update the manual in the SAME
change:**
- the affected workflow (§4 lifecycle / §5 daily rhythm),
- the §6 tool-directory row (add / edit / delete),
- §8 Safety if a guardrail / approval gate / customer-visibility boundary moved,
- add a dated line to the §12 change log and bump "Last reviewed".

Skip the manual only for purely internal changes (refactors, build config,
cosmetic public-page styling that doesn't change a workflow).

## Safety model (do not weaken without explicit instruction)
- **Manual:** publishing, pricing, wallet ops, and market creation are always
  operator-initiated — never make them automatic. **Automated (by design):**
  locking runs on its own `/api/cron/lock-expired` cron (`:20`/`:50`, every 30
  min, added 2026-08-27). Status flip only: no grading, no settlement, no
  wallet, guarded by a test that fails if any of those are imported into it.
  Separately, grading + settlement run via the daily `/api/cron/grade-wagers` cron (07:00 UTC
  ≈ 3 AM ET) — it locks expired wagers, grades vs. NWS observations, and settles
  bets (moves real money) with no operator. Operators can still grade/settle/void
  manually (Wager Resolution Center) as overrides. Don't extend automation to
  publishing/pricing/wallet/market-creation without explicit instruction.
- **Customer-visibility boundary:** customers see ONLY published markets +
  public weather. Never expose internal scores, draft wagers, QA state, operator
  notes, risk warnings, or any admin signal to a public page or public API.
- **No betting advice:** no copy (public or admin) may say someone should bet or
  use edge/value/lock/"easy money" framing.
- **Dual control:** requester ≠ approver for security role changes + launch
  sign-off. Evidence/audit records are append-only.
- **Kill switch:** execution controls include a kill switch; live/real-money
  execution is manual + approval-gated.

## ⛔ Cross-project contamination guardrail
This repo is **weather-only**. A spec/tool/request involving **crypto, wallets,
exchanges, brokers, private keys, or order routing** is almost certainly
cross-project contamination (belongs to the separate "Cryptokie" project).
**Stop and ask before implementing** — do not proceed on numbering alone.

## ⛔ Every upstream with a fallback MUST register in `data-source-health.ts`
If you add or change a call to a third-party service that **degrades quietly**
— a fallback provider, a cached stand-in, a default value, an empty list — the
same change registers it in `src/lib/data-source-health.ts` and calls
`recordSourceSuccess` / `recordSourceFailure` on both paths.

**This is not paperwork.** On 2026-08-29 two upstreams were dark for hours and
the site looked completely normal. ESPN 403'd every scoreboard request, so live
scores, quarter and clock silently vanished behind The Odds API; it surfaced
only because Derek asked for a feature that already existed. Open-Meteo
rate-limited us, and its fallback **invents** a forecast, which the market
engines then priced real money against. Both were in the logs the entire time.
**Logs are not an alarm** — nobody reads them until something else has already
gone wrong, and a fallback that works is exactly what makes an outage
invisible. So the fallback itself has to be the thing that reports.

Rules that come with it:
- Alert text says **what it costs the customer**, not just which service is
  down. An alert nobody can act on gets ignored.
- A *degraded* path is its own row, not folded into the healthy one:
  `espn-primary-host` is tracked separately from `espn` precisely because the
  canonical host was blocked while the mirror served everything.
- Distinguish an outage from a **known permanent absence**. NWS answers 404 for
  the four venues outside its US coverage; counting those as failures would
  page an operator every time someone opened a Toronto page. See
  `isNwsOutageStatus`.
- **Never invent data to fill a gap.** Serve the last real value (see
  `getForecast`'s `lastgood` cache), or say it is unavailable. `synthetic: true`
  exists so that anything deciding money can refuse it.

## Key conventions
- Work specs arrive as step files in `Probabilities/` (`chatgpt step N for
  claude code for wager on weather.txt`) — gitignored/local-only, may contain
  pasted secrets (never commit/echo). Judge by content, not step number; crypto
  content = Cryptokie contamination → stop and ask. `/catchup` lists the newest.
- Branch is `master` (not `main`). Commit specific files; don't `git add .`
  (`Probabilities/`, `Second chat trading desk/`, and root `*.txt` are
  gitignored to prevent credential drops).
- Astro SSR pages need `export const prerender = false`.
- React islands use `client:only="react"` (not `client:load`).
- Upstash Redis values come back already-deserialized — handle both shapes:
  `typeof raw === 'string' ? JSON.parse(raw) : raw`.
- Admin page pattern: `requireAdmin(Astro.request)` → redirect to `/admin` if no
  session; wrap the React center component in `BaseLayout ... noIndex`.
- Admin auth: owner logs in with `ADMIN_SECRET` passphrase → operatorId
  `primary-admin` → `super_admin`. Employees have per-account email+password
  logins (`admin-account-store.ts`) created at `/admin/admins`, role `admin`
  (everything except `manage_users_and_roles`). RBAC lives in `rbac.ts` +
  `security-store.ts`; enforce sensitive routes with `requirePermission`.
- The live moon-phase calc is **inline in `SunriseSunsetCard`**
  (`src/components/forecast/WeatherDetailCards.tsx`); `src/lib/astronomy.ts`
  `getMoonInfo` is dead/unused — don't edit it for moon bugs.
- Kalshi durable facts (hosts, RSA/PKCS#1 signing, env vars) live in
  `docs/kalshi-integration-plan.md` and the integration libs; never print secret
  keys in any readiness check.

## Docs worth knowing
- `docs/TRAINING-MANUAL.md` — operator/admin manual (start here for "how do I…").
- `docs/public-api-safety-audit.md` — customer-visibility boundary details.
- `docs/*` — forecast providers, Kalshi/Polymarket plans, SEO strategy, etc.

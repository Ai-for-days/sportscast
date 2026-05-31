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

## What this is
WagerOnWeather.com — a **weather forecasting site + weather-market platform**.
Public ZIP weather pages + customer wagers; a large admin/operator suite for
researching forecasts, designing/publishing markets, and resolving/settling
outcomes. Astro 5 (hybrid SSR) + React 19 + Upstash Redis + TypeScript, deployed
on Vercel (auto-deploys on push to **`master`**).

- Build: `npx astro build`
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
- **Manual-only:** publishing, grading, settlement, pricing, wallet ops, and
  market creation are always operator-initiated. Never make them automatic.
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

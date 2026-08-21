# WagerOnWeather — Operator & Admin Training Manual

> **This is a LIVING document.** It must be updated whenever we add, change, or
> remove an operator-facing feature. See **[§0 How we keep this manual alive](#0-how-we-keep-this-manual-alive)**
> before you change anything in the app — and again right after.

**Audience:** WagerOnWeather employees who run the business — operators who set,
publish, monitor, resolve, and settle weather markets, plus admins responsible
for safety and governance. (Customers never see any of this; the public site is
covered briefly in [§9](#9-what-customers-see-the-public-site).)

**Read it in-app** at **`/admin/training`** (rendered from this same file), or
here in the repo. New employees: jump straight to the
[Quick Start](#quick-start--your-first-15-minutes).
**Last reviewed:** 2026-08-21 · **Maintainer:** Derek

---

## Table of contents

- [**Quick Start** — your first 15 minutes](#quick-start--your-first-15-minutes)
0. [How we keep this manual alive](#0-how-we-keep-this-manual-alive)
1. [What WagerOnWeather is](#1-what-wageronweather-is)
2. [The golden safety rules (read first)](#2-the-golden-safety-rules-read-first)
3. [Getting in & finding your way around](#3-getting-in--finding-your-way-around)
4. [The market lifecycle (the core job)](#4-the-market-lifecycle-the-core-job)
5. [Your daily rhythm](#5-your-daily-rhythm)
6. [Tool directory (reference)](#6-tool-directory-reference)
7. [External market intelligence (Kalshi & Polymarket)](#7-external-market-intelligence-kalshi--polymarket)
8. [Safety, governance & compliance](#8-safety-governance--compliance)
9. [What customers see (the public site)](#9-what-customers-see-the-public-site)
10. [Troubleshooting & FAQ](#10-troubleshooting--faq)
11. [Glossary](#11-glossary)
12. [Manual change log](#12-manual-change-log)

---

## 0. How we keep this manual alive

This manual only stays useful if it changes when the product changes. The rule:

> **If you add, rename, remove, or change the behavior of any operator-facing
> tool, page, or workflow, you update this manual in the SAME change (PR/commit).**

Concrete checklist when you ship an operator-facing change:

- [ ] Update the affected workflow section ([§4](#4-the-market-lifecycle-the-core-job) / [§5](#5-your-daily-rhythm)) if the steps changed.
- [ ] Update the [tool directory](#6-tool-directory-reference) entry (what it does / when to use / key rules). Add a new entry for a new tool; delete the entry for a removed tool.
- [ ] Update [§8 Safety](#8-safety-governance--compliance) if you touched a guardrail, approval gate, or customer-visibility boundary.
- [ ] Add a one-line dated entry to the [change log](#12-manual-change-log).
- [ ] Bump **Last reviewed** at the top.

For Claude Code sessions: there is a standing instruction in project memory to
update `docs/TRAINING-MANUAL.md` whenever operator-facing features change — but
human reviewers should still confirm it happened.

**Keep entries short and behavioral** ("what it does / when to use it / the
rules"), not click-by-click screenshots. Click-by-click rots fast; concepts and
rules age well.

---

## Quick Start — your first 15 minutes

New here? This is the whole job on one screen. The rest of the manual is the
detail; this gets you moving. (Section numbers like §4 refer to the parts below.)

**What you do:** research the weather forecast → design a market around it →
publish it for customers. After the weather happens, markets **grade and settle
themselves** overnight. Market creation, pricing, and publishing are **manual,
reviewed, and audited**; resolution is **automated**.

**Three rules you must never break** (full list in [§2](#2-the-golden-safety-rules-read-first)):
1. **You** create, price, and publish every market by hand — those never happen
   on their own. Resolution is the exception: after the target date, markets
   **grade and settle automatically** each morning (~3 AM ET) against NWS
   observations. You can also grade/settle/void manually at any time.
2. Customers see **only published markets + public weather** — never drafts,
   internal scores, QA state, or operator notes.
3. Anything about **crypto / wallets / exchanges / private keys** is **not this
   project** — stop and ask.

**Get oriented:** log in at **`/admin`**, then open **Command Center**
(`/admin/system/command-center`) and this manual (`/admin/training`) side by side.

**Publish your first market — the happy path** (details in [§4](#4-the-market-lifecycle-the-core-job)):
1. **Research** → `/admin/system/forecast-research` — enter a ZIP; read the
   suggested line + how volatile the forecast has been.
2. **Idea** → `/admin/system/weather-market-ideas` — generate candidates and
   **Save** a good one. (Saving creates no market.)
3. **Review** → same tool — mark it `reviewed`; read any risk flags.
4. **Draft** → same tool — promote the reviewed idea to a draft wager.
5. **Publish** → confirm the publish (it validates, then goes live). One at a time.
6. **QA** → work the checklist that's auto-created on publish; mark it `passed`.

**Check these every day** (details in [§5](#5-your-daily-rhythm)):
- **Daily Market Brief** (`/admin/system/weather-market-daily-brief`) — morning dashboard.
- **Daily Operator Runbook** (`/admin/system/daily-operator-runbook`) — the checklist.
- **Admin Inbox** (`/admin/system/admin-notification-inbox`) — critical findings.
- End of day: **End-of-Day Report** (`/admin/system/end-of-day-report`).

**After the weather happens:** **Wager Resolution** (grade vs. NWS) →
**Settlement Preview** → **Settlement**.

**Stuck?** Start at Command Center, then [§4 lifecycle](#4-the-market-lifecycle-the-core-job).
When unsure: **don't publish / settle / approve — ask.**

---

## 1. What WagerOnWeather is

WagerOnWeather.com is a **weather forecasting site + a weather-market platform**.

- **Public side:** free weather forecasts for any US ZIP code (current, hourly,
  15-day, wind, sun & moon, air quality, sport/fishing/hunting playability),
  plus the **markets** customers can wager on for a location (e.g. *"Columbia,
  SC daily high temperature — Over/Under 81°F"*).
- **Operator side (this manual):** a large admin suite for **researching the
  forecast, designing markets, publishing them, monitoring exposure, and
  resolving/settling outcomes** — all manually, all reviewed, all audited.

**Stack (so you understand the moving parts):** Astro + React front end, Upstash
Redis for storage, deployed on Vercel (auto-deploys when we push to `master`).
The forecast shown on the site is a **live consensus** — daily highs/lows are
averaged across **Open-Meteo + NWS** (and **AccuWeather** once its API key is
configured), labeled "WagerOnWeather Consensus." Settlement truth comes from
**NWS** (National Weather Service) **observations** (separate from the forecast).
We also *watch* external prediction markets — **Kalshi** and **Polymarket** —
for reference only.

**Who does what:**

- **ChatGPT** acts as the system architect / probability advisor and writes
  "step" instruction files.
- **Claude Code** implements those steps (writes the code, builds, deploys).
- **Operators (you)** use the admin tools to run the business day to day.

---

## 2. The golden safety rules (read first)

These are non-negotiable. The software is built to enforce most of them, but you
are the last line of defense.

1. **Market creation, pricing, publishing, and wallet ops are always manual.**
   You create, price, and publish every market by hand, and every deposit /
   withdrawal / credit is a deliberate operator action — the system never does
   these on its own. **Grading and settlement, however, are automated:** a daily
   cron (`/api/cron/grade-wagers`, 07:00 UTC ≈ 3:00 AM ET) locks expired markets,
   grades them against NWS observations, and **settles player bets — moving real
   money — without operator action**. It also re-checks the previous 3 days and
   voids anything still ungradeable after 48h. You retain manual grade / settle /
   void tools (Wager Resolution Center) to correct or pre-empt the cron; those
   manual actions are audited.
2. **Customers only ever see published markets and public weather.** They never
   see internal scores, draft markets, QA state, operator notes, risk warnings,
   "interestingness" rankings, or any admin signal.
3. **No betting advice — ever.** Operator tools may show forecast *context* and
   internal rankings, but no copy anywhere (public or admin) tells anyone they
   *should* bet, or frames anything as "edge / value / a lock / easy money."
4. **Dual control where it matters.** For sensitive approvals (security role
   changes, launch sign-off) the person who *requests* cannot be the person who
   *approves*.
5. **Kill switch exists.** Execution-level controls include a kill switch.
   Live/real-money execution is manual and approval-gated; assume it is OFF
   unless you personally confirmed otherwise.
6. **Evidence is append-only.** Audit and evidence records are never edited or
   deleted. Do the next corrective action; don't rewrite history.
7. **This is a WEATHER platform.** If you ever see a spec, tool, or request
   about **crypto / wallets / exchanges / brokers / private keys / order
   routing**, treat it as cross-project contamination (it belongs to a
   different project, "Cryptokie") and **stop and ask** before acting.

When in doubt, **don't publish / don't settle / don't approve** — ask.

---

## 3. Getting in & finding your way around

### Logging in
- Go to **`/admin`**. There are two ways to sign in:
  - **Owner (you):** the admin **passphrase** (the `ADMIN_SECRET`). This makes
    you a **super_admin** — full access *including* managing other admins.
  - **Employees:** their own **email + password** (an account the owner creates
    — see below). This gives the **admin** role: full dashboard access *except*
    adding/managing admins.
- Admin pages are `noindex` (search engines can't see them) and live behind the
  auth gate. If you're logged out you'll be bounced back to `/admin`.

### Adding employees as admins (owner only)
- Go to **Manage Admins** (`/admin/admins`) — it's the OWNER badge in SystemNav.
- Enter the employee's name, a login (an **email** or a plain **username**), a
  temporary password, and a **role**, then **Add admin**. Share the login +
  temporary password with them; they sign in at `/admin` and must create their
  own password before entering admin.
- **Role choice:** *Admin (employee)* = full access except managing admins;
  *Owner* = full access including adding admins. Give most employees *Admin*.
- Each employee gets the **admin** role = everything you can do **except** the
  Manage Admins page itself (that stays owner-only, enforced by the
  `manage_users_and_roles` permission).
- You can **Disable** an admin (revokes access immediately) or **Reset password**
  from the same page. A reset creates a temporary password and requires the admin
  to create their own password on next login. Disabled accounts also lose
  permission-gated access at once.
- Every account is its own identity, so actions are attributable per person in
  the audit log — better than sharing the passphrase.

### The three ways to navigate
1. **Admin Quick Links bar** — the colored strip at the top of every admin
   sub-page. One-click jumps to the highest-traffic tools: Wager Dashboard,
   Command Center, Daily Brief, Kalshi Markets, Market Ideas, **Forecast
   Research**, SEO Health, Kalshi Integration.
2. **Command Center** (`/admin/system/command-center`) — the **start-here map**.
   Top-level overview, the recommended workflow, the full tool directory, and
   "what to do next." If you're lost, go here.
3. **System / Quant Tools nav (`SystemNav`)** — the categorized card grid at the
   bottom of the major operator pages. Every system route is reachable in ≤2
   clicks from it. **This manual** is the first card under "Operator Tools."

You can always reopen this manual in-app at **`/admin/training`** (the 📘 Training
button in the Quick Links bar).

> New operators: spend your first session in **Command Center** and this manual
> side by side.

---

## 4. The market lifecycle (the core job)

This is the end-to-end path a weather market travels, and the tool you use at
each step. Most of an operator's day is steps 1–4 and 7–8.

```
 RESEARCH → IDEA → REVIEW → DRAFT → PUBLISH → MONITOR → LOCK → RESOLVE → SETTLE
```

### Step 1 — Research the forecast (set the line)
**Tool: Forecast Market Research — `/admin/system/forecast-research`** (operator-only).
Enter a US ZIP. You get the full forecast intelligence for setting a line:

- **Confidence / volatility** read on the forecast.
- **Suggested over/under lines** per day (high/low temp) with a confidence
  grade and plain-English rationale, plus a "push-proof" half-line option.
- **Model volatility** — how much the forecast high/low for each date has moved
  across our captured runs. Firm = tight line; unsettled = widen or wait.
- **Multi-day daily outlook** (15 days) and **next-24h hourly** detail.
- Full versions of the four read-outs we removed from the public page (Forecast
  Outlook, Changes, History, Market Context).

Supporting tools: **Forecast Divergence** (`/admin/system/forecast-divergence`)
for divergence/volatility/settlement-risk scoring across snapshots, and
**Forecast Provider Comparison** if you want to sanity-check providers.

### Step 2 — Generate / capture an idea
**Tool: Weather Market Ideas — `/admin/system/weather-market-ideas`.**
Admin-only idea generator for weather markets (including cross-location
temperature-spread markets). It's **idea-only** — generating an idea creates
**no** market. Use the discovery presets, tags, and city sets to surface
candidates, then **Save** the ones worth pursuing.

Each idea now arrives **priced**: a cover probability per side, the **push
probability**, no-vig fair odds, the offered odds carrying the hold, and the
**±°F uncertainty (sigma)** behind the line. The suggested line sits exactly on
the forecast difference, so it prices near -110 either way — the pricing earns
its keep when you **move the line off the suggestion**, where the odds now
adjust instead of staying -110/-110. Ideas warn when push probability exceeds
12%; a half-degree line removes pushes entirely. The sigma defaults are
published-verification estimates, **not measured from our own history** — they
should be recalibrated from the Forecast Tracker once the live-site row has
enough verified entries.

### Step 3 — Review saved ideas
In the **same tool**, the **saved-idea review queue** lets you mark each idea
`reviewed` / `rejected` and add operator notes. Duplicate ideas are detected for
you. Risk/correlation warnings are shown as advisory flags (they never block
you). High-severity warnings pop a soft confirmation — read it, then decide.

### Step 4 — Create a draft wager
Promote a reviewed idea to a **draft wager** (also from the ideas tool). A draft
is a frozen, ready-to-publish market definition held in an **isolated store** —
it is physically unreachable by the public API, grading, settlement, and
wallets. Drafts can't be created from a rejected idea or as a duplicate.

### Step 5 — Publish
Publishing is an **explicit, confirmed action**: it validates the wager, creates
the live market, marks the source draft `published`, and writes an audit event.
There is **no bulk publish and no auto publish** — one market at a time, on
purpose. After publish, the market is live and customers can wager on it.

> Wagers can also be created/managed directly in **Wager Management
> (`/admin/wagers`)** — the operational dashboard for all wagers.

### Step 6 — Post-publish QA
Publishing auto-creates a **QA checklist** entry (`pending`). Work the nine-item
checklist and set the result `passed` / `needs_changes` / `rejected`. **QA is
tracking only** — it does not publish, unpublish, edit, void, or settle the live
market. It's how we know a published market was double-checked.

### Step 7 — Monitor while the market is open
- **House Exposure (`/admin/system/house-exposure`)** — projected worst case,
  realized graded results, and where your risk is concentrated.
- **Market Integrity (`/admin/system/market-integrity`)** — surveillance for
  concentration / pricing / participant / operational anomalies (advisory).
- **User Risk Monitoring (`/admin/system/user-risk-monitoring`)** — advisory
  responsible-play and integrity signals per user.
- The market **locks** automatically at its configured lock time; operators can
  also lock/unlock wagering manually when needed.

### Step 8 — Resolve (grade) the outcome
**Tool: Wager Resolution — `/admin/system/wager-resolution`.** After lock, grade
the market against observed weather. It's **preview-then-grade** and
audit-logged. **Settlement truth is NWS observations** for the configured
grading station (operators can pick the station). Grading does **not** move
money — it records the result.

If you need to corroborate an observation, use **Weather Evidence
(`/admin/system/weather-evidence`)** — manual multi-source observations with a
consensus/spread verdict (advisory; it does not grade).

### Step 9 — Settle / account
- **Settlement Preview (`/admin/system/wager-settlement-preview`)** — read-only
  payout/liability projection for graded wagers (does **not** move money).
- **Settlement (`/admin/settlement`)** — settlement + accounting.

### When something is contested or needs changing
- **Wager Change Control (`/admin/system/wager-change-control`)** — approve and
  document a proposed change (odds / line / void / regrade / settlement review).
  **Approval only — implementation is still manual.**
- **Dispute Workflow (`/admin/system/dispute-workflow`)** — document,
  investigate, and recommend on disputed outcomes (advisory — no auto-regrade).

---

## 5. Your daily rhythm

A suggested operating loop. Adapt to the day, but these are the touchpoints.

**Start of day**
1. **Command Center** — glance at current status and "what to do next."
2. **Daily Market Brief (`/admin/system/weather-market-daily-brief`)** — the
   operator overview: today's highlights, risk alerts, the QA queue, stale
   drafts, forecast-divergence watch, Kalshi climate activity, and feedback
   signals. This is your morning dashboard.
3. **Daily Operator Runbook (`/admin/system/daily-operator-runbook`)** — the
   one-per-day operating checklist across creation / monitoring / resolution /
   governance / safety. Record-keeping that proves the day was run properly.
4. **Admin Inbox (`/admin/system/admin-notification-inbox`)** — internal
   advisory inbox aggregating critical findings across all admin tools.

**Through the day**
- Research → publish new markets as opportunities appear (the [§4](#4-the-market-lifecycle-the-core-job) lifecycle).
- Keep an eye on **House Exposure** and **Market Integrity**.
- Resolve markets as they lock and observations come in.

**End of day**
- **End-of-Day Report (`/admin/system/end-of-day-report`)** — date-scoped
  snapshot of market / resolution / settlement / integrity / governance activity.
- Clear or hand off anything still in the QA queue or the Admin Inbox.

> The **Operator Dashboard (`/admin/operator-dashboard`)** is the older
> single-screen daily workflow view and still works; the Daily Brief + Runbook
> above are the current, weather-market-focused versions.

---

## 6. Tool directory (reference)

Every admin page, grouped by what you'd use it for. Format: **Path** — what it
does / when to use it. Start with **Core**; the later groups are advanced,
analytics, and governance tooling you'll grow into.

### 6.1 Core daily operations
| Path | What it does |
|---|---|
| `/admin` | Login + Admin Dashboard (home). |
| `/admin/system/command-center` | Start-here system map, workflow, tool directory, status. |
| `/admin/system/weather-market-daily-brief` | Morning overview: highlights, risk alerts, QA queue, stale drafts, divergence, Kalshi activity. |
| `/admin/system/daily-operator-runbook` | One-per-day operating checklist (recordkeeping). |
| `/admin/system/admin-notification-inbox` | Aggregated critical findings across all admin tools (never sends external notifications). |
| `/admin/system/end-of-day-report` | Date-scoped end-of-day activity snapshot. |
| `/admin/operator-dashboard` | Legacy single-screen operator workflow. |

### 6.2 Building & running markets
| Path | What it does |
|---|---|
| `/admin/system/forecast-research` | **Set lines.** Enriched, operator-only forecast research: suggested lines, model volatility, multi-day + hourly detail, full outlook/changes/history/context. |
| `/admin/system/forecast-divergence` | Divergence / volatility / settlement-risk / opportunity scoring across forecast snapshots (heuristic, read-only). |
| `/admin/system/weather-market-ideas` | Generate ideas → review queue → draft wagers → publish → QA checklist (the whole pre-publish pipeline). Idea-only until you publish. |
| `/admin/wagers` | Wager Management — operational dashboard for all wagers. |
| `/admin/forecasts` | Forecast management. |
| `/admin/system/wager-resolution` | Grade locked wagers against NWS observations (preview-then-grade, audited; no balance change). |
| `/admin/system/wager-settlement-preview` | Read-only payout/liability projection for graded wagers. |
| `/admin/settlement` | Settlement + accounting. |
| `/admin/system/wager-change-control` | Approve + document proposed wager changes (approval only; manual implementation). |
| `/admin/system/dispute-workflow` | Document/investigate/recommend on disputed outcomes (advisory). |
| `/admin/system/weather-evidence` | Manual multi-source weather observations + consensus verdict (advisory; does not grade). |
| `/admin/system/market-integrity` | Surveillance: concentration / pricing / participant / operational signals (advisory). |
| `/admin/system/house-exposure` | Read-only exposure & PnL: worst case, realized results, concentration. |
| `/admin/system/user-risk-monitoring` | Advisory responsible-play / integrity signals per user (no bans/limits). |
| `/admin/system/pretend-user-testing` | Sandbox: walk the public/customer flow as a fake user. No real money or wallet writes. |

### 6.3 External market intelligence (read-only)
See [§7](#7-external-market-intelligence-kalshi--polymarket) for the why.
| Path | What it does |
|---|---|
| `/admin/system/kalshi-market-data` | Read-only Kalshi market snapshots (incl. climate markets). No trades placed. |
| `/admin/system/kalshi-integration` | Kalshi connectivity check + execution readiness (config status, never secrets). |
| `/admin/system/kalshi-market-comparison` | Advisory diff between our wagers and Kalshi snapshots (pricing gaps, hedge review). |
| `/admin/system/manual-hedge-review` | Documentation-only ledger for deciding whether to manually offset exposure. No order placement. |
| `/admin/system/polymarket-market-data` | Read-only Polymarket weather-market discovery. No wallet, no signing, no orders. |

### 6.4 Forecast quality & providers
| Path | What it does |
|---|---|
| `/admin/forecast-tracker` | Records forecasts per source and grades them against NWS observations. **Read the source labels carefully:** `WagerOnWeather (live site)` is the consensus the public site actually publishes; `WagerOnWeather (raw model)` is bare Open-Meteo, kept only as a diagnostic. Judge the product by the live-site row. **You no longer need to run pulls by hand** — a daily cron fills the live-site, raw-model and NWS columns for the 14 seeded cities (see below). Manual entry is still there for AccuWeather / Weather.com, which cannot be fetched automatically. |
| `/admin/system/forecast-provider-comparison` | A/B harness for forecast providers (Open-Meteo + opt-in WeatherNext). Read-only diagnostics. |
| `/admin/system/weathernext-probe` | Diagnostic for the WeatherNext Vertex AI endpoint. Disabled by default (needs two kill-switch env vars). |

### 6.5 Strategy, calibration & validation (advanced / analytics)
Mostly decision-support and research; not part of routine market publishing.
| Path | What it does |
|---|---|
| `/admin/system/calibration-lab` | Probability calibration, edge correlation, Brier scores. |
| `/admin/system/calibration-backtest` | Raw vs calibrated strategy comparison + recommendations. |
| `/admin/system/edge-validation` | Realized vs expected edge with Z-scores and confidence intervals. |
| `/admin/system/portfolio-allocation` | Fractional-Kelly sizing recommendations (recommendation only). |
| `/admin/system/allocation-stress-test` | Monte Carlo + stress scenarios + drawdown verdict. |
| `/admin/system/strategy-comparison` | Side-by-side strategy variants + promotion verdicts. |
| `/admin/system/strategy-registry` | Formal strategy lifecycle + manual promotion workflow. |
| `/admin/system/strategy-pilot` | Plan/monitor/review manual paper/demo/live pilots. |
| `/admin/system/pilot-review` · `/admin/system/pilot-decisions` | Go/no-go recommendations + decision journal. |
| `/admin/system/strategy-scorecard` · `/admin/system/strategy-brief` | Executive health view + daily desk briefing/alerts. |
| `/admin/system/desk-queue` · `/admin/system/desk-decisions` | Prioritized action queue + manual take/skip/watch journal. |
| `/admin/system/execution-playbook` · `/admin/system/playbook-audit` | Manual execution checklist + compliance/quality audit. |
| `/admin/system/quant-review` · `/admin/system/quant-edge-audit` | Forecast/pricing/signal diagnostics + friction-haircut edge audit. |
| `/admin/system/outcome-evaluation` | Win/loss, edge buckets, funnel — ex-post evidence. |
| `/admin/system/paper-strategy-portfolio` | Track which systematic signals would have been taken (paper only). |
| `/admin/system/strategy-mode` | Decision-support / operator-approved / systematic labeling control. |
| `/admin/system/operator-training` · `operator-certification` · `operator-rbac-review` | Practice scenarios, readiness/certification ledger, advisory RBAC review. |

### 6.6 System health, governance & safety
| Path | What it does |
|---|---|
| `/admin/system/health` · `operational-health` | Subsystem health, timings, stale data, backlogs, Redis health. |
| `/admin/system/odds-usage` | Odds API (DraftKings lines) metered credit usage: requests used/remaining, last request cost, and the site's cost model. |
| `/admin/system/wes-control` | Weather Experience Score (WES): live per-game monitoring (Raw WES, Final WES, severe-weather cap + reason, Environmental/Fan Feel/Player Feel) plus weight controls for all three tiers. |
| `/admin/system/data-integrity` | 11-domain freshness + structural validation. |
| `/admin/system/pipeline-cadence` | Are forecast/pricing/settlement stages on schedule? |
| `/admin/system/cleanup-backlog` | House-keeping checklist. |
| `/admin/security` | Roles + approvals (dual-control). |
| `/admin/compliance` | Retention policies + evidence trail. |
| `/admin/change-control` | Change management + releases. |
| `/admin/resilience` | Resilience / failure-simulation drills. |
| `/admin/system/incident-management` | Record/triage/investigate/resolve incidents (workflow only). |
| `/admin/system/audit-investigation` | Read-only timeline reconstruction across wagers/disputes/incidents/governance. |
| `/admin/system/validation-center` · `end-to-end-validation` | Platform-wide validation checks + workflow/governance signoffs. |
| `/admin/system/pre-launch-audit` · `/admin/launch-readiness` | Launch readiness summaries + sign-off (governance, informational). |
| `/admin/system/security-audit` · `authorization-audit` · `ux-audit` | Targeted audits. |
| `/admin/performance` | Performance metrics + cache. |
| `/admin/system/seo-health` | Read-only SEO architecture snapshot (sitemaps, hubs, ZIP tiers, canonical host). |
| `/admin/training` | **This manual**, rendered in-app from `docs/TRAINING-MANUAL.md`. |
| `/admin/admins` | **Owner only.** Add/disable employees as admins (own email + password login); reset passwords. Employees get full access except this page. |

### 6.7 Legacy / sportsbook-era trading desk
These date from the platform's earlier sports-betting/Kalshi-trading-desk phase.
They still load, but they are **not** part of routine weather-market operations.
Don't use the execution ones unless you know exactly why.
`/admin/trading-desk/*`, `/admin/kalshi-lab`, `/admin/signals`,
`/admin/portfolio`, `/admin/backtesting`, `/admin/trade-journal`,
`/admin/execution-control`, `/admin/execution-candidates`,
`/admin/demo-execution`, `/admin/live-readiness`, `/admin/live-execution`,
`/admin/reconciliation`, `/admin/market-making`, `/admin/model-governance`,
`/admin/model-attribution`, `/admin/research-sandbox`, `/admin/reports`,
`/admin/venues`, `/admin/notifications`, `/admin/alerts`, `/admin/pricing-lab`,
`/admin/market-performance`, `/admin/history`, `/admin/operations-center`.

---

## 7. External market intelligence (Kalshi & Polymarket)

We **watch** Kalshi and Polymarket weather markets for reference — pricing
context, comparison, and hedge thinking. We **do not** auto-mirror them and we
**do not** place trades from these tools.

- **Kalshi** is the live external prediction market we track most. Climate
  markets there live in **per-city series** (e.g. `KXHIGHDEN`, `KXLOWMIA`) —
  there is no single "all weather" feed. Use **Kalshi Market Data** to pull
  read-only snapshots (the green "Fetch climate markets" button is the
  one-click path); the **Daily Brief** surfaces the latest climate activity.
- **Kalshi Integration** verifies connectivity and shows config status only —
  **it never displays secret keys.** If it shows failures, that's a credentials
  or connectivity issue for an admin, not something to work around.
- **Kalshi Comparison** and **Manual Hedge Review** are advisory: they help you
  *decide* whether to manually offset exposure on an external venue. Any actual
  hedge is placed by a human, off-platform, and documented in the ledger.
- **Polymarket Market Data** is read-only discovery only — **no wallet, no
  signing, no orders**, ever.

> Reminder ([§2](#2-the-golden-safety-rules-read-first), rule 7): anything asking
> for wallets, private keys, or order routing is a red flag. Surface it; don't
> act on it.

---

## 8. Safety, governance & compliance

The platform encodes the safety model so that the safe path is the default path.
Know these so you recognize when something is off.

**Customer-visibility boundary** — customers **never** see: internal
interestingness/ranking scores, duplicate/correlation risk warnings, QA state,
operator notes, tuning notes, unpublished ideas, draft wagers, or any admin-only
signal. They see **only published markets + public weather**. If you ever find
admin data leaking to a public page or the public API, treat it as an incident.

**What's manual vs. automatic** — market creation, publishing, pricing changes,
and wallet operations are **manual**, deliberate operator actions with an audit
trail. **Grading and settlement are automatic:** the daily grading cron
(`/api/cron/grade-wagers`, ~3 AM ET) locks expired markets, grades them against
NWS observations, and settles player bets (moving money) on its own. Operators
keep manual grade / settle / void tools for corrections and early resolution.

**Dual control** — for security role changes and launch sign-off, the requester
cannot self-approve. Get a second person.

**Kill switch & execution** — execution-level controls include a kill switch;
real-money/live execution is manual and approval-gated. Treat live execution as
off unless an admin confirms otherwise in writing.

**Advisory ≠ enforcement** — Market Integrity, User Risk, Disputes, Hedge
Review, and most "audit" tools **recommend**; they do not auto-act. You read the
recommendation and decide.

**Append-only evidence** — audit and evidence records can't be edited or
deleted. Correct forward.

**Governance tooling** — Change Control (releases), Compliance (retention +
evidence), Incident Management, Resilience drills, and the Validation/Audit
centers exist to prove the business is run properly. Launch-readiness / sign-off
pages are **informational governance** — they do not themselves switch trading
on or off.

**Project-scope guardrail** — WagerOnWeather is weather-only. Crypto / wallet /
exchange / broker / private-key / order-routing requests are out of scope and
likely cross-project contamination — stop and ask.

---

## 9. What customers see (the public site)

You should know the customer's view so you can support it. Customers do **not**
log into admin; they use the public site.

- **ZIP weather pages** (e.g. `/29201-columbia-south-carolina-weather`): current
  conditions, hourly, 15-day, a wind card, sun & moon, air quality, and
  sport/fishing/hunting playability. The header has a **city search** (on mobile
  it sits right in the header bar).
- **"Bet on {City} Weather"** section: the open, published markets for that
  location. A signed-out visitor sees the markets and a "Sign up to place bets"
  prompt; a signed-in customer can pick an outcome and place a wager via the bet
  slip.
- Customers see **only** published markets and public weather — never any of the
  internal research/QA/ranking described in this manual.

If a customer asks why a market resolved a certain way: outcomes are graded
against **NWS observations** for the market's stated grading station, per each
market's documented resolution rules.

---

## 10. Troubleshooting & FAQ

**"The Forecast Research / Daily Brief shows no volatility or no history."**
The run-to-run history builds up from captured forecast snapshots over time
(populated partly by real public traffic). A brand-new location or a fresh
deploy will be sparse — the live outlook and suggested lines still work; the
history columns fill in over days.

**"Kalshi Integration shows failures / warnings."** Warnings about cached data
are usually expected. Hard failures are typically a credentials/connectivity
problem — escalate to an admin to check the Kalshi env vars. Never paste private
keys into chats, tickets, or files.

**"A market I published looks wrong."** Don't quietly fix the live market. Use
**Wager Change Control** to propose + document the change (and **Dispute
Workflow** if a customer outcome is contested). Implementation stays manual.

**"Can I bulk-publish a batch of markets?"** No. Publishing is intentionally one
at a time, each confirmed and audited.

**"Something mentions crypto/wallets/trading exchanges."** Stop. That's not this
project. Ask before doing anything ([§2](#2-the-golden-safety-rules-read-first),
rule 7).

**"Where do I even start?"** [Command Center](#3-getting-in--finding-your-way-around)
→ this manual's [§4 lifecycle](#4-the-market-lifecycle-the-core-job).

---

## 11. Glossary

- **Wager / Market** — a published weather proposition customers can bet on
  (e.g. an Over/Under on a daily high temp).
- **Line** — the number a market is set around (e.g. high temp O/U **81**).
- **Over/Under (O/U)** — bet on whether the observed value lands above or below
  the line. A **push-proof** half-line (e.g. 81.5) avoids exact-tie pushes.
- **Idea → Draft → Published** — the pre-market pipeline: a candidate, then a
  frozen ready-to-publish definition, then a live market.
- **QA checklist** — the post-publish double-check; tracking only.
- **Lock** — the time after which no new wagers are accepted on a market.
- **Grade / Resolve** — determine the outcome from observed weather.
- **Settle** — account for payouts/liability after grading.
- **NWS** — National Weather Service; our **settlement source of truth**.
- **Open-Meteo** — our live **forecast** provider (different from the settlement
  source).
- **Snapshot / Revision** — a captured copy of a location's forecast at a moment
  in time; comparing snapshots gives us "what changed" and model volatility.
- **Volatility / Divergence** — how much / how inconsistently the forecast has
  been moving; high volatility = less confident line.
- **Kalshi / Polymarket** — external prediction markets we watch read-only.
- **Dual control** — requester ≠ approver for sensitive actions.
- **Advisory** — a tool that recommends but does not act automatically.

---

## 12. Manual change log

Newest first. Add a dated line whenever you change the manual (see [§0](#0-how-we-keep-this-manual-alive)).

- **2026-08-21** — **Fixed ZIP-page precipitation chart showing an empty
  graph on days with real rain.** `PrecipChart.tsx` sampled ONE hourly
  reading every 12 hours (5 points across the next 48h) and plotted that
  single instant's rain rate as the bar — fine for temperature/wind, which
  change gradually, but precipitation is bursty: a shower that fell between
  two 12-hour-apart samples was invisible, and even real hourly rain rates
  are usually small enough that a single hour's amount barely registers
  against the chart's scale. Reported live: Columbia, SC 29205 showed
  "1.26\" Inches Today" with a completely flat, empty chart during an
  actual ongoing storm. Fixed by summing each 12-hour bucket's hourly
  precip into one bar (peak, not average, probability per bucket) instead
  of sampling a single instant — verified locally against the live storm
  that prompted this report: the chart now shows a real ~1.26" bar in the
  current window, matching the summary number and the radar overlay.
  **Operator impact:** none — public-page chart-accuracy fix only.

- **2026-08-21** — **Venue-page Next Home Game (non-MLB) now shows weather
  AT kickoff, not the day's high/low.** The NFL/NCAA/MLS "Next Home Game"
  card was showing `forecast.daily`'s high/low temp, description, wind, and
  rain% for the game's calendar date — the same numbers regardless of
  whether kickoff was 1pm or 8pm that day. It now samples the hourly
  forecast at the single kickoff instant instead (`getGameWindowForecast`
  with `hoursAfter=0`, new `nextGameSlot` in `[venue].astro`, replacing
  `gameDay`), so the card shows one temperature — the one that actually
  applies at game time — labeled "Forecast at kickoff." MLB's own Next
  Game/Next Home Game cards were unaffected by this bug (they already used
  the Weatherboard's kickoff-anchored narrative/WES via the embedded
  `<WeatherboardTable>`, or the separate on-field cards' per-inning
  sampling) — this fix only touched the non-MLB `gameDay` path. The
  standalone 7-day forecast grid elsewhere on venue pages is unchanged
  (that's a genuine daily outlook, not a specific-game forecast).
  **Operator impact:** none — public-page data-accuracy fix only.

- **2026-08-21** — **Houston, Texas, Arizona treated as roof-closed for the
  rest of the MLB season.** Manual override, not a live-data change: Daikin
  Park (Astros, `mlb-hou`), Globe Life Field (Rangers, `mlb-tex`), and Chase
  Field (Diamondbacks, `mlb-ari`) are now assumed closed-roof for every
  remaining game this season (summer heat), not just today's game — see
  `SEASON_CLOSED_ROOF_VENUES` in `league-schedule.ts`. Previously the
  Weatherboard/venue pages only knew a retractable park's roof status for
  TODAY's game (a live MLB Stats API check, `getRoofStatus`), so any future
  game for these three teams still showed a full weather forecast/WES as if
  the roof might be open. Weatherboard and venue pages for these three
  teams now consistently show "Roof closed — weather is not a factor for
  this game" and no WES number, for every upcoming game, until this is
  revisited (next season, or sooner if one of these teams plays with the
  roof open again — remove the venue ID from the override set at that
  point). **Operator impact:** none — a data-accuracy fix to existing
  behavior, not a new workflow.

- **2026-08-21** — **WES severe-weather cap added (still WES 1.0).** WES now
  computes two numbers internally: `wesRaw` (the plain 20% Environmental +
  35% Fan Feel + 45% Player Feel blend, exactly as WES has always
  calculated it) and `wesFinal` (`min(wesRaw, severeWeatherCap)` when a cap
  applies, otherwise equal to `wesRaw`). The problem this solves: an
  otherwise-favorable temperature/wind/humidity could partially average
  away a genuine severe-weather threat, so a severe thunderstorm could
  still show as merely "mediocre" (e.g. WES 53) instead of clearly flagging
  danger. The cap is a hard ceiling derived deterministically from NWS
  alerts overlapping the event window (same classification WES's
  `severeWeatherScore` sub-score already used, just mapped to a different
  scale): no meaningful risk → no cap; minor advisory → max 85; significant
  advisory → max 70; thunderstorm/lightning nearby → max 50; severe
  thunderstorm warning → max 30; tornado warning/dangerous lightning → max
  10. It is a ceiling, never a floor — an already-low `wesRaw` under the
  cap passes through untouched. Environmental, Fan Feel, and Player Feel
  are **never** capped and use their original, unchanged formulas — only
  the single overall number is. The Weatherboard's public WES number now
  shows `wesFinal` (was already the only number shown, just was `wesRaw`
  before); when a cap is active the badge outlines in red and the hover
  tooltip adds "Severe Weather Cap Applied: N" plus the triggering NWS
  alert's own event text (e.g. "Severe Thunderstorm Warning") — silent
  when no cap applies. `/admin/system/wes-control`'s monitoring table
  gained Raw WES / Final WES / Severe Weather Cap / Cap Reason columns
  (weight controls are unchanged). Cap thresholds are fixed code for 1.0,
  same as the breakpoint curves — not admin-editable; only the weights
  are. This is still WES 1.0, not a version bump — the cap is being
  treated as part of the 1.0 definition per the spec's own framing.
  **Operator impact:** the public WES number can now drop sharply and
  visibly (badge turns red) the moment a qualifying NWS alert overlaps a
  game's event window, even if the raw temperature/wind/humidity blend
  alone would look fine — that's the intended signal, not a bug.

- **2026-08-21** — **WES (Weather Experience Score) launched.** New
  proprietary 4-number score per outdoor game — Environmental, Fan Feel,
  Player Feel, and overall WES (0.20E + 0.35F + 0.45P) — replacing the old
  compact first-pitch icon/wind-arrow widget and weather-delay warning under
  the Weatherboard's Time/ET column with a single WES number (hover for the
  full breakdown). Built from ~26 sub-scores across 3 categories, each a
  piecewise-linear lookup against feels-like temp, dew point, wind, gust,
  cloud cover/sun angle, visibility, precipitation rate, and NWS alerts
  sampled across the actual event window (not daily highs/lows) — see
  `src/lib/wes.ts` for the full engine and its source spec. New
  `/admin/system/wes-control` (§6.6): live monitoring table of every
  upcoming outdoor game's WES numbers, plus a weights-control form covering
  all three tiers (top-level Environmental/Fan/Player split, the 8
  Environmental sub-weights, and the 9 Fan Feel + 9 Player Feel sub-weights)
  with one-click reset to the WES 1.0 defaults. Weights are Redis-backed
  and take effect immediately, site-wide — no redeploy needed. Breakpoint
  lookup curves (the temperature/wind/precip/etc tables themselves) are
  fixed code in 1.0, not admin-editable yet. WES's weights are an
  expert-designed starting point, explicitly not statistically validated —
  expect recalibration once real event-outcome data exists.
  **Operator impact:** WES is now public — every Weatherboard visitor sees
  the WES number in the Time column, and the hover tooltip surfaces all
  four numbers (WES, Environmental, Fan Feel, Player Feel). Only the
  per-category sub-scores (the ~26 internal components) and the weights
  themselves stay admin-only, via `/admin/system/wes-control`. The existing
  Weather column write-up is unaffected.

- **2026-08-20** — **6am ET game-day boundary; venue-page Next Game/Next Home
  Game now embed the actual Weatherboard row; black borders.** A day's
  games (Weatherboard "Today" + the schedule-window floor everywhere)
  now run 6am ET to 6am ET the next morning instead of midnight to
  midnight — last night's finals stay on "Today" until 6am, matching how
  people actually think about a day's slate (new `startOfGameDayET` /
  `gameDayDateStr`, mlb-schedule.ts). MLB venue pages: when a team's next
  game and next home game are the same game, only the Next Home Game card
  shows (no duplicate). Both cards, when the game is within the
  Weatherboard's 7-day window, now embed the literal `<WeatherboardTable>`
  row for that one game (odds, pitchers, live score, weather write-up) —
  previously a separately-built betting-lines layout that could drift from
  what the Weatherboard itself showed for the same game. Each card's
  heading now carries its own date/time in its own color ("Next Game" red,
  "Next Home Game" neutral) — e.g. "Next Home Game - Friday, August 21 at
  7:05pm eastern" — instead of a separate line below the matchup. Every
  game row on the Weatherboard now has a black border (thicker between
  games than between the away/home rows within one game).
  **Operator impact:** none to any workflow — public-page presentation
  and one scheduling-window semantic (6am vs. midnight) only.

- **2026-08-20** — **Odds fetch control, venue-page redesign, Weatherboard
  date bug fix + 3-tab restructure.** `/admin/system/odds-usage` (§6.6) gained
  full manual control over when the site requests fresh odds: Auto (tunable
  interval, replacing the fixed 6h) or Manual (the site never auto-requests —
  only "Fetch now" does, per league or all four) via a new
  `/api/admin/system/odds-fetch` action endpoint. Fixed a real nightly bug:
  the MLB schedule range fetch computed its start date in UTC, so after
  ~8pm ET (past midnight UTC) it silently queried from tomorrow, dropping
  every one of today's games from the Weatherboard for the rest of the
  night — now computed in ET. Weatherboard: only Today/Tomorrow/the day
  after show as tabs now; every other date lives at `/weatherboard/[date]`,
  reached via a date-picker on the main page (old per-league URLs still
  resolve, just aren't in the nav). MLB venue pages: header is now
  "Venue - Team" + "city, state · capacity · Weather Now in {city}" (linked,
  new tab); the old daily-forecast summary/impact-card block (which could
  show a different rain % than the per-inning field cards below it — a real
  inconsistency, since one was a daily aggregate and the other was
  first-pitch-hour) is gone, replaced by "Next Game" (red heading) and
  "Next Home Game" cards that reuse the exact same enriched entry the
  Weatherboard itself shows (odds, pitchers, live score/inning, weather
  narrative) when the game is within the Weatherboard's window, falling
  back to a plain teams/pitchers/date display otherwise.
  **Operator impact:** if you ever need odds fetching paused (e.g. to
  conserve credits during a plan change), switch to Manual on the usage
  page — no code change needed.

- **2026-08-20** — **Retractable-roof status, split field cards, clearer Odds
  API usage page.** `/admin/system/odds-usage` (§6.6) rewritten for clarity:
  consistently says "request" (not "fetch"), and "How the site spends
  credits" now explains the 6-hour cache mechanism step by step (what counts
  as a cache hit vs. a real request, worked example) instead of a bare bullet
  list. New `getRoofStatus` (mlb-schedule.ts) checks a retractable park's
  actual roof state for TODAY's game only (one live-feed call, cached 30
  min) — when confirmed closed, the Weatherboard and venue page correctly
  say "Roof closed — weather is not a factor" instead of showing a forecast
  that doesn't apply (this had been silently wrong for closed-roof games).
  Venue pages: the single "Wind on the Field" card (with a Wind/Gust toggle)
  is now 4 separate cards — Wind, Gusts, Temperature, Precipitation — each
  with its own inning picker; the wind/gust arrow is now a full two-sided
  shaft through the hub (a tail the same length as the arrowhead) instead of
  a one-sided ray. Weatherboard: added a compact per-game icon (baseball +
  wind arrow, temp, wind/gust, precip%) under the kickoff time showing
  first-pitch conditions, plus a weather-delay flag when MLB's status
  detail mentions delay/suspension/postponement.
  **Operator impact:** none to any workflow — public-page and admin-page
  presentation only.

- **2026-08-20** — **Odds API key rotated (free tier exhausted, moved to a
  paid 20,000-credit/month plan) + new admin tool.** Added
  `/admin/system/odds-usage` (§6.6) — a read-only snapshot of requests
  used/remaining and last-request cost, captured from the-odds-api.com's own
  response headers on each live (non-cached) fetch, plus the site's cost
  model (3 credits/fetch: h2h+spreads+totals, DraftKings-only, 6h cache).
  Also: the Weatherboard dropped its FanDuel and Injuries columns, added
  separate ML/RL/O-U (DraftKings only) columns to the right of the score,
  added a MLB top/bottom-and-inning indicator by the live score, added
  starting-pitcher name + throwing hand under each team name, dropped team
  logos, and replaced the compact weather cell with a prose write-up
  (first pitch through +3.5h: temp trend, wind/gusts, precip, air quality,
  low-sun glare) sourced from the WagerOnWeather Consensus forecast. Rotation
  numbers outside 100-999 are now dropped as bad data rather than displayed.
  **Operator impact:** check `/admin/system/odds-usage` occasionally to
  watch burn rate against the new plan's quota; no workflow changes.

- **2026-08-18** — **The site icon now shows up everywhere it should.** The icon
  appeared in browser tabs but was missing from the Vercel dashboard, shared-link
  previews, and Windows shortcuts. Cause: `/favicon.ico` was never an icon file —
  it was a PNG that had simply been renamed `.ico`, while the server told
  everyone it was a Windows icon. Chrome guesses from the file contents and drew
  it anyway; anything that trusts the label and opens it as a real icon got a
  broken file and drew nothing. It is now a genuine icon holding 16, 32 and 48
  pixel versions. The Apple/home-screen icon, which was showing **art from a
  different project entirely** (a mouth-and-tongue graphic, not our badge), is
  now the WAGER ON WEATHER badge on brand navy, as are the new Android icons.
  Shared links also now declare the preview image's dimensions, so Slack and
  LinkedIn render the large card instead of a thumbnail.
  **Operator impact:** none to any workflow. This is branding on public surfaces —
  it forecasts nothing, grades nothing, settles nothing, and feeds no market. If
  you still see the old icon, that is your browser's cache, not the site.

- **2026-08-13** — **The Wind and Gusts map tabs now animate.** Thin trails drift
  across the map along the wind, over the same colour heatmap and barbs that were
  already there. Nothing new is fetched: the particles are advected through the
  identical grid the heatmap and the barbs read, so the animation cannot disagree
  with the numbers on screen — it is the existing data, moving. The heatmap still
  says how hard, the barbs still give you the number at a point; the motion adds
  the part neither could show, which is where the air is actually streaming.
  **Operator impact:** none to any workflow. It is decoration on a public page —
  it forecasts nothing, grades nothing, settles nothing, and feeds no market.
  Anyone whose device asks for reduced motion gets the heatmap and barbs with no
  animation at all.

- **2026-08-12** — **New Satellite tab on the ZIP-page map.** Live cloud imagery
  from **NASA GIBS (GOES-East ABI GeoColor)**, refreshed every 10 minutes, with
  an "as of" stamp in the reader's local time. No API key, no quota, no vendor —
  US government imagery, which is provenance we can defend on a real-money site.
  **Why it matters to operators:** it is a *third opinion*, independent of both
  the forecast model (Open-Meteo) and the radar (RainViewer). When those two
  disagree — the situation behind every phantom-rain report so far — you can now
  look at the sky instead of picking a side. Sits between Radar and Temp in the
  tab row. Imagery only; it feeds nothing, grades nothing, settles nothing.
  Zooms past level 7 show a gap rather than upscaled mush, because GIBS refuses
  over-zoomed requests outright.

- **2026-08-12** — **ZIP pages no longer report phantom "Light rain."** Reported
  on 29209 (Columbia SC): the page showed Light rain while NWS reported Mostly
  Clear and the model had 0.00 mm for all 24 hours. Cause was the radar nowcast,
  not the forecast. It sampled a 12 km disc around the ZIP and counted its
  anti-speckle minimum (2 pixels) across that whole disc, while the "is it
  raining *here*" test looked only at the single nearest pixel — so **one stray
  1 km² radar bin over the centroid, plus any unrelated cell out at 10 km, was
  enough to ship "Light rain."** Confirmed live: the 20:40Z frame had 35 pixels
  in the disc and exactly 1 overhead. Now both the rain/no-rain call **and** the
  intensity come from the 3 km overhead zone only, and that zone must clear the
  2-pixel minimum itself. A cell elsewhere in the ZIP is still reported, but as
  a *distance* — it can no longer set the conditions text, and a heavy cell
  across the ZIP can no longer inflate light rain overhead into a downpour.
  **Operator impact:** none to any workflow; current-conditions text on public
  ZIP pages is simply stricter about claiming rain. Settlement is unaffected —
  it has always graded against NWS observations, never radar.

- **2026-07-27** — **The Forecast Tracker now fills itself; markets can use
  half-degree lines.** (1) New daily cron `/api/cron/forecast-tracker-autolog`
  (11:00 UTC / 7 AM ET) records tracker entries for the 14 seeded cities at
  +1 and +3 days, for high and low temp, across the three sources we can fetch
  without a human: **live site (consensus)**, **raw model**, **NWS**. Re-running
  the same day is a no-op — entries dedupe on (city, metric, target date,
  source). **Today is never logged**, because `getForecast()` floors today's
  high/low with observations already recorded. Uses the existing `CRON_SECRET`
  (or a dedicated `FORECAST_TRACKER_CRON_SECRET`); no new setup needed.
  **Operators no longer need to run manual pulls** — manual entry remains for
  AccuWeather / Weather.com, which have no automatable feed. (2) Weather Market
  Ideas now defaults to **half-degree lines**, which makes a push impossible
  (a whole-degree result can never tie a `.5` line). Rounding rule: the line is
  the half-degree nearest the forecast gap, so a 10°F gap becomes **10.5** — the
  favourite must win by 11+, and the tie goes to the underdog. That is
  deliberately not a 50/50 line, and the odds compensate (≈ +105 / −125 instead
  of −110 / −110). This only became safe once pricing existed; a fixed −110
  could not express it. Set granularity back to `whole` to restore pushes.
- **2026-07-27** — **Forecast Tracker now grades the forecast we actually ship,
  and Weather Market Ideas prices its lines.** (1) The tracker's
  `wageronweather` column was **raw Open-Meteo, deliberately not the
  consensus** — so the leaderboard compared a bare free global model against
  NWS/AccuWeather/Weather.com and WoW always looked worst, while the forecast on
  the live site (an NWS-weighted blend, ~65% NWS with no AccuWeather key) was
  never scored at all. Added **`WagerOnWeather (live site)`** as its own tracked
  source and relabelled the old column **`WagerOnWeather (raw model)`**. Judge
  the product by the live-site row; the raw row stays as a diagnostic. Same-day
  consensus is deliberately **not** pre-filled, because `getForecast()` floors
  today's high/low with observations already recorded and scoring that as a
  forecast would flatter the result. Existing entries are unchanged — sourceless
  legacy entries count as raw-model. (2) Weather Market Ideas no longer stamps a
  fixed **-110/-110**: it prices from a cover probability with sigma set by
  forecast horizon, and now surfaces **push probability** (5-10% on
  whole-degree lines) and the ±°F uncertainty behind each line. The suggested
  line still sits exactly on the forecast difference, where ~-110 is correct —
  the pricing matters when you move the line off the suggestion.

- **2026-06-12** — **Corrected the safety model to match reality: grading +
  settlement are AUTOMATIC.** The manual previously said "nothing publishes,
  grades, or settles automatically." In fact a daily Vercel cron
  (`/api/cron/grade-wagers`, 07:00 UTC ≈ 3 AM ET) locks expired markets, grades
  them against NWS observations, and settles player bets (moves money) with no
  operator — this is why bets resolve overnight. Updated the Quick Start rules,
  §2 golden rules, and §8 to state that **market creation / pricing / publishing /
  wallet ops are manual, but grading + settlement are automated** (with manual
  grade/settle/void still available as overrides). Same correction mirrored in
  `CLAUDE.md` and `docs/AI-MAINTAINER-GUIDE.md`.
- **2026-06-12** — **Admin Wager Dashboard accounting display fixes + ID numbers.**
  (1) The player/market **Bet History "Payout" column** now shows the *realized*
  result by status — won → `+profit` (green), lost → `−stake` (red), push/void →
  `stake returned`, pending → `potential` — instead of always showing a green
  potential payout (which made losing bets look like wins). (2) **Lost-bet ledger
  entries now record $0**, not `−stake`: in the escrow model the stake is debited
  when the bet is *placed*, so a loss moves no money at settlement. This makes the
  Transaction History "Amount" column reconcile to the running balance (it was
  double-counting losses). Balances were always correct; only the displayed
  ledger was off. (3) Every **market and every bet now shows its ID number**
  (`#WKT…` on market cards, the ticket number as a column in both bet tables). (daily
  highs/lows averaged across Open-Meteo + NWS, plus AccuWeather when
  `ACCUWEATHER_API_KEY` is set), labeled "WagerOnWeather Consensus." Bulletproof
  fallback to Open-Meteo; kill switch `CONSENSUS_FORECAST_ENABLED=false`.
  Settlement still uses NWS observations.
- **2026-05-30** — Added **per-employee admin accounts**: owner creates admin
  logins (email + password) at `/admin/admins`; employees get the `admin` role
  (full access except managing admins), owner keeps the passphrase →
  `super_admin`. Documented in §3 + the tool directory.
- **2026-05-30** — Added a **Quick Start** section ("your first 15 minutes") at
  the top: the safety rules, the happy-path to publish a first market, and the
  daily checks, all on one screen.
- **2026-05-30** — Added the in-app reader at `/admin/training` (renders this
  file), linked from SystemNav ("Operator Tools") and the Quick Links bar. Added
  a repo `CLAUDE.md` codifying the "update the manual when operator-facing
  features change" rule.
- **2026-05-30** — Initial manual created. Covers the market lifecycle, daily
  rhythm, full admin tool directory, Kalshi/Polymarket intel, safety model, and
  the public site. Reflects the new **Forecast Market Research** tool and the
  removal of the four forecast-intelligence cards from public ZIP pages.

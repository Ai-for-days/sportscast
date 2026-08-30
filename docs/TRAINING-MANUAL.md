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
**Last reviewed:** 2026-08-29 · **Maintainer:** Derek

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

> A third path in: **Wager Schedule (`/admin/system/wager-schedule`)** shows
> every tracked MLB/NFL/NCAA Football/MLS game for one date (with a calendar
> to look ahead), one row per TEAM — rotation number, score, probable
> pitcher (MLB), and Wager on Weather's daily high/low forecast at **that
> team's own home venue**, not necessarily where the game is being played
> (the away team's row shows their home city's forecast). Each team row has
> its own **O/U High** and **O/U Low** buttons (opens the wager form
> pre-filled as an over/under on that specific number). Each game also gets
> a **Pointspread** picker — choose any two of the game's 4 high/low values
> (away high/low, home high/low) as Favorite and Underdog, e.g. Tampa Bay's
> high vs Baltimore's low, or a team's own high vs its own low — and
> **Create Pointspread Wager** opens the form pre-filled with both sides'
> location, lat/lon, and metric. Useful when you're working game-by-game
> off the schedule rather than starting from a generated idea. This tool
> always computes a **live forecast** — it bypasses the normal shared
> 10-minute forecast cache — since you're about to lock a real wager's terms
> off the number it shows; every other page (including the public
> Weatherboard) is unaffected and keeps using the shared cache. Once a wager
> is created its terms are frozen in a `PricingSnapshot` at creation time and
> never move with later forecast changes — locked-in permanently, only
> changeable via the manual-approval line-history workflow.

> **Live Forecast panel (added 2026-08-24):** the wager form itself now shows
> a **"Live Forecast"** box directly above the Suggest Lines/Spread button,
> as soon as you've picked a location (or both locations, for pointspread), a
> metric, and a confirmed date — the same forecast the Suggest button would
> pull, but purely informational: it fetches automatically and re-fetches
> whenever those fields change, and never writes to the line/odds/spread
> fields itself. Over/under and range-odds wagers show the consensus mean
> plus the min/max/source-count spread and a breakdown per weather source;
> pointspread wagers show both sides' consensus plus the expected A-minus-B
> difference. If nothing's tracked yet for that location/date, it shows the
> same "no forecast available" message the Suggest button's error would.

> **Market Design Lab:** below the Live Forecast panel, click **Analyze
> Market Design** to run a purely advisory pre-publication check on the
> current form fields — fairness / fun / risk scores (0–100), an estimated
> house edge, pricing notes, warnings, and recommended adjustments, plus a
> verdict (Publishable / Needs Review / Not Recommended). It never touches
> the wager itself — you still click **Create Wager** separately — it only
> writes its own review record + an audit event. Every warning is phrased as
> **fact + why it matters** (e.g. "Significant side skew (18%) — implied
> probabilities lopsided: instead of both sides sitting near an even 50/50
> split, one side is priced as clearly more likely to happen...") rather than
> a bare number, so you don't have to already know what "skew" or "edge"
> means to act on it.

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
| `/admin/system/wager-schedule` | All-sports schedule (MLB/NFL/NCAA Football/MLS) for one date, with a calendar to look ahead — one row per team, with rotation number and Wager on Weather's daily high/low forecast at that team's own home venue (not necessarily the game site). O/U High and O/U Low buttons per team pre-fill an over/under wager on that number; a per-game Pointspread picker lets you choose any two of the game's 4 high/low values as Favorite/Underdog (own high vs own low, or cross-team/cross-metric) and pre-fills a pointspread wager with both sides. |
| `/admin/wagers` | Wager Management — operational dashboard for all wagers, and **the only place expired markets are visible** (2026-08-26). Status tabs (All / Needs Grading / Open / Locked / Graded / Void) now compose with a **date filter** (All / Past / Today / Tomorrow / Next 7 days, or one exact date), a **wager-type filter** (pointspread / over-under / range odds), a **weather-metric filter**, and a **sort control** (needs-grading-then-newest, target date, wager type, status, or created; ascending or descending). It also **pages the whole book**: it used to fetch a flat 200 records, so anything older than the 200 newest was unreachable from the UI. Load more pulls the next 200 until you have them all. |
| `/admin/wagers` (Release to engines) | On an auto-managed market that is **void, graded, or expired**, a purple **Release to engines** button clears the game-to-wager pointer so the auto-market engines can build that game a fresh market on their next tick. It does **not** create, price, or cancel anything itself. Use it after voiding or deleting an auto-created market: without it, that game gets no replacement for the remaining 90 days of the pointer's TTL. |
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
| `/admin/system/odds-usage` | Odds API (DraftKings lines) metered credit usage: requests used/remaining, last request cost, the site's cost model, and a spend log breaking down exactly what was spent and on which sport/endpoint (rolling ~200-request window). |
| `/admin/system/wes-control` | Weather Experience Score (WES): live per-game monitoring (Raw WES, Final WES, severe-weather cap + reason, Environmental/Fan Feel/Player Feel) plus weight controls for all three tiers. Every score renders as a colored chip on the **same 21-band scale the customer sees** (2026-08-29) — hover one for its adjective. |
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

**Expired markets are admin-only (2026-08-26, per Derek: "no one should be
able to see expired wagers except the admin")** — the public site shows
**only current and future markets**: status `open` AND the lock time still in
the future. Locked (closed, not yet graded), graded (settled), voided, and any
open record that has drifted past its own lock time are all invisible to
customers and 404 on every public surface. One predicate enforces it,
`isPubliclyVisible()` in `public-wager-view.ts`, used by the markets page,
`/api/wagers`, `/wagers/{id}`, `/wagers/game`, and the Weatherboards' native
market lookup. `/api/wagers` no longer accepts a `status` param at all; it used
to, which meant `?status=graded` handed the whole settled book to anyone who
asked. **The one deliberate carve-out:** a customer still sees how a market
*they personally bet on* resolved, because bet history is built from
`/api/bets` via `toPublicWagerView` and never goes through the browse path.
Browsing is gated; a player's own receipt is not. Keep that distinction if you
touch this.

**One carve-out on that rule, added 2026-08-27 per Derek:** the **Weatherboards**
keep showing a market after it locks, greyed out and labeled `closed`, with no
link. The three hours before kickoff plus game time are peak interest, and a
blank cell there reads as "there is no market for this game" rather than "this
one has closed." The market pages themselves stay gated, which is exactly why a
closed cell is not clickable: linking it would land the customer on a 404.
Graded and voided markets never appear on the board at all.

**Customer-visibility boundary** — customers **never** see: internal
interestingness/ranking scores, duplicate/correlation risk warnings, QA state,
operator notes, tuning notes, unpublished ideas, draft wagers, or any admin-only
signal. They see **only published markets + public weather**. If you ever find
admin data leaking to a public page or the public API, treat it as an incident.

**Locking runs on its own clock (2026-08-27)** — `/api/cron/lock-expired`
fires at `:20` and `:50` past every hour and does exactly one thing: flips an
open wager whose lock time has passed to `locked`. No grading, no settlement,
no wallet. It was split out of the daily grading cron, which still does the
same flip as a safety net, because that one also settles bets and so cannot
safely run more often.

Nothing customer-facing depended on the flip being prompt: every public page
compares the clock to the wager's own lock time on each read, so an expired
market is unbettable the moment it expires either way. What the old once-a-day
lag cost was **bookkeeping accuracy** — an inflated open count, an Open tab
listing markets that had really closed, and a closing-line snapshot captured
hours after the line actually closed. Expect the Open tab and the open count
to look smaller and truer from now on.

**What's manual vs. automatic** — market creation, publishing, pricing changes,
and wallet operations are **manual**, deliberate operator actions with an audit
trail. **Grading and settlement are automatic:** the daily grading cron
(`/api/cron/grade-wagers`, ~3 AM ET) locks expired markets, grades them against
NWS observations, and settles player bets (moving money) on its own. Operators
keep manual grade / settle / void tools for corrections and early resolution.

**One narrow, explicit exception (2026-08-23, extended 2026-08-25, per
Derek):** four market shapes are both **created and priced automatically**,
each on its own 30-minute-cadence, staggered cron invocation of the same
route (`/api/cron/auto-hvl-pricing?only=...`, see §9 below and
`auto-hvl-market.ts` / `auto-cross-venue-market.ts` / `auto-venue-ou-market.ts`),
with no operator step, no publish click:
  - "Wager on Weather - HvL" (2026-08-23): cross-venue High vs. Low pointspread.
  - "Degrees HvH" and "Degrees LvL" (2026-08-25): cross-venue High-vs-High
    and Low-vs-Low pointspreads, same engine shape as HvL just same-metric
    both sides.
  - Per-venue "Temp at Game Start" O/U (2026-08-25): one for the home
    team's own venue, one for the away team's, on the forecast at the exact
    kickoff instant.

Each is scoped the same tight way HvL always was: fixed -110/-110 odds, a
single mechanical pricing formula per market type, one shape, and it stops
touching a wager the moment an operator locks it (**Lock Now**) or its own
lock time passes. Each only ever adjusts wagers it created itself
(`autoManaged: true`), never anything an operator built by hand, even an
identically-shaped one, and each market type's Redis dedup mapping lives in
its own namespace so the four engines can never collide with each other. Do
not extend this precedent to any other market type without asking first.

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
  it sits right in the header bar). Every one of the 15-Day Forecast's daily
  rows shows a full WES badge (added 2026-08-25) — the same score-band color,
  plain-English adjective (e.g. "Ideal", "Outstanding"), and "What's WES?"
  link as the "Feels like" badge above it — not just Today's row. Since
  2026-08-29 that badge is a chip FILLED with the band color, with the
  adjective inside it. `[...slug].astro`
  already computes a real WES for all 15 days (`dailyWes`); `DailyForecast.tsx`
  previously only applied the full band treatment to day 0 and left every
  other day a plain amber/red pill with no label or link.
- **"Bet on {City} Weather"** section: the open, published markets for that
  location. A signed-out visitor sees the markets and a "Sign up to place bets"
  prompt; a signed-in customer can pick an outcome and place a wager via the bet
  slip.
- Customers see **only** published markets and public weather — never any of the
  internal research/QA/ranking described in this manual.
- **`/wagers`** (market browser) is **current and future markets only** as of
  2026-08-26 (see the expired-markets rule in [§8](#8-safety-governance--compliance)).
  It used to render four sections, Open / Locked / Resolved / Voided, which
  published the whole settled book. It is now a **sortable table**: Date,
  Closes (a countdown), Wager type, Market, Location, and Line / odds, with
  filters for date (Any / Today / Tomorrow / Next 7 days, or an exact date),
  wager type, and weather metric, plus a search box and a Load more button
  that pages beyond the first server-rendered 100. If a customer asks where a
  settled market went: results are no longer browsable, but they can still see
  any market they personally bet on in their own bet history.
- **`/wagers`** (market browser) and **`/wagers/{id}`** (market detail): every
  outcome tile shows the actual temperature/line/spread number, not just the
  label and odds (added 2026-08-24, reported live: "you are missing the
  temperatures in the cards" — outcome tiles used to show only "Over"/"Under"
  or a location name plus a big odds figure, with no number to actually bet
  on). `src/lib/public-wager-display.ts`'s `outcomeTarget()` derives it —
  the over/under's `line` for both sides, or the pointspread's `spread`
  (flipped sign for side B) — shared by both `WagerCard.tsx` (the list page)
  and `WagerDetailPage.tsx` (the detail page) so they can't drift apart.
  Range-odds outcomes are unaffected — their range is already in the label.
- **Weatherboards** (`/weatherboard*`): alongside the DraftKings odds columns,
  ONE column — **"Wager on Weather - HvL"** — shows this site's own native
  market for the game: always the warmer-forecast venue's daily high against
  the other venue's daily low (cross-venue only; a same-venue High-vs-Low
  novelty market, if one exists, only shows on Weatherboard Extended, not
  here). Clicking it does NOT go straight to the wager — it jumps to this
  same game on the matching **Weatherboard Extended** page
  (`/weatherboard/extended*`, same 5-page structure: bare + MLB/NFL/NCAA
  Football/MLS), so the customer sees every published option for the game
  before picking one. Extended has no DraftKings odds at all and splits the
  detail into 4 columns — "Degrees HvH" (both sides `high_temp`), "Degrees
  LvL" (both sides `low_temp`), "Degrees HvL" (any cross-metric pointspread,
  including same-venue high-vs-low), and "Venue Degrees O/U" (over/under at
  each side's own venue) — every entry there links to `/wagers/game?...`, a
  page listing **every** published wager for that specific game (pointspread
  + O/U, both venues), from which the customer picks one to actually bet.
  Same customer-visibility rule as everywhere else: only `open`/`locked`
  wagers ever appear on either board, never drafts or QA-pending markets.
  Shows "-" when nothing's been published yet for that bucket. As of
  2026-08-25 all 4 Extended columns are auto-populated for every tracked
  game (see the next bullet); before that, only "Wager on Weather - HvL"
  auto-priced itself, and the other three only ever showed something an
  operator happened to have created by hand.
- **All four native-market shapes are fully automatic** (`auto-hvl-market.ts`
  / `auto-cross-venue-market.ts` / `auto-venue-ou-market.ts`,
  `/api/cron/auto-hvl-pricing` every 30 min) — a deliberate, narrow exception
  to the "market creation is always operator-initiated" rule above, per
  Derek's explicit instruction (HvL: 2026-08-23; HvH/LvL/venue O/U:
  2026-08-25). For every tracked game within the ~16-day forecast horizon:
    - **HvL:** whichever venue has the larger forecasted daily high becomes
      the favored "High" side; the other venue's forecasted daily low is the
      "Low" side. `spread` = (High − Low), rounded to the next half-point
      **always in the underdog side's favor** (e.g. a raw 14° gap becomes a
      14.5 line, never 13.5) so the favored side must win by more than the
      raw forecast gap, never less.
    - **HvH / LvL:** same rounding convention, but both sides compare the
      *same* daily value (both highs, or both lows) instead of cross-metric:
      whichever venue's forecast is currently greater is locationA
      (fixed at creation; only the spread's magnitude *and sign* keep moving
      if the forecast gap narrows past zero, since there's no fixed
      High/Low role to anchor it to the way HvL has).
    - **Venue O/U ("Temp at Game Start"):** one O/U per team, at that team's
      own venue, on the forecast at the exact instant the game starts
      (`kickoffUTC`, same real-world moment for both venues, "it holds true
      for all 4 sports," per Derek). The line is the forecast temp at that
      instant rounded to the nearest half-degree, always a `.5` so a push is
      never possible. The wager's `targetTime` is stored as that instant's
      **ET wall-clock time**, and its location's `timeZone` is forced to ET
      too (not the venue's own real zone), so grading's
      targetDate+targetTime+timeZone round-trip reconstructs the exact same
      kickoff instant regardless of which venue the wager is for. Skipped
      for the away team when both teams share one venue (the home-side O/U
      already covers it).
  Odds are fixed **-110/-110** both sides on all four, no vig modeling,
  unlike Suggest Lines/Spread. Each engine re-prices the SAME wager (never a
  duplicate) as new forecasts come in, and stops touching it the moment it
  locks: either the operator clicks **Lock Now** early, or its lock time
  (3 hours before kickoff, all four engines as of 2026-08-26) passes
  naturally. Each only ever touches wagers it
  created itself (`autoManaged: true` on the record) — never an
  operator-created wager, even one shaped identically.
- **By-time (`actual_temp`) grading now actually uses the target time**
  (fixed 2026-08-25, found while building the venue O/U markets above): the
  grading code's own comment claimed an `actual_temp` wager settles "against
  observation closest to target time," but there was no hourly observation
  data captured to grade against, so every by-time wager actually settled
  against the day's overall high, identically to a plain `high_temp` market.
  `fetchNWSObservations` now also captures each reading's own timestamp;
  grading uses the reading closest to the wager's `targetTime` (resolved via
  the wager's own `location.timeZone`) for `actual_temp`, falling back to
  the day's high only when hourly data genuinely isn't available (e.g. an
  observation cached before this fix), so nothing that graded before this
  change grades differently now.
- **Weatherboard/Extended market text always names the actual venue**
  (added 2026-08-24, per Derek: "you need the venues in there"), never a
  plain city/state — e.g. **"Tropicana Field High Day Temp vs. Comerica Park
  Low Day Temp -34.5 (-110)"** for a pointspread side, or **"Tropicana Field
  Low Day Temp 75: Over 75 (-175) / Under 75 (+155)"** for an over/under.
  `weatherboard-markets.ts`'s formatters resolve the venue name by
  coordinate match against the tracked venue table regardless of what name
  the underlying wager record itself stores (city/state, for an
  operator-created wager from before this change, or a plain city search)
  — falling back to that stored name only if no tracked venue matches. Both
  new wager-creation paths (the automated HvL engine, and the Wager Schedule
  tool's prefills) now store the venue name directly going forward too.
- **The same venue-name resolution now covers everywhere else a wager's
  location or title is shown** (added 2026-08-25, per Derek: "it needs to be
  venue vs. venue not town vs. town" — reported against `/wagers/game`
  showing "Arlington, TX High vs Chicago, IL Low" for a market really at
  Globe Life Field vs. Rate Field). `public-wager-view.ts`'s
  `describeLocation()` now resolves the venue name by coordinate the same
  way `weatherboard-markets.ts` does — this fixes `locationSummary`, every
  rules-text sentence, and every outcome label across `/wagers`,
  `/wagers/{id}`, `/wagers/game`, and the ZIP page's "Bet on {City} Weather"
  section, for every wager regardless of when it was created. The wager's
  `title` string is separate (a plain string baked in once at creation, e.g.
  by `auto-hvl-market.ts` or `WagerFormModal.tsx`'s auto-title, and never
  regenerated) — `wager-title.ts`'s new `venueifyWagerTitle()` patches it for
  display by substituting a location's exact stored name with its matched
  venue's name wherever that name literally appears in the title, so an
  older wager's title self-heals too without any stored record being
  mutated. `findVenueByCoords()` (new, `venue-data.ts`) is now the one
  shared coordinate-lookup both files use.

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
- **Pointspread `spread`** — Location A's own line in favorite/underdog
  notation, exactly like `locationAOdds`/`locationBOdds`: **negative means A
  is favored**. Settlement: **A wins when (A's observed value − B's) +
  spread > 0** — i.e. A must beat B by more than `|spread|` when spread is
  negative, or B only needs to lose by less than `spread` when it's
  positive. It is *not* "the expected A-minus-B value" (that reading caused
  a real grading bug fixed 2026-08-23 — see the change log).
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

- **2026-08-29**: **ESPN was 403'ing every request from our servers, and the Weatherboard hid it.** Reported by Derek as a missing feature ("we need to add time on the scoreboard and quarter/half for NFL, college football, and MLS"). The display for it had been there since 2026-08-24: `livePeriodClock` renders "Q3 6:49" on the board. **The data never arrived.** Production logs on the opening Saturday of the college football season showed `ESPN fetch 403 Forbidden` for **every** league, continuously: NFL, college football, MLS and NWSL. **What made it invisible:** both callers degrade quietly and neither raised an alert. The Weatherboard fell through to The Odds API, which carries a score but no period or clock, so a live game rendered as a bare "In Progress" with rotation numbers; `/college-football-weather` and `/nfl-weather` rendered their "no games scheduled" state in the middle of a live slate. MLB was correct throughout — it goes to the MLB Stats API instead, which is exactly why only MLB still showed innings. Three fixes: **(1)** new `espn-scoreboard.ts`, one shared client that sends browser-shaped headers (the old `WagerOnWeather/1.0` agent from a datacenter IP is the shape ESPN's edge rejects) and falls back to **`site.web.api.espn.com`**, which serves the same paths with the same response shape (verified live against HAW @ STAN: state=in, period 4, clock 2:41 on both hosts). It logs which host answered, so a silent failover is visible. **(2)** Both ESPN date windows were built from **UTC** calendar dates, which name tomorrow from about 8pm ET onward. Measured at 10:31pm ET: the college football window asked for `20260830` onward, got 444 games, and not one was being played at that moment — the same bug `mlb-schedule.ts` was fixed for on 2026-08-20, never applied to the ESPN path. The board now starts at the current **game day** (yesterday until 6am ET, for late West Coast finishes), and the football pages' Tuesday-to-Monday week is computed in ET, which also stops Monday Night Football from falling outside its own week. **(3)** The Time column on both Weatherboards now leads with where the game actually is for **all four** leagues — `Q3 6:49`, `2nd Half 71:12`, `Top 5th` — falling back to the feed's status text only when the period is not populated yet, which is the only case that should ever read "In Progress". `/college-football-weather` and `/nfl-weather` show the same label in place of the kickoff time once a game starts. Tests in `tests/espn-scoreboard.test.ts` and `tests/espn-date-window.test.ts` (which pins the 10:31pm ET boundary and the Monday-night case). **Worth knowing:** this does not make ESPN reliable, it gives one blocked edge a second door. Both callers keep their Odds API fallback for when every attempt fails.

- **2026-08-29**: **Live scores on the weekly football weather pages.** `/college-football-weather` and `/nfl-weather` showed only a kickoff time, so a game already being played looked identical to one that had not started. Each game now carries its ESPN score (`homeScore`/`awayScore`, null until kickoff so a scheduled game never reads "0 - 0"), a red **Live** chip while it is in progress, and ESPN's own status line in place of the kickoff time once it starts. `fetchScoreboard` in `espn-football-schedule.ts` also logs every failure and every empty response: an ESPN outage used to surface only as a page claiming no games were scheduled.

- **2026-08-29**: **A missing feels-like temperature was quietly costing a perfect day 35 WES points.** Chasing the `NaN` guard above turned up something worse than a `NaN` badge. **wesFinal is never NaN.** `interpolate()` in `wes.ts` compares its input against every breakpoint in the table; every comparison against a non-finite number is false, so it falls past the whole table and returns the **last breakpoint's score**. Bad data does not blow up — it produces a confident, plausible, mid-range number with nothing to reveal it. **What made that reachable:** `open-meteo.ts` read `feelsLikeF: Math.round(cur.apparent_temperature)` with **no `??` fallback**, alone among the temperature-family fields — `dewPointF` (`?? tempF - 10`), `uvIndex` (`?? 0`) and `visibility` (`?? 10000`) all carried one, on the lines directly above and below it. Open-Meteo pads a series with null past **that variable's own** horizon, and apparent_temperature's is not always temperature_2m's, so the 2026-08-27 null-temperature skip does not cover it. `Math.round(null)` is **0** — the same coercion that published the 0.5F markets. **Measured blast radius:** a real 75F/5mph/sunny day scores **WES 100 "Perfect"**; with a null apparent_temperature it scored **WES 64 "Fair"**. Feels-like is the heaviest single input in WES (it drives temperatureScore, which feeds Environmental and then 0.65 of Fan thermal comfort and most of Player Feel), so one missing field moved the badge eight bands, from the top of the scale to the middle of it. Fixed at the source: `?? tempF` on both the current and hourly paths. Dry-bulb is the honest stand-in — it IS the apparent temperature whenever there is no wind-chill or heat-index effect to add. Tests in `tests/wes-input-integrity.test.ts`, which also pin the surprising part (a non-finite input is *swallowed*, not propagated) so nobody deletes the upstream fallback believing the `wes-scale.ts` NaN guard is what protects the badge. **Still open:** `interpolate()` silently converting a non-finite input into the table's endpoint score is the mechanism that let this hide, and it is unguarded for every other WES input too. Making it refuse, and having WES return `null` the way `computeGameWes` already does when the forecast does not reach, is the real structural fix — deferred because it changes the WES 1.0 scoring engine.

- **2026-08-29**: **One WES color scale, everywhere, and WES badges became filled chips.** Derek supplied an exact 21-band scale (score range, adjective, hex) and asked for it on "all WES numbers everywhere." It now lives in `src/lib/wes-scale.ts` as the single source for the public badges (hero, 15-day forecast, both Weatherboard tables) **and** for `/admin/system/wes-control`, which until now had its own private four-bucket red/amber/slate/emerald ramp — an operator reading 62 saw plain slate while the customer looking at the same game saw a green "Fair". The sub-scores (Environmental / Fan Feel / Player Feel) are on the same 0-100 scale and now get the same colors. **Two label changes:** 10-14 is **Extreme** (was "Dangerous", which collided with the severe-weather cap language), and every band's color is now one exact hex rather than a computed light/dark pair. **Why the badge is now a filled pill instead of colored text:** these hexes are fills. As text they are unreadable at both ends of the scale — deep maroon `#5A0010` on the navy dark theme is 1.14:1, and yellow `#C8C72A` on a white page is 1.80:1, both far under WCAG AA. As a chip background with an automatically chosen ink, the worst band in the scale still reads at 4.36:1, in either theme and on any sky, so the hero badge no longer needs the special case it used to carry and the adjective moved inside the chip. **`getWesBand` now resolves a non-finite score to the WORST band** rather than falling past every band onto the array's fallback, which rendered a missing score as a dark-teal "Perfect". Keep in mind this is a **backstop, not the protection** — see the separate 2026-08-29 entry below on what chasing it actually turned up. `/what-is-wes` gained a **"What the Colors Mean"** legend rendered from the scale itself, so it cannot drift from the badges. Tests in `tests/wes-scale.test.ts` transcribe Derek's table independently and fail if a boundary, label, or hex moves.

- **2026-08-28**: **Two operator safeguards, both per Derek.** **(1) Release to engines.** Voiding or deleting an auto-created market left its game-to-wager pointer behind for the rest of its 90-day TTL, so the engine kept skipping that game and never built a replacement. That is how the Faurot Field 2026-09-11 game permanently lost its market while its untouched sibling repriced itself correctly. New `auto-market-mapping.ts` finds the pointer(s) aimed at a wager (wagers do not store their gameId, so it scans the five engine namespaces) and a **Release to engines** button on `/admin/wagers` clears them. Audited. **(2) An alarm for implausible lines.** Nothing would have flagged another mispriced auto line; Derek caught the 0.5F ones by eye. New `auto-market-line-audit.ts` checks a forecast value against **the venue's own hourly forecast for that date** and the engines now refuse to price one that fails, raising a critical alert instead. **Deliberately NOT a range check:** a "temperature must be 20-100F" rule would have caught the 0.5s and then suppressed that same week's genuine 110F Lawrence KS and 107F Columbia MO forecasts, which are exactly the extremes the product exists to price. Internal consistency survives any weather: 0F among 80s is refused, 110F among 100s passes, and a real subzero night passes. Fails closed when a date has no hourly data to corroborate against. `raiseAlert()` is now exported from `alerts.ts` so cron engines can alert between ticks (alerts previously only appeared when an operator opened the page). Tests in `tests/auto-market-line-audit.test.ts`, including one that fails if an engine adds a namespace the release tool does not know about.

- **2026-08-27**: **A rain label the model does not stand behind is now dropped.** Derek at ZIP 29209: "radar shows nothing but hourly forecast says rain in 5 minutes?" Open-Meteo can emit a drizzle/rain `weather_code` alongside **0.0mm** of its own forecast precipitation and a low chance of any. Every override in `open-meteo.ts` is deliberately upgrade-only (written that way after the opposite incident at this same ZIP, where the radar sampler read a placeholder tile and put "light rain" on a clear day), so the phantom label survived to the UI: an hourly row reading **"Light rain" next to its own "18%"** while the radar showed nothing. New `isPhantomRain()` drops it and falls back to the sky description from cloud cover. **Narrow on purpose, in two ways:** only **rain and drizzle** (a phantom snow, thunderstorm, freezing or hail code is left alone, since under-reporting those is far worse than a contradictory label), and only when there is **no precipitation AND under 25% chance**. A missing probability is never treated as a phantom. Anything actually happening re-upgrades immediately afterward from the radar nowcast and then the NWS station, so this cannot hide real weather. **Checked while investigating, all clean at the time:** the model (0mm/18%/Overcast), the radar sampler (no echo within 12km), RainViewer itself (newest frame 7 min old), and station KCAE (Partly Cloudy, 28 min old). Two related timing facts worth knowing: the first hourly row is **current conditions**, which an NWS observation up to **90 minutes old** can upgrade to rain; and the forecast is server-cached for **10 minutes** while the radar map fetches live, so the two panels are never quite the same age. Tests in `tests/phantom-rain.test.ts`.

- **2026-08-27**: **City search resolved ambiguous names to the wrong town, which is why Forecast Tracker pulls looked strange.** Derek: "double check that art in weather is pulling correct information as his temperatures when pulled seem strange." (**Art** is the internal label for the raw Open-Meteo model in the Forecast Tracker, kept distinct from the public **Wager on Weather** consensus.) The values were real temperatures for the **wrong place**. `searchLocal` returned the FIRST match from a file ordered by ZIP code, so a bare city name resolved to whichever state holds the lowest ZIP prefix: **"Denver" meant Denver, NEW YORK** (about 1,700 people), "Columbia" meant Columbia, Connecticut, "Portland" meant Portland, Maine. Nothing in the answer gives that away, so wrong entries were being logged against a forecast-accuracy record. Fixed by ranking matches on the count of distinct ZIPs in a city, a size proxy already in the data (Denver CO 66, Denver NY 1). An explicitly typed state still overrides the ranking. This also fixes the **public city search**, which shares the same function. It deliberately does not claim to settle genuinely close pairs (Arlington VA 27 vs TX 19); type the state for those. Tests in `tests/city-search-ranking.test.ts`.

- **2026-08-27**: **Definitive lock rule, replacing every earlier one.** Derek: "for all wagers that measure daily highs or lows, those all lock at 6am at the time of the venue where the game is played. for wagers that do not measure daily, those all close 3 hours before the game starts." **Which rule applies is decided by the METRIC, not the market type**, and the 6 AM one is **venue-local, not Eastern**. This supersedes all four conventions that had accumulated: 11:45 PM venue-local (manual builder), 2:00 AM ET on game day (pointspread engines), 15 minutes before kickoff (venue O/U engine), and the blanket 3-hours-before-kickoff from 2026-08-26 that had briefly covered daily wagers too. Applied in `auto-market-shared.ts` (`lockTimeDailyMetric` / `lockTimeBeforeKickoff`), both daily engines, and the manual builder's `computeLockTime`, so an operator-created wager gets the same rule. The venue timezone comes free from the forecast (Open-Meteo returns the IANA zone with `timezone=auto`), and the 6 AM lock keys off the venue's OWN game date, since a late Pacific start is already the next day in Eastern. If a venue timezone is not yet known the engine **skips** rather than falling back to the other rule, because a market with the wrong lock is worse than one that waits a tick. Existing markets migrate themselves, since the engines re-assert lockTime on every pass. Tests in `tests/wager-lock-rule.test.ts` cover both halves, the coast-to-coast spread, a DST boundary, and the venue-vs-Eastern game-date case.

- **2026-08-27**: **The 3-hour lock is now enforced on existing markets, not just new ones.** Surfaced by putting the tally time next to the close time on the same row: markets were closing 15 minutes before kickoff, not 3 hours. The 2026-08-26 change only applied to markets the engines CREATED after it; every engine's update path re-priced the line and left `lockTime` untouched, so the whole existing book kept its old convention. Measured live: **247 of 262** open pointspreads still locked at 2:00 AM ET, and **178 of 188** at-game-start markets still locked 15 minutes out. All three engines now correct `lockTime` alongside the price, so the book migrates itself within a tick or two. Safe by construction: both the new and the stored lock time are already known to be in the future at that point in the engine, so a correction can never reopen a closed market. **Operator note:** this also means a manual lock-time override on an auto-managed market is overwritten on the next tick. The rule is enforced now, not merely applied at creation. Tests in `tests/auto-market-lock-backfill.test.ts` assert all three engines do it, since a fix landing in one engine and not the others has happened here before.

- **2026-08-27**: **Every wager now shows when it is TALLIED, which is not when it closes.** Per Derek: "lock time isn't the same as the time we put on the wagers because the time we put on the wagers is when that wager is tallied." Two rules, both his: a **day-temp** wager (daily high or daily low) is tallied at **11:59 PM local time at the venue in the time zone with the earliest clock**, which across two venues means the western one, because a daily high is not final until that venue's day is over. Every **other** wager is tallied at **the game start time in Eastern**, which the auto-created 'at game start' markets already stored (their `location.timeZone` is deliberately ET, see `auto-market-shared.ts`). New `wager-tally-time.ts` derives it from the record, so all existing wagers gained the time with no data migration. Surfaced as `tallyTime` on the public view and shown on the markets table, wager cards, the market detail page (as **Tallied at**, with the lock row relabeled **Betting closes** so the two can no longer be confused), and each admin dashboard row. **Display only:** verified first that `nws-grading.ts` consults `targetTime` only for `actual_temp`, so a day-temp wager carrying a time cannot change how it settles. Tests in `tests/wager-tally-time.test.ts`.

- **2026-08-27**: **Satellite tab fixed: the frame time is now probed, not calculated.** Derek flagged the GIBS test failing. It was not flaky, it was correct: the tab was asking NASA for imagery that did not exist, and rendering blank when it guessed wrong. The old code assumed "now minus a fixed 40 minutes, floored to a 10-minute mark" is always a published frame. Measured live that day at 16:50Z, two separate things break that assumption: **publishing lag varies** (the newest frame of any kind was 50 minutes old, so the 40-minute guess 404ed), and **individual frames go missing** (15:50Z was absent while 15:40Z and 16:00Z were both fine). A fixed lag cannot survive either. The tab now walks candidate frames newest-first and asks GIBS which one it actually has, starting only 10 minutes back so it finds the **freshest** frame rather than a safely stale one. Probes are HEAD requests returning a zero-byte body, verified against the live service, which is what makes walking up to a dozen candidates affordable on a customer connection. The resolved time is cached for 5 minutes and shared between the imagery and its "as of" caption, so the map and the caption can never name different moments. A failed probe falls back to the old conservative guess rather than a blank map, and is deliberately not cached so the next render retries. Tests in `tests/gibs-satellite.test.ts` now cover the hole case, the offline case, and the cache with a stubbed fetch; the one live test asserts the property that actually matters (GIBS is serving *something* in our window) instead of that one guessed timestamp exists, which is why it used to fail for reasons no code change could fix.

- **2026-08-27**: **Locking split onto its own cron.** Per Derek. `/api/cron/lock-expired` (`20,50 * * * *`) now does the open-to-locked flip on its own, every 30 minutes. The flip already existed inside `/api/cron/grade-wagers`, but that cron runs once a day at 07:00 UTC and also grades and settles bets, so it could not simply be scheduled more often. Grading and settlement are untouched and still daily; the daily run still calls the flip as an idempotent safety net. `lockExpiredWagers()` was also rewritten to read the open book in one pipelined pass instead of one Redis round trip per wager, which was fine once a day but is over a thousand sequential round trips per tick at the new cadence. The new route is minute-slotted at `:20`/`:50` to avoid the four auto-market engines at `:00/:30`, `:05/:35`, `:10/:40` and `:15/:45`. Tests in `tests/lock-expired-cron.test.ts` assert the route imports nothing that grades, settles, or touches a wallet, and that its schedule does not collide, so it cannot quietly stop being safe to run this often.

- **2026-08-27**: **Incident: two live markets published at a 0.5 degree line, plus the Weatherboard closed-market carve-out.** Derek caught two NCAA football venue over/unders on the Wager Dashboard priced at **Line 0.5 degrees F** at -110 both ways, for a 2026-09-11 8pm kickoff. Anyone taking the over collects, every time. Neither had taken a bet. **Root cause:** Open-Meteo pads its hourly series out to the end of the last calendar day, past where the model actually has data, and those trailing hours return `null`. `Math.round(null)` is 0, so `auto-venue-ou-market.ts` read a confident "0 degrees at game start" and priced against it; `roundHalfPointAvoidingPush(0)` is 0.5, which is the exact line that shipped. The **daily** series has the same padding on its final day, so the HvL / HvH / LvL pointspread engines reading `highF` / `lowF` were exposed to the identical hazard at the 16-day horizon. **Fixed in three layers:** `open-meteo.ts` drops null-temperature hours and truncates the daily array at the first null day, so a padded hour can never enter a forecast; `getGameWindowForecast` drops non-finite points before interpolating, since `lerp(null, null)` was coercing to a clean, plausible 0 that sailed past every finite check; and `auto-venue-ou-market.ts` refuses to price a market off a non-finite temperature. With those in place the engines simply skip with "forecast does not reach game start yet," which is what should have happened all along. Tests: `tests/forecast-null-temps.test.ts`. **Also this date:** the Weatherboards now show a locked market as visible-but-closed (greyed, labeled `closed`, not linked) instead of dropping it, via `isClosedMarket()` and the new `BoardMarketLink.astro`. See [§8](#8-safety-governance--compliance).

- **2026-08-26**: **Expired markets are admin-only, and wagers are now organized by date and wager type.** Per Derek: "no one should be able to see expired wagers except the admin" and "we need to better organize all past, current, and future wagers by date as well as what type of wager." New `isPubliclyVisible()` predicate in `public-wager-view.ts` (status open AND lock time still in the future) is the single gate for every public surface: `/wagers`, `/api/wagers`, `/wagers/{id}`, `/wagers/game`, and `weatherboard-markets.ts`. `/api/wagers` dropped its `status` param, which previously served the entire graded book on request. `/wagers` was rebuilt from four status sections of cards into one sortable table with date / wager-type / metric filters and paging. The public list also **pages soonest-first now** (new `order: 'soonest'` on `listWagers`): the `wagers:by-status:open` index is scored by target date and was only ever read in reverse, so the board opened on games nine days out with tonight's slate a thousand rows deep, and the Today / Tomorrow filters matched nothing. The admin repricing scan keeps the old default order. On the admin side, `/admin/wagers` gained matching date, type, and metric filters plus a sort control, and now pages the full book through the new `listAllWagersPage()` instead of only ever seeing the 200 newest records. **Consequence worth knowing:** a game's Weatherboard market line now disappears once that market locks (3 hours before kickoff), where it used to stay visible through the game. Tests: `tests/public-wager-visibility.test.ts`.

- **2026-08-26**: **Auto-market lock time changed from "2am ET game day" / "15 min before kickoff" to a single rule: 3 hours before kickoff, for all 3 auto-managed engines.** Per Derek: "everything locks 3 hours before the start of the game." Replaces `auto-hvl-market.ts` and `auto-cross-venue-market.ts`'s old "2:00 AM ET on the game's calendar date" lock (the exact convention behind the 2026-08-25 same-day MLB cold-start bug documented below) and `auto-venue-ou-market.ts`'s old "15 minutes before kickoff" lock. New shared helper: `lockTimeBeforeKickoff(kickoffUTC)` in `auto-market-shared.ts`. An operator can still override any individual wager's lock time manually (Wager Dashboard). Tests added to `tests/auto-market-shared.test.ts`.

- **2026-08-25**: **Final piece of the HvH/LvL saga: MLB was never actually
  broken today. It was a one-day cold-start gap in the lock-time
  convention.** After the `NON_US_VENUE_IDS` fix (previous entry) shipped
  with zero NWS errors, Derek still reported "still nothing" on the live
  MLB Weatherboard. Checked Redis directly (`autohvh:game:mlb:{gamePk}` /
  `autolvl:game:mlb:{gamePk}`) for tonight's remaining pre-game MLB games:
  no mapping existed at all, meaning the code never even attempted
  creation for them. Root cause: both `auto-cross-venue-market.ts` and the
  original `auto-hvl-market.ts` lock a game's auto-market at **2:00 AM ET
  on the game's own calendar date** (`localTimeToUTC(gameDateStr, '02:00',
  ET)`). For NFL/NCAA-football/MLS this is harmless, since those games are
  always tracked days or weeks ahead of kickoff, so 2 AM on game day is
  still far in the future when the engine first sees them. MLB plays
  same-day, and HvH/LvL only started running today (this session), so by
  the time the (now-fixed) code got its first pass at *today's* remaining
  games, 2 AM ET on "today" had already passed hours earlier; every one
  of them arrived pre-expired. This is NOT a bug to patch, it's a
  one-time transitional gap that only affects the single calendar day a
  same-day-sport auto-market engine is launched on. Verified fully
  resolved for every day after: direct Redis lookups show real wager IDs
  mapped for every 2026-08-26 MLB game checked, and the live page
  (`/weatherboard/extended/mlb`, Wednesday 8/26) shows all three market
  types fully populated (28 HvH, 28 LvL, 28 HvL, one pair per game, both
  sides). Today's board will permanently show "-" for Degrees HvH/LvL on
  MLB; tomorrow onward is fully populated and stays that way going
  forward. Removed the temporary per-league timing `console.log`
  instrumentation from `runCrossVenuePricingPass` now that the cause is
  confirmed and no longer needed.

- **2026-08-25**: **The Toronto fix from earlier today was itself buggy,
  and it silently blacklisted most of MLB for a week.** After the venue-forecast
  batching fix (next entry down) made every run fast and error-free again,
  MLB's `Degrees HvH`/`Degrees LvL` were STILL completely empty, while
  dozens of real wagers kept appearing for NFL/NCAA-football/MLS. Checked
  the admin Wager Dashboard directly: **zero** HvH/LvL wagers existed for
  any MLB venue, full stop, not a display bug, a real creation gap.
  Root cause: the earlier Toronto fix (`18113ab`) inferred "this location
  can never work" from any creation failure whose error message matched
  `NWS points/stations API failed: 404`, and cached that verdict for a
  full week. That heuristic was right for Toronto but too broad: during
  the SAME chaotic debugging session, NWS was also returning 404s for
  ordinary US venues under whatever transient load/rate-limiting was
  happening at the time, and those got permanently (7-day TTL) blacklisted
  right alongside Toronto. MLB was hit hardest because its games were the
  ones being hammered hardest during the worst of the debugging.
  Fixed properly this time: replaced the error-message inference with a
  **hardcoded list of the 4 venues that are actually outside NWS's US-only
  coverage**, `NON_US_VENUE_IDS` in `auto-market-shared.ts` (Toronto Blue
  Jays' Rogers Centre, plus the 3 Canada-based MLS teams: Toronto FC,
  CF Montréal, Vancouver Whitecaps). This list can never be wrong about a
  working US venue no matter how NWS behaves on a given day, since it's checked
  BEFORE ever attempting the NWS call, so excluded games skip instantly
  with no network cost and no budget consumed. The old
  `PERMANENT_FAILURE_SENTINEL` mechanism is retired (renamed
  `LEGACY_UNSUPPORTED_SENTINEL`, nothing writes it anymore); any OLD bad
  entries still holding that value are now treated by `getMappedWagerId`
  as if no mapping exists at all, so every falsely-blacklisted game
  self-heals on its very next budget-permitting run instead of waiting out
  the week-long TTL. Regression-tested in
  `tests/auto-market-non-us-venue.test.ts`.
- **2026-08-25**: **Success was creating its own new bottleneck: batched
  the per-venue forecast fetch across all 4 auto-market engines.** After the
  Toronto fix (previous entry) started working (real HvH/LvL wagers
  confirmed created for NFL/NCAA-football games), a NEW slowdown appeared:
  one `lvl` run took 167 seconds just processing MLB's 150 games, then 105
  more seconds on NFL, before hitting the genuine 300s timeout partway
  through NCAA-football. Root cause: every engine's per-game loop called
  `getForecast()` for both the home and away venue **sequentially, one
  game at a time**, and as more wagers now exist to re-price (this is the
  "success" side effect), the SAME ~30 distinct MLB venues were being
  re-fetched over and over across many games, one full round-trip at a
  time, instead of once. Added `prefetchVenueForecasts()`
  (`auto-market-shared.ts`), which collects every distinct venue touched by a
  league's whole game list and fetches them all **concurrently** in one
  `Promise.all`, once, before the per-game loop starts; each game then
  reads its own venue's forecast from that already-fetched map instead of
  calling `getForecast()` itself. Wall-clock cost is now bounded by the
  slowest single venue fetch, not the sum of every game's fetch. Exactly
  mirrors the same "one fetch per unique venue" fix `league-schedule.ts`
  already uses for its own display-page enrichment. Applied to all 3
  wager-creating engines (`auto-hvl-market.ts`, which had ALSO hit a
  genuine 300s timeout from this same cause earlier in the day, not just
  HvH/LvL, plus `auto-cross-venue-market.ts` and `auto-venue-ou-market.ts`).
- **2026-08-25**: **Found the actual root cause of the HvH/LvL population
  failure: the Toronto Blue Jays.** Two prior fix attempts (a 500ms retry;
  making pointspread's two NWS lookups sequential instead of parallel)
  didn't help; the exact same 6 game IDs kept failing identically, run
  after run, with "NWS points API failed: 404". That determinism (not
  randomness) was the clue a real outage/rate-limit theory couldn't
  explain. Looked up the actual MLB gamePks via the MLB Stats API directly:
  **every single failing game involved the Toronto Blue Jays**. Their home
  park, Rogers Centre, is in Toronto, Canada, and NWS's `api.weather.gov`
  is a **US-only** government service that has never covered it (confirmed
  by curling the exact coordinates directly; Tampa/Detroit's coordinates
  return clean 200s, so this was never about rate limits or code correctness).
  MLS has the same exposure for its Canadian teams (Toronto FC, CF Montréal,
  Vancouver Whitecaps).
  The REAL bug this exposed: a failed creation attempt just let its
  short-lived claim expire, so every 30-minute tick re-discovered and
  re-attempted the SAME permanently-doomed Toronto game from scratch,
  burning the ENTIRE per-run creation budget (6) on games that could never
  succeed, leaving zero budget left for the ~140 other MLB games that
  would have worked fine. This is why Degrees HvH/LvL stayed at zero
  through every earlier fix: the budget was 100% consumed before ever
  reaching a viable game.
  Added a `PERMANENT_FAILURE_SENTINEL` (`auto-market-shared.ts`): when a
  brand-new creation fails specifically with an NWS "can't resolve this
  location at all" error (404 on points/stations, or no stations found),
  the game's mapping is set to this sentinel with a 7-day TTL instead of
  being left to expire; the next run recognizes it and skips instantly,
  without consuming budget or re-attempting the doomed NWS calls. Applied
  to all 3 engines that create new wagers (`auto-hvl-market.ts`,
  `auto-cross-venue-market.ts`, `auto-venue-ou-market.ts`). HvL itself had
  silently been wasting effort on Toronto the same way all along, just
  less visibly since its steady-state work is mostly cheap re-pricing. A
  re-price error on an *existing* wager is deliberately NOT treated as
  permanent (only a brand-new creation failure is), since that's a
  different, likely-transient class of problem.
- **2026-08-25**: **Added timing instrumentation, got real data, lowered
  the creation budget 12 to 6.** Live evidence (temporary `console.log`
  timing added to `auto-cross-venue-market.ts`) showed the picture is more
  intermittent than a single deterministic cause: one `hvh` run completed
  cleanly in 30.8s (created 3, updated 30, skipped 130); a different `hvl`
  run hit a genuine 300s timeout; a different `lvl` run died with **no
  timeout error and no exception** at just ~13.5 seconds elapsed. MLB's 9
  new wagers cost it ~12.9s (~1.4s per creation, confirmed almost the
  entire cost, since the other 141 MLB games' skip-checks were near-free), then
  it went silent right as NCAA-football's schedule fetch finished. That
  inconsistency (clean success sometimes, silent death at a fraction of
  the 300s budget other times) reads as contention with real site traffic
  sharing the same underlying Vercel function (this Astro deployment
  bundles every route, pages and API alike, into one shared function,
  confirmed via the runtime-error grouping tool showing both the ESPN-403
  errors from real page views AND the cron's own timeout under the same
  `routes=/_render` bucket), not a fixable logic bug in this code. Since
  creation cost dominates almost linearly, lowered
  `MAX_NEW_CREATIONS_PER_RUN` 12 to 6 to shrink worst-case exposure to
  whatever is cutting some runs short, rather than chase an exact number.
  Population will take a few more cron cycles to fully fill in as a
  result, an acceptable trade for reliability. HvL and Venue Degrees O/U
  confirmed solidly working throughout; only HvH/LvL were still
  intermittent as of this entry.
- **2026-08-25**: **Even 300s wasn't reliably enough for the FIRST-EVER
  population sweep of a brand-new auto-market, so added a per-run creation
  budget.** Live evidence after the 300s bump (previous entry): HvL and the
  venue O/U markets started populating fine, but HvH/LvL's very first tick
  still failed. Root cause: HvL's steady state is cheap because it's been
  running since 2026-08-23, so almost every game already has a mapped wager,
  and most of its work is a cheap re-price. HvH and LvL are brand new today,
  so their first-ever sweep has to CREATE a wager for every current game
  across all 4 leagues in one invocation, and creating a new wager costs 2
  real NWS station-resolution round trips per side, which at league scale
  is enough to blow past even 300s. Added `MAX_NEW_CREATIONS_PER_RUN` (12,
  `auto-market-shared.ts`'s `CreationBudget`): once a single invocation
  has created that many brand-new wagers, it stops creating more (existing
  wagers still all get cheaply re-priced) and picks up where it left off on
  the next tick, since a budget-skipped game's claim was never taken. Initial
  population now takes a few extra 5-30 min cron cycles instead of needing
  one impossible one; steady state afterward is unaffected. Applied to all
  4 engines (hvl/hvh/lvl/venueOU) for consistency, so a future season
  opener dropping many new games at once can't reproduce this.
- **2026-08-25**: **`getScheduleGames` lite mode wasn't quite enough either,
  so raised the platform function timeout from 60s to 300s.** After the
  `lite: true` fix (next entry down), the `hvh` engine still hit a hard
  "Task timed out after 60 seconds," confirmed via Vercel logs on the
  live post-fix deployment. Remaining cost: NFL/NCAA-football schedule
  fetches eat a real ESPN-403-then-Odds-API-fallback tax on every single
  call (a known, already-documented issue, see `league-schedule.ts`'s own
  comment on ESPN repeatedly 403ing our egress IP), and a first-ever pass
  creating many new HvH/LvL/venue-O/U wagers also pays a real NWS
  station-resolution network cost per brand-new location. Rather than
  chase every individual slow path, raised `astro.config.mjs`'s Vercel
  adapter `maxDuration` from 60 to 300 (this account's plan maximum on
  standard compute), a global change (Astro's Vercel adapter only
  supports one shared duration, not a per-route override), but strictly
  additive headroom for every route, not just this cron. 60 had been set
  deliberately for an unrelated Kalshi fetch; 300 still comfortably covers
  that case too.
- **2026-08-25**: **The real fix for the auto-market 504s: a pre-existing
  scalability problem in `getScheduleGames()` itself, not just cron
  bundling.** The staggered-cron split (previous entry) still 504'd on
  every single engine, including HvL alone. Vercel logs showed a hard
  60-second function timeout with `Open-Meteo API returned 429` errors
  buried inside `getScheduleGames`'s own internal per-venue forecast fetch.
  Checked further back: **37 straight 504s in the prior 24 hours**, all
  pre-dating today's HvH/LvL/venue-O/U work entirely. The original HvL
  engine had been failing most of the time all along; it just wasn't
  obvious because its occasional lucky success looked like "working."
  Root cause: `getScheduleGames(league, days)` with no `teamFilter` fetches
  full weather-narrative/WES/odds/live-roof-status enrichment for **every**
  game in the league on every call, the exact "no team filter, whole
  league" pattern a 2026-08-21 fix for venue pages had already identified
  as hammering Open-Meteo into 429s (see `teamFilter`'s own doc comment in
  `league-schedule.ts`). None of the 4 pricing engines use any of that
  enrichment; they only need `venue`/`awayVenue`/`kickoffUTC`/`state`/`id`,
  then fetch their own targeted per-venue forecast afterward. Added a
  `{ lite: true }` option that skips the entire enrichment path (forecast
  fetch, WES, weather narrative, odds/lines, live roof-status check,
  kickoff-snapshot writes) and returns bare game/venue/time data straight
  from the already-cheap schedule fetch; all 4 auto-market engines now pass
  it. Every other `getScheduleGames` caller (Weatherboard, venue pages,
  Wager Schedule) is unaffected; `lite` defaults to off. This is the
  second half of the fix for the timeout described in the entry
  immediately below: splitting the 4 engines into separate staggered cron
  invocations (`:00/:30`, `:05/:35`, `:10/:40`, `:15/:45`) was necessary but
  not sufficient on its own, since each engine standalone was still calling
  the same expensive enrichment path.
- **2026-08-25**: **Degrees HvH / LvL / Venue O/U never actually appeared,
  because the bundled cron was 504-timing-out.** Reported live: "Degrees HvH,
  Degrees LvL, Venue Degrees O/U in MLB aren't showing up" (HvL kept
  working fine). Root cause, confirmed via Vercel runtime logs: bundling
  all 4 engines into one `/api/cron/auto-hvl-pricing` invocation (the
  original fix, same day) meant one HTTP request now did 4 engines times
  4 leagues of sequential per-game network calls, roughly 4x a single
  engine's already-nontrivial runtime, and the function was hitting its
  execution timeout (three straight 504s in the logs) before HvH ever got
  a chance to create anything. HvL kept re-pricing normally because it ran
  first in the sequence and finished before the timeout; the other three
  never got far enough into their sweep to write a single wager, and
  because the function was killed rather than throwing, nothing showed up
  as an error anywhere. Fixed by giving each engine its own cron
  invocation, selected by a `?only=hvl|hvh|lvl|venueOU` query param, on its
  own staggered schedule (`:00/:30`, `:05/:35`, `:10/:40`, `:15/:45`, see
  `vercel.json`) so no single request ever does more than one engine's
  worth of I/O.
- **2026-08-25**: **Extended the automated-market exception from just HvL to
  all four Weatherboard Extended columns, and fixed a by-time grading gap
  found along the way.** Per Derek: "along with preloading Degrees HvL
  wagers, also 1. create a Degrees HvH wager for all games ... 2. create a
  LvL wager for all games ... 3. create two o/u wagers, one for each team,
  for Venue degrees o/u by taking the temp forecast at the time of first
  pitch at each venue." Added `auto-cross-venue-market.ts` (one parametrized
  engine for both HvH and LvL, since they differ only in which daily value
  both sides compare) and `auto-venue-ou-market.ts` (per-venue O/U at the
  exact kickoff instant, generalized to "game start" across all 4 leagues
  rather than baseball-only "first pitch," confirmed with Derek). Pulled
  the pure helpers all four engines share (rounding, ET date/time
  conversion, the Redis claim/dedup mechanism) into `auto-market-shared.ts`
  so a future fix can't land in one engine's copy and not another's; the
  original `auto-hvl-market.ts` was refactored to use the same shared code
  with zero behavior change (confirmed via its existing regression tests).
  All three new market types share the existing `/api/cron/auto-hvl-pricing`
  route (selected by `?only=`) rather than a new file, but each runs as its
  own cron invocation on its own staggered schedule, see the 2026-08-25
  entry above this one for why bundling them into one invocation didn't
  work in practice.
  While building the venue O/U markets, found that `actual_temp` (by-time)
  wagers never actually graded against the target time: `nws-grading.ts`'s
  `getObservedValue()` returned the day's overall high regardless, despite
  its own comment claiming otherwise, because `NWSObservation` never stored
  per-reading timestamps. Fixed by capturing each hourly reading's timestamp
  in `fetchNWSObservations` and matching to the wager's `targetTime`
  (`nws-grading-by-time.test.ts`); without this, "Over 82 at game start"
  could have lost to an unrelated afternoon peak with no connection to the
  advertised bet. Also widened `isTempMetric()` (weatherboard-markets.ts) to
  include `actual_temp` and gave `formatOverUnderMarket()` "Temp at Game
  Start" wording for it, so the new O/U markets actually render on the
  Weatherboard Extended column that was already built to show them.
- **2026-08-24** — **Market Design Lab warnings were a bare number with no
  explanation.** Reported live via screenshot from wager creation: "Warnings
  (1) / Significant side skew (18%) — implied probabilities lopsided." with
  no indication of *why* an 18% skew is a problem or what it means for the
  market. Rewrote every terse warning across `analyzeOverUnder` and
  `analyzePointspread` (side-skew, edge-band, spread-magnitude) and the
  multi-outcome checks in `analyzeOdds` (coverage gaps, long-shot
  concentration) in `wager-market-design.ts` to append a plain-language
  clause explaining the mechanism and the consequence — e.g. "lopsided"
  becomes "...instead of both sides sitting near an even 50/50 split, one
  side is priced as clearly more likely to happen, which makes the other
  side unattractive to bet and concentrates the book's payout risk." Pricing
  notes and self-explanatory warnings (missing title, invalid date, missing
  location) were left as-is. Regression-tested in
  `tests/wager-market-design.test.ts` against the exact reported scenario
  (line 91, +132/-159 over/under) plus edge and pointspread cases. Documented
  the Market Design Lab itself in §4 Step 5 — it had never been in this
  manual before.
- **2026-08-25** — **"It needs to be venue vs. venue not town vs. town" —
  extended the venue-name fix from the Weatherboard to every public wager
  surface.** Reported live against `/wagers/game?home=mlb-cws&away=mlb-tex`:
  a market titled "Arlington, TX High vs Chicago, IL Low — Wager on Weather"
  that's really at Globe Life Field vs. Rate Field — the 2026-08-24 venue-name
  fix only touched `weatherboard-markets.ts`'s formatters, not the underlying
  public wager view every other page reads. Root cause of why the fix didn't
  already cover this: a wager's `title`/location fields are plain strings set
  once at creation and never regenerated, so a wager created before the
  2026-08-24 convention (or any auto-managed wager the cron only ever
  re-prices, never renames) keeps its city/state name forever, and this
  particular ticket was locked besides — permanently un-touchable by the
  pricing engine. Fixed by extracting the coordinate-based venue lookup into
  a shared `findVenueByCoords()` (`venue-data.ts`), having
  `public-wager-view.ts`'s `describeLocation()` use it (fixes
  `locationSummary`, rules text, and outcome labels on `/wagers`,
  `/wagers/{id}`, `/wagers/game`, and ZIP pages' "Bet on {City} Weather"),
  and adding `wager-title.ts`'s `venueifyWagerTitle()` to patch the
  free-text `title` string for display by substituting a matched location's
  stored name with its venue's name wherever it appears literally — no
  stored record is mutated, so this self-heals every existing wager
  automatically. Regression-tested in `tests/wager-title.test.ts`.
- **2026-08-25** — **ZIP page 15-Day Forecast: only Today's WES badge had the
  full color/adjective/link treatment.** Reported live: "you only have the
  WES done properly for Today. They should all be color coded with the
  adjective and What is WES? Link." The forecast data was never the problem
  — `[...slug].astro`'s `dailyWes` already computes a real WES for all 15
  days — `DailyForecast.tsx` just only called `getWesBand()` (the
  score-to-color/label mapping) for day 0, so every other day rendered a
  plain amber (or red, if severe-capped) pill with the number and no label
  or "What's WES?" link. Removed the `i === 0` gate — every day now gets the
  identical band-colored badge, adjective line, and link that Today's row
  and the "Feels like" hero badge (`WeatherHero.tsx`) already had.
- **2026-08-24** — **`/wagers` cards and the market detail page were missing
  the temperature/line/spread number entirely.** Reported live: "you are
  missing the temperatures in the cards." Root cause: each outcome tile
  showed only its label ("Over"/"Under", or a location name) plus a big
  American-odds figure — the actual number a customer would be betting on
  (the over/under line, or the pointspread's per-side spread) lives on the
  wager as a whole, not per-outcome, and nothing ever pulled it onto the
  tile. Added `outcomeTarget()` to new `src/lib/public-wager-display.ts`
  (shared by `WagerCard.tsx` and `WagerDetailPage.tsx`) — every over/under
  tile now shows its line, every pointspread tile shows its side's signed
  spread. Range-odds tiles are unaffected (their range was already in the
  label). Regression-tested in `tests/public-wager-display.test.ts`.
- **2026-08-24** — **Two fixes from one report: NFL/NCAA Scores credit leak
  (again), and venue names in Weatherboard market text.**
  1. **Odds API "Scores" spend was still firing constantly for NFL and NCAA
     Football even though neither regular season had started** (only NFL
     preseason/MLB/MLS were live) — the 2026-08-23 gap-check fix didn't hold.
     Root cause: that check scanned the site's full lookahead window (up to
     60 days out for calendar navigation, 16 days for the auto-pricing cron),
     and the Odds API's free schedule endpoint lists a whole season months in
     advance — so before a season starts, essentially every future game
     looked "missing" from ESPN's near-term/off-season-empty scoreboard, not
     an actual outage. 400 credits burned on Scores alone in one 200-request
     rolling log window, 146 of them NCAA Football (zero games played).
     Fixed by only counting a missing game as a real gap once it has actually
     kicked off (`commenceTimeISO <= now`) — a future game has no live/final
     score to fetch anyway, so there was never anything to gain by paying for
     it. Extracted the gap check into a standalone `hasScoreGap()` (was
     inline) with `tests/odds-schedule-fallback.test.ts` regression coverage
     pinning the exact bug scenario. Documented in the `/admin/system/odds-usage`
     page's own explanation of the Scores fallback.
  2. **"You need the venues in there"** — Weatherboard/Extended market text
     named the city/state ("Atlanta, GA") instead of the actual venue
     ("Truist Park"), and didn't spell out the metric or matchup in full.
     `weatherboard-markets.ts`'s pointspread/over-under formatters now
     resolve the real venue name by coordinate match and read like
     **"Tropicana Field High Day Temp vs. Comerica Park Low Day Temp -34.5
     (-110)"** and **"Tropicana Field Low Day Temp 75: Over 75 (-175) /
     Under 75 (+155)"** — exact strings Derek specified, pinned in the new
     `tests/weatherboard-markets.test.ts`. Also switched the two venue-
     anchored wager-creation paths (auto-hvl-market.ts, Wager Schedule's
     prefills) to store the venue name directly going forward, rather than
     relying only on the display-layer fallback.
- **2026-08-24** — **Live Forecast panel added to the wager creation form.**
  Per Derek: show the forecast right in the form instead of only surfacing it
  indirectly through "Generate Suggested Lines/Spread." `WagerFormModal.tsx`
  now auto-fetches and displays the same consensus data the Suggest buttons
  use (over/under: mean + range + per-source breakdown; pointspread: both
  sides' consensus + expected A-minus-B diff) as soon as location(s)/metric/
  date are filled in — purely informational, never writes to any field.
- **2026-08-23** — **New "Weatherboard Extended" pages; plain Weatherboard
  simplified to one auto-priced market; new automated pricing cron.** Per
  Derek, reversing the same-day 3-column pointspread split below: the plain
  Weatherboard is customer-facing and was getting cluttered, so it now shows
  just ONE native-market column, "Wager on Weather - HvL" — always the
  warmer-forecast venue's daily high vs. the other venue's daily low,
  cross-venue only. The full 4-column detail (now labeled "Degrees HvH" /
  "Degrees LvL" / "Degrees HvL" / "Venue Degrees O/U", including same-venue
  High-vs-Low markets) moved to new sibling pages, **Weatherboard Extended**
  (`/weatherboard/extended` + `/mlb`, `/nfl`, `/college-football`, `/mls` —
  same 5-page shape as the plain board, no DraftKings odds anywhere on it).
  Clicking the plain board's HvL entry jumps to this same game on Extended;
  clicking any entry on Extended goes to new `/wagers/game?home=&away=&date=`
  — every published wager for that specific game, pointspread and O/U alike,
  so the customer sees the full menu before picking one to bet. Shared
  matching/categorization logic extracted to `weatherboard-markets.ts` so the
  two boards can't drift apart on what counts as "this game's" market.
  Second half of the request: the "Wager on Weather - HvL" market is now
  **fully automatic** — see §8's new safety-model exception and
  `auto-hvl-market.ts` — created and continuously re-priced by a 30-minute
  cron (`/api/cron/auto-hvl-pricing`) using a fixed formula (High forecast −
  Low forecast, rounded to the next half-point always favoring the Low/dog
  side, -110/-110 odds both sides), locking at 2 AM ET game day or earlier if
  an operator hits **Lock Now**. Added `tests/auto-hvl-market.test.ts` for the
  rounding rule; added regression coverage is pure-function only (no network).
- **2026-08-23** — **Weatherboard's single "Temperature Pointspread" column
  split into three.** Per Derek: a bettor comparing two daily highs shouldn't
  have to pick that market out of a cell mixed with cross-metric high-vs-low
  lines. `WeatherboardTable.astro` now buckets each published pointspread
  wager by its `metricA`/`metricB` pairing into "Degree Diff: High v High",
  "Degree Diff: Low v Low", and "Degree Diff: High v Low" (same-venue
  high-vs-low counts as the last one too), each rendered in its own column,
  still one row per team with a "—" when nothing's published in that bucket.
  No change to which markets are eligible to show (open/locked only) or how
  they're formatted — purely a column split.
- **2026-08-23** — **Observed values were rounded for display, making a few
  graded wagers look like they should have pushed when they hadn't.**
  Reported live: #VTJ36814 (over/under line 82, graded "over") appeared to
  need a push since the admin showed "NWS Observed: 82°F" — exactly the
  line. The real stored `observedValue` is 82.4°F; grading already used
  that full precision correctly. The display alone rounded it away,
  hiding the fraction that decided the outcome. Re-checked all 6 graded
  over/under wagers against their real observed values — every one grades
  correctly; this was display-only, no data was wrong. Removed the
  rounding everywhere an observed value is shown next to the line/spread
  it's compared against: the Wager Dashboard's pointspread cards (live
  odds view and the graded "Final" summary), the over/under "NWS
  Observed" line, and the public `PointspreadDisplay.tsx` customers see
  on `/wagers/{id}`.
- **2026-08-23** — **Suggest Line/Spread fixed; a wager-duplication race
  closed; Weatherboard markets now link to their bet page and split
  pointspread per team.** Four separate fixes from one round of live
  reports:
  1. **"Generate Suggested Spread"/"Generate Pricing Recommendation" always
     failed** with "No matching forecasts found." They only ever read the
     internal Forecast Tracker log (`/admin/forecasts`) — entries an
     operator manually records per exact location/metric/date — never the
     live weather pipeline every other page uses. Realistically never
     populated for a venue picked spontaneously off the Wager Schedule
     tool. `getConsensusOrLiveFallback` (bookmaker-pricing.ts) now falls
     back to a live single-point estimate via `getForecast()` when the
     tracker has nothing and coordinates are available. Also fixed:
     `suggestPointspread` was reading the shared `metric` for both sides on
     cross-metric spreads, ignoring metricA/metricB.
  2. **"It is making two copies of each wager I input."** Two
     live-monitored repro attempts each produced exactly one wager, so the
     server path is sound — but the Create Wager button's only guard was
     `disabled={saving}`, a React state update not visible synchronously, so
     a fast double-click could fire the handler twice before the button
     actually disabled. `handleSave` now also checks a plain ref
     synchronously as its first line, closing that race regardless of
     render timing.
  3. **Wager Schedule's pointspread picker never set a Spread value** — the
     field started empty and submitted as plain `0`, a guaranteed-unfair
     line whenever the two forecasts differ (confirmed live: a Braves @
     Brewers test wager saved with "Opening: Spread 0" despite a real
     +33/-33 forecast gap). Now defaults it the same way
     weather-market-idea-generator.ts's `balancedSpreadF` does — negate the
     favorite-minus-underdog forecast gap — still fully editable before
     saving.
  4. **Weatherboard markets had no way to actually bet them, and pointspread
     mixed both sides into one cell.** Every Temperature Pointspread /
     Temperature O/U at Venue entry is now a link to `/wagers/{id}` (the
     public market page). Pointspread now renders on each team's own row
     (matching how O/U-at-venue already worked) instead of one cell
     spanning both rows — a same-venue High-vs-Low pointspread still shows
     both sides together on that one row, since it's about a single team.
- **2026-08-23** — **Critical fix: pointspread grading had an inverted-sign
  bug — winners were backwards on close results.** Derek flagged 4
  already-graded tickets (#QMR35607, #RQX41246, #ZUF32418, #LBJ53608) as
  mis-scored by hand-checking the math. Root cause: `spread` is Location
  A's own line in favorite/underdog notation (see the new Glossary entry),
  but all three grading paths — the daily cron (`nws-grading.ts`), the
  manual Wager Resolution Center (`wager-resolution.ts`), and the
  "Auto-Grade from NWS" button (`wager-auto-grade.ts`) — compared the raw
  observed diff straight against `spread` with no sign adjustment. Wrong
  specifically on close, competitively-priced results — exactly what a
  spread exists to produce. Also fixed: `wager-auto-grade.ts` was reading
  the shared `metric` for both sides on cross-metric spreads, ignoring
  metricA/metricB; and `bookmaker-pricing.ts`'s "Suggest Spread" button
  emitted the opposite sign from the (already-correct) Weather Market
  Ideas generator, so a suggested line and the fixed grader would have
  disagreed. Added `tests/pointspread-grading.test.ts` as a permanent
  regression guard using the exact tickets Derek verified by hand.
  **Update, same day:** Derek asked to re-check every graded pointspread
  and correct any that were wrong. A full sweep of all 6 graded
  pointspread tickets against the fixed formula found exactly these same
  4 mismatches and no others — the other 2 (#ZFA71643, #VCS71553) were
  already correct. Corrected `winningOutcome` on all 4 via a direct data
  fix (re-grading through the app is deliberately disallowed on terminal
  records) with an audit-log entry on each; no bets/stakes existed on any
  of them, so no balances were touched.
- **2026-08-23** — **Odds API Usage: timestamps now show ET; cut a large,
  wasteful chunk of "Scores" spend.** Per Derek: (1) every timestamp on
  `/admin/system/odds-usage` (latest-usage caption, spend-log "Last
  request", recent-requests "When") now renders in US Eastern instead of
  raw UTC/browser-locale. (2) Bigger fix, found while investigating spend:
  the paid Odds API `/scores` fallback (NFL/NCAA Football/MLS only — 2
  credits per sport per check, distinct from the free `/events` endpoint)
  was firing on **every** schedule fetch regardless of whether ESPN's own
  free scoreboard already returned a complete slate — live usage log
  showed it firing every 1–6 minutes across 4 sport keys even with ESPN
  healthy, by far the largest spend driver (dwarfing the actual DraftKings
  lines fetches, which are already well-optimized at a 24h auto-interval).
  `getScheduleGames()` (league-schedule.ts) now only calls the paid
  `/scores` endpoint when the free `/events` check finds an actual gap —
  a game ESPN's response is missing — the genuine outage/gap scenario this
  fallback exists for. Normal operation (ESPN healthy) now spends zero
  credits on this path. Live-score freshness is unaffected: ESPN's own
  path already refreshes every 60 seconds (see the entry above).
- **2026-08-23** — **Fixed live scores/game state going stale for up to an
  hour on the Weatherboard and Wager Schedule.** Reported live: MLB games
  that started an hour earlier still showed pre-game "Warmup" with no
  score. Root cause: `mlb:schedule:range` (mlb-schedule.ts) and the
  per-league ESPN scoreboard cache (`schedule:league:*` in
  venue-schedule.ts, feeding NFL/NCAA Football/MLS) each carry one shared
  blob mixing the schedule (safe to cache long) with every game's live
  score/inning state — both were cached at a 1-hour TTL, so a game's live
  state could go the whole hour without refreshing. Both now use a
  60-second TTL, matching the live-score convention already used
  elsewhere (`SCORES_CACHE_TTL_SECONDS` in sportsbook-odds.ts). One
  shared fetch per league still keeps this cheap even refreshed every
  minute.
- **2026-08-23** — **Fixed Wager Schedule fragmenting a league into multiple
  sections on multi-league dates.** Reported live: Braves @ Brewers (7:10pm
  ET) looked missing from the day's schedule. It wasn't dropped — the old
  grouping only merged consecutive same-league games if adjacent in the
  globally kickoff-time-sorted list, so an MLS kickoff landing between two
  MLB games split MLB into a second, easy-to-miss single-game section far
  down the page. `WagerScheduleTable.tsx`'s `groupRows` now buckets every
  game by league first, then renders sections in a fixed order (MLB, NFL,
  NCAA Football, MLS & Soccer) with each league's games kept in time order
  within its own section — one block per league, regardless of what other
  leagues kick off in between.
- **2026-08-23** — **Weatherboard: two new native-market columns; Wager
  Schedule always uses a live forecast.** Per Derek: (1) `WeatherboardTable.astro`
  (shared by every `/weatherboard*` page) now shows two columns next to the
  DraftKings O/U — "Temperature Pointspread" and "Temperature O/U at Venue" —
  surfacing the site's own published (open/locked only) weather markets for
  that game/venue, matched by coordinate tolerance (~0.05°) against the
  wager's stored location. (2) `getForecast()` gained an `opts.skipCache`
  param, threaded through `getScheduleGames()`'s `opts.skipForecastCache`, so
  `getCombinedScheduleForDate()` (the Wager Schedule tool) always computes a
  fresh forecast instead of relying on the shared 10-minute Redis cache —
  appropriate there since an operator is about to lock a real wager's terms
  off that number; every other page (including the public Weatherboard)
  keeps using the shared cache, unaffected. (3) Verified, no code change
  needed: the "Wager on Weather" consensus blend (Open-Meteo + NWS + MET
  Norway) is still fully active post-rebrand, and wager terms already lock
  permanently at creation via `PricingSnapshot` + the manual-approval-only
  line-history system — a later forecast change never moves an existing
  wager's line.
- **2026-08-23** — **Wager Schedule: O/U High/Low buttons + a per-game
  Pointspread picker.** Per Derek: each team row now has separate **O/U
  High** and **O/U Low** buttons instead of one generic "Create Wager"
  (no more manually switching metric in the form). Each game also gets a
  **Pointspread** picker — two dropdowns (Favorite, Underdog) covering all
  4 of the game's high/low values (away high, away low, home high, home
  low), so you can quickly build e.g. "Tampa Bay high vs Tampa Bay low"
  (same-venue), "Tampa Bay high vs Baltimore low" (cross-venue,
  cross-metric), or any other pairing — **Create Pointspread Wager**
  pre-fills the form with both sides' location/lat-lon/metric via the
  same cross-metric pointspread prefill path the Weather Market Idea
  Generator's "Use this idea" link already used.
- **2026-08-23** — **New tool: Wager Schedule (`/admin/system/wager-schedule`);
  removed the Weather Market Ideas city cap.** Per Derek:
  1. New `/admin/system/wager-schedule` — an all-sports (MLB/NFL/NCAA
     Football/MLS) schedule for one date, with a calendar to look ahead:
     one row per team (not per game), with rotation number and Wager on
     Weather's daily high/low forecast at **that team's own home venue**
     (the away team's row shows their home city, not the game site —
     useful for cross-city comparisons right off the schedule). **Create
     Wager** on any row opens the wager form pre-filled with that team's
     venue and date. Reuses the same `getScheduleGames()` pipeline the
     public Weatherboard uses, so it can never disagree with it.
  2. Weather Market Ideas' expanded city universe is no longer capped at
     100/75 — every MLB, NFL, MLS, and college-football town (138 of them)
     not already in the hand-curated ~75-city set was added, derived
     programmatically from `venue-data.ts` so it can't drift out of sync.
     207 cities total as of this change.
- **2026-08-21** — **ZIP-page "What Is the Weather Like"/"What Should I
  Wear" card moved back to the bottom of the page; WES on ZIP pages
  restyled to match the Weatherboard's gold-pill badge; fixed the
  Fishing/Hunting solunar pills still being unreadable in light mode.**
  Per Derek:
  1. `WeatherOverview` (the "What Is the Weather Like in {city}?" / "What
     Should I Wear Today?" card) moved from directly above the Hero back
     down to the bottom of the page, right before the internal-links
     footer module — reverses the earlier "moved above the Hero" placement
     from a prior round.
  2. `WeatherHero.tsx`'s current-conditions WES display and
     `DailyForecast.tsx`'s per-day WES badges (15-Day Forecast) now use the
     same bordered-pill look as the Weatherboard's badge (`WES {n}` in a
     rounded-full border-2 pill, gold border normally, red when a severe
     weather cap is active) instead of plain text, each with the same
     "What's WES?" link to `/what-is-wes`. Verified live locally with a
     screenshot: "WES 93" now renders as a gold pill under "Feels like,"
     and the 15-day grid's daily badges match too.
  3. Reported again with a screenshot: the Fishing/Hunting Forecast's
     solunar "Best Times" pills were STILL unreadable in light mode after
     the light/dark text-token fix from a prior round. Root cause found:
     `isPassed` (an already-elapsed time window) stacked
     `opacity-50` on TOP of the already-correct light/dark text tokens —
     since these are translucent `/30`-tint badges, compounding a second
     50% opacity reduction pushed them back below legible contrast in
     light mode specifically. Fix: drop the opacity reduction, keep only
     `line-through` to indicate "already passed" (`FishingForecast.tsx`,
     `HuntingForecast.tsx`).
  **Operator impact:** none — public-page content/styling only.

- **2026-08-21** — **Fixed a league-scope bug on the dedicated Weatherboard
  pages' calendar date picker.** Reported live: picking August 29 from the
  NCAA Football Weatherboard's date input landed on the mixed-all-sports
  `/weatherboard/2026-08-29` page instead of staying scoped to college
  football. Cause: `LeagueWeatherboard.astro`'s date-jump script always
  navigated to `/weatherboard/{date}` regardless of which league page it
  was on. Fixed by keeping the SAME 5-page URL structure — no 6th page —
  and instead accepting an explicit `?date=YYYY-MM-DD` on each league page
  (`/weatherboard/nfl`, `/weatherboard/college-football`, etc.), which
  overrides the Today/Tomorrow tabs and bounds the fetch window the same
  way `/weatherboard/[date].astro` already does (60-day cap, "too far
  out"/"already passed" messaging). Verified live locally:
  `/weatherboard/college-football?date=2026-08-29` shows real Week 1 games
  (North Carolina Tar Heels, quarter-based weather write-up) without
  leaving the NCAA-football-scoped page. **Operator impact:** none.

- **2026-08-21** — **The Weatherboard is now exactly 5 pages with clean URLs;
  odds-usage admin page gained a spend log; fixed venue pages showing the
  live in-progress game under "Next Home Game" instead of "Next Game."**
  Per Derek's next round of feedback:
  1. **Weatherboard URLs**: the `?sport=nfl`-style query param is retired —
     each league now has its own dedicated page: `/weatherboard/nfl`,
     `/weatherboard/college-football` (NOT `ncaa-football` — that's the
     internal `SiteLeague` key, but the public URL segment is
     `college-football`, matching `/college-football-weather` elsewhere on
     the site), `/weatherboard/mlb`, `/weatherboard/mls`. Exactly 5
     Weatherboard pages total (those 4 plus bare `/weatherboard`) — the
     shared per-league body now lives in one component,
     `LeagueWeatherboard.astro`, instead of being duplicated across pages.
     Old `?sport=X` links 301 to the new URL (preserves `?day=tomorrow`).
     Updated every internal link that pointed at the old query-param URLs:
     the 4 retired `/nfl-schedule` etc. redirect stubs, and
     `venues/[league].astro`'s "on The Weatherboard" card.
  2. Bare `/weatherboard`'s intro paragraph replaced with a
     "Dedicated Weatherboards: MLB · NFL · NCAA Football · MLS & Soccer"
     link row (to the 4 pages above); the "See all NFL games — Today,
     Tomorrow & Calendar →"-style link under each league's panel is gone
     (redundant with the new top link row).
  3. **Spend log** on `/admin/system/odds-usage` (§6.6): every real
     (non-cached) Odds API request that spent credits is now logged
     (Redis list, rolling ~200 entries) with sport, endpoint (`odds` lines
     vs. `scores`), cost, and running remaining balance — not just the
     single "latest known usage" snapshot. Grouped summary table (total
     credits per sport+endpoint) plus an expandable raw recent-requests
     table. The free `/events` schedule endpoint is deliberately excluded
     (0 cost, would just be noise) — see `getOddsUsageLog`/
     `SPORT_KEY_LABELS` in `sportsbook-odds.ts`.
  4. **Venue-page bug fix**: reported live on `/venues/mlb-phi` — with a
     home doubleheader-adjacent series, "Next Game" was showing Saturday's
     future game while "Next Home Game" showed Friday's game that was
     ALREADY IN PROGRESS (mid-10th inning) — backwards from what makes
     sense. Root cause: the "always show two distinct cards" dedup fix
     from earlier this week rolled the wrong card forward. Now "Next Game"
     always stays the team's true earliest non-post game (live or not);
     when that's the same game as "Next Home Game" would be, it's "Next
     Home Game" that rolls forward to the following home game instead. The
     per-inning wind/gust/temp/precip panel and roof-status messaging
     under "Next Home Game" now follow that same rolled-forward game too
     (previously they stayed pinned to the original, no-longer-displayed
     game — a real, if less visible, inconsistency this fix also closes).
     Verified live locally on the Phillies page: "Next Game" now correctly
     shows the in-progress Friday game, "Next Home Game" shows Saturday.
  **Operator impact:** none for #1/#2/#4 (public-page changes only); #3 is
  a new read-only admin view, no config to touch.

- **2026-08-21** — **NFL/NCAA football games now model quarters (4 × 1
  hour) the way MLB models innings, and wind/glare descriptions are
  field-axis-relative.** Per Derek:
  1. "Think 4 hours long, 1 hour per quarter... quarters 1, 2, 3, 4 like we
     do with innings for baseball, but each is an hour." New
     `football-game-forecast.ts` (`getQuarterForecast`, `quarterAtMinutes`,
     `QUARTER_STEP_MINUTES=60`, `QUARTERS_PER_GAME=4`) reuses MLB's own
     interpolation machinery (`getGameWindowForecast`) — 4 samples at
     kickoff, +1h, +2h, +3h. New `buildFootballGameWeatherNarrative`
     (`game-weather-narrative.ts`) mirrors `buildMlbGameWeatherNarrative`'s
     structure with quarters instead of innings ("by quarter 3" instead of
     clock times) — wired into `league-schedule.ts` for `nfl`/
     `ncaa-football` specifically (MLS/soccer keeps the original generic
     3.5h/clock-time narrative — a football-specific ask, not "all
     non-MLB").
  2. "All stadiums run east to west except these run north to south:
     Oklahoma State, Georgia, Kentucky, Minnesota, East Carolina." New
     `football-stadium-orientation.ts` — `getFootballFieldAxis(venue)`
     returns `'north-south'` for that 5-team exceptions list, `'east-west'`
     for every other NFL/NCAA venue by default. Since (unlike MLB's
     surveyed `stadium-orientations.json`) we don't actually know which
     specific end zone/sideline faces which compass direction for any of
     these ~170 stadiums, wind/glare phrasing deliberately stays
     axis-relative — "blowing lengthwise down the field toward the E" /
     "blowing sideline to sideline (N crosswind)" / "blowing diagonally
     across the field toward the NE" for wind
     (`footballFieldWindLabel`), and "low sun down the length of the
     field... for players looking downfield" / "...along one sideline" for
     glare (`footballSunGlareLabel`) — never a specific named end zone.
     Applied in the football weather narrative above AND on venue pages'
     "Next Home Game" card (`[venue].astro`'s `buildImpacts`): the Wind
     factor note gets a "Field-relative: ..." sentence appended, and a new
     Glare factor appears when the sun is low at kickoff — both only for
     `nfl`/`ncaa-football` venues, computed from the single kickoff-instant
     snapshot that card already uses (not a full quarter-by-quarter scan).
  Verified live locally: the NFL Weatherboard shows real quarter-labeled,
  axis-relative write-ups ("wind ... blowing diagonally across the field
  toward the WNW ... Wind shifts from ... by quarter 4").
  **Operator impact:** none — public write-up content only.

- **2026-08-21** — **Venue-page game lists get weather write-ups instead of
  a Conditions/High-Low/Precip/Wind table; venue pages always show two game
  cards; schedule fallback switched to The Odds API's free /events endpoint
  (full season, not just ~3 weeks); "Current Weather" always paired with
  the date/time.** Per Derek's next round of feedback:
  1. `[venue].astro`'s "Next N Home Games" and "Next N Games" MLB tables
     (`mlbUpcomingGames`/`mlbNext10WithWeather`) drop their Conditions/
     High-Low/Precip/Wind columns for the same inning-by-inning weather
     write-up prose the Weatherboard shows (`buildMlbGameWeatherNarrative`,
     via a new `mlbWeatherWriteup` helper) — one column instead of four.
  2. Answered Derek's question ("doesn't the odds api have a calendar out
     for the season?") by testing The Odds API's separate `/events`
     endpoint: confirmed FREE (`x-requests-last: 0`) and covering the WHOLE
     known schedule (NCAA football all the way to the Nov 28 rivalry
     games, vs. `/odds` only reaching ~3 weeks out, since `/odds` only
     lists a game once a bookmaker has posted lines). Switched the
     schedule-fallback data source from `/odds` to `/events`:
     `sportsbook-odds.ts`'s `getOddsApiScheduleGames` (hit `/odds`) replaced
     by `getOddsApiEvents` (hits `/events`, 6h cache, NOT gated by manual
     odds-fetch mode since it's free and that gate exists to protect the
     metered endpoints) — also deliberately skips `recordUsage` so it can't
     overwrite the admin usage page's real, paid-request-cost snapshot with
     a 0-credit entry. `league-schedule.ts` and `venue-schedule.ts` updated
     to call it. Verified live locally: an Ohio State venue page (NCAA
     football, ESPN still 403'd) now shows a real Next Home Game
     (Ball State @ Ohio State, Sept 5) that wasn't available before.
  3. A venue page should always show two game cards up top. When a team's
     true next game and its next home game were the SAME game, the "Next
     Game" card used to just vanish (see the dedup fix from earlier this
     week) — now it's replaced with the literal game AFTER the one already
     shown (`mlbFollowingGameEntry`/`mlbFollowingGameOverall`), so there
     are still two distinct games shown. Verified live locally on the
     Yankees' page: an in-progress home game correctly showed as "Next
     Home Game" while the FOLLOWING day's game showed as "Next Game",
     instead of just one card.
  4. Every "Current Weather" link (Weatherboard-embedded cards, and now the
     two MLB game-list tables) sits at the bottom of the date/time cell,
     next to the kickoff time it applies to.
  5. Every weather write-up (Weatherboard, and now these two tables) ends
     with a "LIVE weather from {venue name}" link to that specific game's
     own venue page — not the ZIP-page "Current Weather" link, a separate
     link to a different destination.
  **Operator impact:** none — public-page content/data-source changes only.

- **2026-08-21** — **Generalized the NFL-only Odds-API schedule/score
  fallback to NCAA football and MLS too.** Per Derek: "get all of the
  sports up with what the odds api has." The NFL-specific fallback (added
  earlier the same day, when ESPN's football/nfl scoreboard started
  403-ing us) worked the same way for any ESPN-sourced league, so it's now
  shared:
  - `sportsbook-odds.ts`: `getNflGamesFromOddsApi`/`getNflScoresFromOddsApi`
    renamed to `getOddsApiScheduleGames(league)`/`getOddsApiScores(league)`,
    parameterized by `SPORT_KEYS[league]` instead of hardcoding
    `SPORT_KEYS.nfl`. Returns `[]` for a league with no Odds API key at all
    (NWSL — the-odds-api.com has no NWSL market, confirmed via its `/v4/sports`
    listing — so NWSL keeps no fallback, same limitation as before).
  - `league-schedule.ts`: `mergeNflOddsFallback` renamed to
    `mergeOddsScheduleFallback` — already took plain data, no NFL-specific
    logic inside, so the rename was the only change needed there. The
    single NFL-only `if` block in `getRawGames` now runs for every
    ESPN-sourced league (NFL, NCAA football, MLS), using a per-league
    team-name→venue map (`teamNameToVenueByLeague`, built once from
    venue-data.ts) instead of the NFL-only one.
  - `venue-schedule.ts`: `getNextHomeGame`'s odds fallback now checks a new
    `ESPN_PATH_TO_ODDS_LEAGUE` map (`football/nfl`→`nfl`,
    `football/college-football`→`ncaa-football`, `soccer/usa.1`→`mls`;
    `soccer/usa.nwsl` deliberately omitted, no Odds API key) instead of a
    single hardcoded `football/nfl` check.
  Test file renamed `tests/nfl-odds-schedule-fallback.test.ts` →
  `tests/odds-schedule-fallback.test.ts`, with a new MLS-flavored case
  added to confirm the merge logic is genuinely league-agnostic.
  **Operator impact:** none — same fetch-mode/interval controls apply to
  every league now, not just NFL.

- **2026-08-21** — **NFL odds-fallback games (see the entry below) now get
  real scores/state, not just schedule + odds.** Derek caught that the
  Odds-API-sourced fallback games (added when ESPN's scoreboard is 403'd)
  always showed no score and `state: 'pre'` on the Weatherboard, even for
  live/final games — the `/odds` endpoint we already used for lines never
  carries scores. Fix: `sportsbook-odds.ts` gained `getNflScoresFromOddsApi()`,
  which hits The Odds API's SEPARATE `/scores` endpoint (`daysFrom=3`,
  60s cache — much shorter than the odds list's multi-hour cache, since this
  is meant to track a LIVE game) for both NFL sport keys and returns
  `{homeTeam, awayTeam, homeScore, awayScore, completed}[]`.
  `mergeNflOddsFallback` (league-schedule.ts) now takes this list and derives
  each fallback game's real `state`/`statusDetail`/scores: `completed` →
  `post`/"Final"; scores present but not completed → `in`/"In Progress"; no
  scores yet → `pre` (unchanged). Also respects Manual odds-fetch mode (no
  automatic request when the admin has that set) like every other Odds API
  call. **Operator impact:** none — same fetch-mode/interval controls apply.
  See the same `tests/nfl-odds-schedule-fallback.test.ts` for coverage.

- **2026-08-21** — **New public "What Is WES?" explainer page; Weatherboard
  moves WES into the Weather cell; fixed an unreadable-in-light-mode bug on
  the Fishing/Hunting forecast cards.** Per Derek's feedback:
  1. New static page `/what-is-wes` (prerendered, no per-request data) —
     Derek's own plain-language explainer copy on how WES combines
     Environmental/Fan Feel/Player Feel into one 0-100 score. Linked as
     "What's WES?" under every public WES display: the Weatherboard's WES
     badge, the ZIP-page current-conditions WES line (`WeatherHero.tsx`),
     and once per ZIP page's 15-Day Forecast card (`DailyForecast.tsx` —
     one link near the card header rather than under all 15 daily badges,
     to avoid cluttering that dense a grid).
  2. `WeatherboardTable.astro`: moved the WES badge (+ Live tag) from the
     Time/ET cell into the Weather cell, with "Current Weather" now the
     last element at the bottom of that cell (weather write-up → WES badge
     → What's WES? → Current Weather, top to bottom). Time/ET cell is back
     to just kickoff time + status.
  3. Fixed a real light-mode contrast bug (reported live with a screenshot
     of the Fishing Forecast page): `FishingForecast.tsx` and
     `HuntingForecast.tsx`'s activity-rating badges (Excellent/Good/Fair/
     Poor) and solunar "Best Times" pills used a single light-only text
     shade (e.g. `text-emerald-100`, `text-sky-200`) with no light-mode
     variant — fine against a dark card, nearly invisible against the
     light-mode card background. Both now carry an explicit light shade
     plus a `dark:` shade (matching the existing `text-field-dark
     dark:text-field-light` convention already used in `Badge.astro`).
  **Operator impact:** none — public-page content and styling only.

- **2026-08-21** — **NFL schedule now falls back to The Odds API when ESPN's
  scoreboard is unavailable.** Follow-up to the same-day NFL-preseason-odds
  change, above — while verifying that change live, found the Weatherboard's
  NFL tab reading "No tracked NFL games today" despite real preseason games
  that night. Cause: ESPN was 403-ing our egress IP for `football/nfl`
  (the same recurring block already known to hit `college-football` and
  `usa.nwsl` — 546 occurrences / 247 users in the prior 24h, per Vercel
  runtime-error logs), and unlike MLB (which has its own MLB-Stats-API path,
  unaffected), the NFL section had no fallback — ESPN down meant the whole
  section went dark. We already fetch The Odds API's own NFL game list for
  lines, so it's now also used to fill in games ESPN's response is missing:
  - `sportsbook-odds.ts`: new `getNflGamesFromOddsApi()` — merges both NFL
    sport keys (regular + preseason), returns `{homeTeam, awayTeam,
    commenceTimeISO}[]`.
  - `league-schedule.ts` (`getRawGames`, the Weatherboard's data source):
    new exported pure `mergeNflOddsFallback()` fills in any Odds-API game
    ESPN's response is missing, deduped by team pair (ESPN's version always
    wins where both have the same game — it carries live score/state the
    Odds API doesn't) and matched to a tracked venue by team name.
  - `venue-schedule.ts` (`getNextHomeGame`, venue pages' "Next Game" card):
    new exported pure `pickNextHomeGameFromOdds()` does the same for one
    team's next home game.
  Coarser than ESPN (no live score/state — state is always "pre" from the
  fallback), but a real game with weather + WES + odds beats an empty
  section. **Operator impact:** none — this only ever activates when ESPN's
  own feed comes back empty for the window; no config to touch. See
  `tests/nfl-odds-schedule-fallback.test.ts` for the merge/selection logic.

- **2026-08-21** — **Added NFL preseason odds coverage.** Derek asked why
  preseason NFL wasn't showing on the odds side; investigation found the
  schedule already included preseason games automatically (ESPN's
  scoreboard mixes preseason and regular-season games in the same date-range
  response, so the Weatherboard/venue pages already showed them with
  weather and WES) — but odds never matched because The Odds API splits
  preseason into its own sport key, `americanfootball_nfl_preseason`,
  separate from the regular-season `americanfootball_nfl`, and
  `sportsbook-odds.ts` only ever queried the regular-season key.
  `SPORT_KEYS` now maps `nfl` to both keys; `getGameLines` fetches and
  merges both lists before matching (falls back gracefully if either fetch
  fails — only returns null if both do). "Fetch now → NFL" in
  `/admin/system/odds-usage` now triggers both keys (shown as two labeled
  rows in the result); worst-case daily credit estimate updated from 4 to 5
  tracked feeds. `/nfl-weather`'s week label now reads "Preseason Week N"
  instead of just "Week N" during preseason, so it isn't confused with the
  regular season. **Operator impact:** none — no new admin controls;
  existing odds fetch-mode/interval settings apply to the new key too.
  See `tests/sportsbook-odds.test.ts` for the merge-matching coverage.

- **2026-08-21** — **Fixed the two remaining performance causes: `getForecast`
  now Redis-cached, and venue pages stopped over-fetching.** Follow-up to
  the same-day HTTP-edge-caching fix (below) — this addresses what still
  made the FIRST visitor per cache window slow.
  1. `getForecast` (`weather-queries.ts`) had zero caching at any layer —
     every call (Open-Meteo/WeatherNext + consensus blend + observed floor)
     ran live from scratch, including duplicate calls for the SAME venue
     within one page render. Wrapped in a 10-minute Redis cache
     (`computeForecast` now holds the real work; `getForecast` is a thin
     cache-or-compute wrapper), keyed by rounded lat/lon + days + provider.
     Bulletproof — any Redis failure just falls through to a live fetch.
  2. Venue pages called `getScheduleGames('mlb', 7)` just to build the
     "Next Game"/"Next Home Game" cards, which fetched weather for every
     unique venue with ANY game in the next 7 days (~25 venues across the
     league) — confirmed hammering Open-Meteo into 429s and driving
     16-24s page loads. `getScheduleGames` gained an optional `teamFilter`
     param (narrows to that team's games *before* the per-venue weather
     fetch, so only ~1-3 relevant venues get touched); venue pages now
     pass `venue.team`. The Weatherboard genuinely needs every game and
     omits this param — unaffected.
  Verified locally: venue page cold-to-warm went from ~13s to ~0.9s (was
  16-24s in production before today's two fixes combined); ZIP page ~3.9s
  to ~0.5s; bare Weatherboard ~10s to ~1.2s (this page still touches every
  league's full slate by design, so it benefits from #1 but not #2).
  **Operator impact:** none — internal caching/data-fetching change only.
  Forecast data can now be up to 10 minutes stale across ALL pages/routes
  that share a location (not just within one page's own HTTP cache
  window) — a non-issue for weather at this site's freshness needs.

- **2026-08-21** — **Added HTTP edge caching to ZIP/venue/Weatherboard pages
  — the site was slow because these pages had ZERO caching at any layer.**
  Diagnosed after Derek reported the site loading slowly: repeated
  production curl timings showed ZIP pages at 7-9s and venue pages at
  16-24s TTFB, and Vercel runtime logs showed `cache=MISS` on every single
  request — including the same URL requested seconds apart — because
  `getForecast` has no Redis cache on the forecast result itself and none
  of these SSR pages set a `Cache-Control` header. Venue pages were
  additionally hammering Open-Meteo into 429 rate-limit errors, because
  `getScheduleGames('mlb', 7)` (called just to build two small "Next Game"
  cards) fetches weather for every unique venue with a game in the next 7
  days (~25 venues), not only the one venue the page is about.
  Fix (this round): `Astro.response.headers.set('Cache-Control', ...)` on
  `[...slug].astro` (ZIP pages, 5 min / 30 min stale-while-revalidate —
  weather doesn't need to be fresher than that), and on
  `venues/[venue].astro`, `weatherboard.astro`, and `weatherboard/[date]
  .astro` (1 min / 5 min — shorter because these can show a live
  in-progress score/inning). This exact pattern already existed on the
  `weather/[state]` and `weather/[state]/[city]` hub pages (900s/1800s) —
  it just hadn't been applied to the higher-traffic detail pages.
  **Not yet fixed:** the underlying over-fetch on venue pages (the
  ~25-venue `getScheduleGames` call) and the total lack of a Redis cache
  layer on `getForecast` itself — caching only means the FIRST visitor per
  cache window still pays the full slow cost; those are the next round if
  more relief is needed.
  **Operator impact:** none — response-header-only change, no data or
  workflow logic touched. Cached responses can be up to the TTL stale,
  which is a non-issue for weather and an acceptable tradeoff for live
  scores at this site's traffic level.

- **2026-08-21** — **WES generalized to ZIP pages; Weatherboard restructured
  to Today-only + per-league Today/Tomorrow/calendar; several public-page
  cleanups.** One large round, per Derek's numbered feedback:
  - **WES is no longer just a sports-event score.** `wes.ts` gained
    `computeWesNow` (current conditions) and `computeWesForDay` (one
    calendar day, sampled at local noon — falls back to the already-computed
    "now" score for Today specifically, since once noon has passed the
    hourly array no longer reaches back far enough to sample it) by
    extracting the shared scoring core (`computeWesFromSlots`) out of
    `computeGameWes`. ZIP pages (`[...slug].astro`) now show **"Weather
    Experience Score: N"** under "Feels like" in the hero (current), and a
    **"WES N"** line under each date in the 15-Day Forecast (predicted,
    updates as the forecast does).
  - **15-Day Forecast date format changed** from "08-22-2026" to a
    two-line "Friday" / "Aug. 22" (`DailyForecast.tsx`'s new
    `formatDayDate`, local to that component — the shared `formatDate`
    util is unchanged, still used by `TomorrowOutlook.tsx`).
  - **ZIP-page content reorganized:** the boilerplate H1 + two SEO
    paragraphs ("Hourly and 15-day weather forecast for...", "Whether
    you're planning...") are removed from the visible page (the sr-only
    `<h1>` for SEO structure is untouched). The "What Is the Weather Like
    / What Should I Wear" card (`WeatherOverview.astro`) moved from mid-page
    to directly above the Hero — now the first visible content block.
  - **Weatherboard restructured into a two-tier hub:** bare `/weatherboard`
    now shows **today's games only, across all four leagues**, each with a
    "See all {League} games — Today, Tomorrow & Calendar →" link (no more
    Today/Tomorrow/day-after tabs or date-picker on this page — that's one
    click away now). `/weatherboard?sport=mlb` (and nfl/ncaa-football/mls)
    now shows just **Today/Tomorrow tabs** (`&day=tomorrow`) plus the
    existing calendar date-picker for anything further out — it used to
    show that league's entire 7-14 day window in one table. `/weatherboard/
    [date]` (the calendar's destination, all leagues on one date) is
    unchanged. Old `/mlb-schedule` etc. 301 redirects still land correctly.
  - **WES badge (Weatherboard):** now a gold circular badge (was a plain
    rectangle) — red instead of gold specifically when a severe-weather cap
    is active, preserving that existing danger signal. A **"Live"** tag now
    appears next to it while `state === 'in'`; the score itself was already
    computed fresh on every load (never froze once a game started).
  - **New "Current / Weather" link** under every game's WES/time cell on
    the Weatherboard, linking to that venue's nearest ZIP page — shown
    regardless of whether the venue is domed (`getVenueZipUrl`, the same
    resolver venue pages already used for "Weather Now in {city}").
  - **Venue-page field cards:** removed the 🌡️/☔ emoji overlay from the
    Temperature/Precipitation "on the field" cards (`FieldMetricCard.astro`)
    — Wind/Gusts' arrow diagrams are unaffected.
  **Operator impact:** none of this is admin-facing — all public-page
  content/layout and the WES engine's public-facing scope. No workflow,
  wager, or grading logic touched.

- **2026-08-21** — **Precipitation chart redesigned: 7 real calendar days
  (3 actual + today + 3 forecast), not a rolling 48-hour window.** Per
  Derek: the chart now shows one bar per full calendar day (measured to
  local midnight) — the 3 days before today with ACTUAL, NWS station-
  observed totals (gray bars), then today + the next 3 days as forecast
  (blue bars, labeled "Today" in bold), which naturally keep adjusting as
  new forecast runs come in — no code change needed for that, it's just
  the existing live forecast pipeline. New `src/lib/precip-history.ts`
  (`getRecentObservedPrecip`) reuses the same NWS station-resolution cache
  as `forecast-observed-floor.ts`'s temperature floor (now exported:
  `resolveStation`) and sums each local day's `precipitationLastHour`
  readings, cached 30 days (a past day's total is immutable once fetched).
  Distinct from `historical-averages.ts` (20-year climatology, unrelated)
  and from `nws-grading.ts`'s wager-grading fetch (same NWS endpoint, but
  that one's local-day-boundary math only happens to work because Vercel
  functions run in UTC — this file does the explicit UTC-offset math
  instead, so it's correct regardless of where it runs).
  **Real-world caveat, not a bug:** not every NWS station has a working
  precip gauge — confirmed live that Columbia, SC 29205's nearest station
  (KCUB) reports `precipitationLastHour: null` on literally every
  observation, every day, while Charlotte, NC's station (KCLT) reports
  real numbers including genuine 0.00" dry days. A day is only shown as an
  "actual" bar when the station produced at least one real NUMBER that day
  (0 counts — dry hours legitimately report 0, not null); a day where the
  sensor never reported anything is omitted rather than shown as a false
  "0.00". So the number of actual-day bars that appear varies by location
  — that's honest behavior given real station data quality, not something
  to "fix" further.
  **Operator impact:** none — public-page chart redesign only.

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

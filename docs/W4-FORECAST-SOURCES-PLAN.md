# W4 plan: more forecast sources for the Wager on Weather consensus

Status: PLAN ONLY (Professor ruling WOW-013, 2026-11-14). No code, no provider signups, no
provider calls have been made for this plan. Every change it proposes needs its own ruling.

## 0. The goal, and what the code does today

Owner's goal, verbatim (2026-11-14): "our secret sauce at wageronweather.com is that we take an
average of the most accurate forecasts, but we could use more maybe? I like being 15 days out".

What the code does today (checked, file:line below):

- The public forecast averages **every source that answers**, with **equal weight**. Nothing
  selects or weights sources by accuracy (`averageOfPredictions`, src/lib/forecast-consensus-live.ts:124).
- Pricing uses a **different engine** with **fixed weights** (src/lib/forecast-consensus.ts:19-24).
- Past about day 8 the "average" is **one source** (Open-Meteo). See the coverage table in section 2.

So "most accurate" and "15-day consensus" are goals, not current facts. This plan is how to get
there honestly.

Standing rule: **Kalshi (or any market) prices never feed a forecast consensus.** A market price
is not a temperature forecast, and blending it into the number we price against would be circular.

## 1. Engine map

### 1a. Public engine: `applyConsensus` (equal weight)

- File: src/lib/forecast-consensus-live.ts. Entry `applyConsensus` (:133), called from
  `getForecast` in src/lib/weather-queries.ts.
- Base forecast: Open-Meteo (16 days requested, src/lib/open-meteo.ts:398 caps at 16), or NWS /
  OpenWeather when Open-Meteo refuses (base provider is never counted twice, :143-147).
- Daily high/low: equal-weight mean of base + NWS + AccuWeather (if keyed) + MET Norway +
  OpenWeather (if keyed), per date, for whichever returned a finite value (:176-221).
- Hourly temp and precip %: averaged with NWS hourly and MET hourly where they cover the hour (:225+).
- Each extra source has a 4 s timeout and is dropped on failure (:26, :36-41). Kill switch
  `CONSENSUS_FORECAST_ENABLED=false` (:29).

Consumers (everything that calls `getForecast`): public ZIP pages (src/pages/[...slug].astro),
venue pages, /college-football-weather, /nfl-weather, /mlb-weather, the Weatherboards and the game
weather feed (via src/lib/league-schedule.ts), /api/forecast, /api/map-grid, the market idea
generator, the Wager Schedule, game accuracy write-ups and WES snapshots, and **the auto-market
pricing engines** (src/lib/auto-market-shared.ts:260, background mode). The training manual's
2026-11-11 entry already states that HvL, HvH and venue O/U lines are priced off this forecast.
Also: `bookmaker-pricing.ts` uses it as a single-point fallback when the tracker has nothing
(:96-128, commented 2026-08-23).

### 1b. Pricing engine: `getConsensusForecast` (fixed weights, tracker-based)

- File: src/lib/forecast-consensus.ts. Reads Forecast Tracker entries (`listForecastEntries(500)`,
  :89), filters to location/metric/date/time, keeps the newest entry per normalized source (:101-108).
- `weightedMean` uses `CONSENSUS_WEIGHTS_V1` = nws 0.40, wageronweather 0.25, accuweather 0.20,
  weather.com 0.15 (:19-24), renormalized over the sources present (:124-138). Unrecognized
  sources get weight 0; if no recognized source is present it falls back to the plain mean (:139-141).
- `mean`, `median`, `min`, `max`, `stdDev` and `count` are computed over **all** sources,
  recognized or not (:116-120, :143-152).

- **Missing sources (WOW-015 item F5, code read).** AccuWeather and Weather.com have had no tracker
  entries since about 2026-09-07 (owner's Forecast Performance screenshot, 32 forecasts each) yet hold
  fixed weights 0.20 and 0.15. When they are absent, `getConsensusForecast` renormalizes over the
  recognized sources present (src/lib/forecast-consensus.ts:126-138; weight table :19-24, lookup
  `fixedWeightForSource` :26-28 returns 0 for any unlisted name). With only NWS and wageronweather
  present the effective weights are 0.40/0.65 = 61.5% NWS and 0.25/0.65 = 38.5% wageronweather.
  Open-Meteo raw and any other unlisted source carry weight 0 in `weightedMean` but still enter
  `stdDev` (sigma). A tracker entry with no source is counted as `wageronweather`
  (normalizeSource, src/lib/forecast-verification-v2.ts:51-55). This folds into P-SIGMA (§1d).

Consumers: src/lib/bookmaker-pricing.ts:140 (line and pointspread suggestions for
/admin/pricing-lab via src/pages/api/admin/line-suggestions.ts and pointspread-suggestions.ts;
pricing uses `weightedMean` as the centre and `stdDev` as sigma, :252-253, :292-293, :373-376);
src/lib/kalshi-signals.ts:145 (admin research); src/pages/api/admin/forecast-consensus.ts:37.

### 1c. FINDING (WOW-013 item 6): the public blend already reaches pricing through the tracker

- `normalizeSource` (src/lib/forecast-verification-v2.ts:51-55) returns the stored source string
  unchanged, so tracker entries tagged `wageronweather-consensus` stay `wageronweather-consensus`.
- That name is **not** in `CONSENSUS_WEIGHTS_V1`, so it gets weight 0 in `weightedMean`
  (the pricing centre) whenever a recognized source is also present.
- But it **is** counted in `stdDev` (the pricing sigma) and in `mean/median/min/max/count`, and it
  becomes part of the centre when no recognized source is present (plain-mean fallback).
- The daily tracker cron (`/api/cron/forecast-tracker-autolog`, 11:00 UTC) logs three sources per
  city: `wageronweather-consensus`, `wageronweather` (raw Open-Meteo) and `nws`
  (src/lib/forecast-tracker-autolog.ts:51, :171-243). For those cities the pricing centre is
  NWS 61.5% / raw Open-Meteo 38.5%, and the sigma includes the public blend.
- The code comments that introduced `wageronweather-consensus` (auto-pull.ts:221-230;
  forecast-tracker-types.ts:39-43) discuss only the accuracy leaderboard, not pricing. No
  ruling on this effect is recorded. **Reported as a finding; nothing changed.**
- Practical effect: the public blend usually sits between NWS and Open-Meteo, so including it
  can shrink sigma by up to about 29% (d/2 vs d/√2 when the blend sits midway between NWS and
  Open-Meteo); the MIN_STD_DEV = 1.0 floor (bookmaker-pricing.ts:57) may bind first. A smaller
  sigma makes prices more confident. Size NOT ESTABLISHED (needs tracker data).

### 1d. Pricing-sigma calibration (WOW-014, OPEN MEDIUM)

- Operator-driven pricing uses sigma = max(between-source SD, 1.0 °F) (bookmaker-pricing.ts:57,
  :253, :293). That measures **disagreement among sources**, not **forecast error**; model spread
  is known to under-disperse relative to actual error.
- The only accuracy figure on record, a 2.57 °F blend MAE (training manual, 2026-11-11 entry),
  implies an error SD of about 2.57 / 0.80 ≈ 3.2 °F if errors are roughly normal. This is an
  inference: the sample behind that figure is unrecorded.
- `LIVE_FALLBACK_STD_DEV = 3` (bookmaker-pricing.ts:75) is inconsistent with the 1.0 floor.
- Until this is fixed it is a **real-money blocker**: a 1 °F sigma, which probably binds often when
  two sources agree, makes suggested prices far too confident. Practice-only today.
- Proposed fix: a future money-logic slice "P-SIGMA" that derives sigma from **empirical tracker
  error by lead-day bucket**, not from model spread. It needs tracker evidence first, then a frozen
  spec, a Professor ruling and a fresh-context review.

### 1e. What the auto-market engines use for uncertainty (WOW-014 item 3c)

Read-only reading of src/lib/auto-market-shared.ts, auto-hvl-market.ts,
auto-cross-venue-market.ts and auto-venue-ou-market.ts:

- **No sigma at all.** The auto engines set a line from the public blend's point forecast and fix
  the odds; there is no probability model, spread-based uncertainty or floor.
  - Odds: `FIXED_ODDS = -110` on both sides for every auto market (auto-market-shared.ts:32-36;
    the comment says bookmaker-pricing.ts's suggest functions are not used by these engines).
  - HvL (auto-hvl-market.ts:141, :203-205): spread = −roundHalfPointFavoringDog(high − low), from
    `findDailyValue` daily highs/lows (auto-market-shared.ts:162-168) of forecasts fetched by
    `prefetchVenueForecasts` (auto-market-shared.ts:240) through `getForecast` (:260, background mode).
  - HvH / LvL (auto-cross-venue-market.ts:162, :225-226): spread = −roundHalfPointFavoringDog of the
    difference of the two venues' daily values, same forecast path.
  - Venue O/U (auto-venue-ou-market.ts:154): line = roundHalfPointAvoidingPush(slot.tempF), the
    kickoff-hour sample from `getGameWindowForecast`, same forecast path.
- **No tracker or pricing-engine dependency.** None of the four files imports `getConsensusForecast`,
  forecast-consensus.ts or any forecast-tracker module (imports: weather-queries, wager-store,
  league-schedule, mlb-game-forecast, auto-market-line-audit, alerts, redis). So the
  `wageronweather-consensus` tracker entry (1c) does **not** reach the auto engines; they price
  directly off the public blend (1a).
- Consequence: the auto markets' risk comes from the **point** forecast's bias and error, not from a
  mis-set sigma. Their accuracy is the public blend's accuracy at each lead day (sections 2-3).

## 2. Current source inventory

| Source | Key needed | Horizon delivered (daily hi/lo) | Hourly | Timeout / fallback | Health row |
|---|---|---|---|---|---|
| Open-Meteo (base) | No | 16 days requested (open-meteo.ts:398) | yes, full | base; on refusal NWS backup, then OpenWeather, then last real forecast | `open-meteo`, `nws-backup` |
| NWS | No | about 7 days (day/night periods) | about 6.5 days | 4 s, dropped on failure; US only | `nws` |
| MET Norway | No (descriptive User-Agent required) | about 9 days ("the next nine days", api.met.no docs) | yes, coarsening after ~2.5 days | 4 s, dropped; 30-min in-memory cache (metno-client.ts:25) | **none** |
| AccuWeather | Yes (`ACCUWEATHER_API_KEY`) | 5 days (5day endpoint, accuweather-client.ts:75) | no | 4 s, dropped; 3 h cache | **none** |
| OpenWeather | Yes (`OPENWEATHER_API_KEY`) | about 5 days (3-hourly, free tier) | no (in blend) | 4 s, dropped | `openweather` |

Whether the AccuWeather and OpenWeather keys are set in production: NOT ESTABLISHED (env values
are not visible from this machine). `weather.com` appears only as a manually entered tracker source
(no API; forecast-tracker-types.ts:43).

Coverage: how many sources vote in the public daily high/low, by lead day.

| Lead day | 0-4 | 5-6 | 7 | 8 | 9-15 |
|---|---|---|---|---|---|
| Sources (keyless) | 3 (OM, NWS, MET) | 3 | 2-3 (NWS edge) | 2 (OM, MET) | **1 (OM)** |
| + if both keys set | 5 | 3 | 2-3 | 2 | **1** |

Hourly is thinner still: NWS hourly ends around day 6.5 and MET hourly coarsens early.
So days 9-15 are Open-Meteo alone. (Open-Meteo is itself a blend of models, but in our consensus it
is one vote.)

Terms and quota (current sources):

- Open-Meteo free API: 600/min, 5,000/hour, 10,000/day, 300,000/month, **non-commercial only**
  (https://open-meteo.com/en/pricing). Commercial plans: Standard 1M calls/month, Professional 5M,
  Enterprise 50M+, fixed monthly price (not listed). The site has been running over the free daily
  quota (WOW-004).
- MET Norway: free, no key; must send an identifying User-Agent; identical requests should not be
  repeated more often than every 30 min (Nordic) or **3 hours elsewhere**
  (https://api.met.no/weatherapi/locationforecast/2.0/documentation). Note: the 30-minute cache
  (metno-client.ts:25) is shorter than the 3-hour guidance for US points. Record only; no change here.
- NWS: public domain, no key.
- AccuWeather / OpenWeather: per their plans; free tiers are 5-day.

## 3. Accuracy evidence

**NOT ESTABLISHED.** The Forecast Tracker data lives in production Redis, which this plan may not
read, and the admin pages require a login this plan may not use.

What to ask the owner for (export or screenshots of /admin/forecast-performance):

- per source (wageronweather-consensus, wageronweather raw, nws, accuweather, weather.com, any other)
  and per lead-day bucket (0-1, 2-3, 4-7, 8-10, 11-15 days): MAE, bias (mean signed error),
  n verified, **number of distinct target dates**, **number of distinct locations**;
- paired comparisons only on identical (location, date, metric) cases;
- the date range covered.

Rule: any source × bucket cell with **fewer than 30 distinct target dates** is INSUFFICIENT
EVIDENCE and may not be used to rank sources or set weights.

Only number on record: the training manual (2026-09-11 entry, quoted in
forecast-consensus-live.ts:118-121) says the previous NWS-weighted blend had 2.57°F MAE vs NWS
alone at 2.77. Sample size and lead days for that figure are not recorded here.

### 3a. REPORTED: owner screenshot of /admin/forecast-performance (2026-11-14, 11:14 ET)

Filters: Last 3 months (shown as 08-20-2026 to 11-17-2026, vs 05-22-2026 to 08-19-2026), interval
Auto (week), all 51 locations, all lead times, all measures (temp at time, high, low, wind gust,
wind speed) mixed. Headline: MAE 3.13, "accuracy score" 96.9, bias 0.42, 6,044 forecasts.

| Source | Forecasts | Verified | Accuracy | MAE | Bias |
|---|---|---|---|---|---|
| NWS | 2,118 | 2,006 | 97.1 | 2.97 | −0.36 |
| Wager on Weather (blend) | 2,118 | 2,006 | 97.3 | 2.73 | +0.07 |
| Open-Meteo (raw) | 2,080 | 1,968 | 96.4 | 3.69 | +1.56 |
| Weather.com | 32 | 32 | 96.4 | 2.91 | +0.53 |
| AccuWeather | 32 | 32 | 95.5 | 3.38 | +0.63 |

Caveats (WOW-015):
- Units and lead times are mixed (°F with mph; same-day with 10-day forecasts). The page itself warns.
- The "accuracy score" is not defined on the page; do not use it to rank.
- Distinct target dates and distinct locations per source are not shown, so the §3 rule
  (≥30 distinct dates per cell) cannot be checked. Weather.com and AccuWeather (n = 32, lines end
  about 09-07) are INSUFFICIENT EVIDENCE.
- The range end 11-17-2026 is three days after the screenshot date: a display defect (backlog).
- The 3-month blend line mostly predates 66e6914 (2026-11-11, equal-weight switch). Inference: an
  equal NWS/Open-Meteo mix would show bias ≈ +0.60, but the blend shows +0.07; solving
  1.56 − 1.92w = 0.07 gives NWS weight w ≈ 0.78, which fits the old NWS-weighted blend. Suggestive,
  not established (mixed measures, unequal case sets).
- Open-Meteo's +1.56 bias is a large share of its error (bias² ≈ 2.4 °F²); bias correction (§6.5)
  may recover it more cheaply than excluding it.

### 3b. First W4 measurement: before/after the 11-11 equal-weight switch

Compare the public blend before and after 66e6914 (2026-11-11) on the same measure (daily high °F),
the same lead bucket and the same locations, paired cases only, with a date-block bootstrap. Until
this is done it is **NOT ESTABLISHED** whether the equal-weight switch helped or hurt; the bias
arithmetic in §3a suggests it may have made the public blend warmer. The public blend also feeds the
auto engines' point lines (§1e), so this comes first.

## 4. The math of adding a source

If n sources have forecast errors with common variance σ² and average pairwise correlation ρ,
the error variance of their equal-weight mean is

  Var(mean error) = σ² × (ρ + (1 − ρ) / n).

What follows:

- Adding sources helps only through the (1 − ρ)/n term. If errors are highly correlated (ρ near 1),
  the mean is barely better than one source.
- **Repackaged models count close to once.** Many commercial APIs serve GFS, ECMWF or a blend of
  them. Adding a GFS-based API next to a source that already uses GFS adds little.
- **A clearly worse source can make the blend worse** under equal weights, because it gets the
  same vote as better ones. Accuracy-based weighting (inverse MSE, with shrinkage toward equal
  weights while samples are small) avoids this but needs the section 3 evidence first.
- ρ can be estimated from paired tracker errors on identical cases. Today: NOT ESTABLISHED.
- Effect on pricing: a new source only moves the pricing **centre** if it is added to
  `CONSENSUS_WEIGHTS_V1`; it moves the pricing **sigma** as soon as it is logged in the tracker for
  a priced location (finding 1c). Sources that agree closely shrink sigma (more confident prices);
  sources that disagree widen it. Either change is money logic.

## 5. Candidates that reach 15 days

Verified from the providers' own pages where a URL is given; anything else is marked unverified.

| Candidate | Horizon | Format | Cost / quota | Commercial use | Upstream model (correlation) |
|---|---|---|---|---|---|
| **ECMWF open data, IFS** | 15 days (00z/12z runs; 3-hourly to 144 h, then 6-hourly) | GRIB2 | free; portal limited to 500-2000 simultaneous connections, cloud mirrors available | **Allowed**, CC-BY-4.0, attribution required; direct delivery may carry service charges | ECMWF IFS (also underlies MET Norway, partly Open-Meteo) |
| **ECMWF open data, AIFS Single** | 15 days, 6-hourly, 4 runs/day | GRIB2 | free | Allowed, CC-BY-4.0 + attribution | ECMWF machine-learning model (new lineage) |
| **NOAA GFS via NOMADS** | 16 days (384 h) per NCEP inventory (unverified in this pass) | GRIB2 (grib_filter subsetting) | free, per-IP throttling | Public domain (US government data) | GFS (likely already inside Open-Meteo's blend) |
| **NOAA GEFS** | about 16 days (384 h) per archived NCEI listing (unverified) | GRIB2 | free | Public domain | GFS ensemble (gives a spread, useful for sigma) |
| **Open-Meteo, other models / commercial plan** | up to 16 days | JSON | commercial plan needed for commercial use | Commercial plan only | same models we already use; adds little independence |
| **Visual Crossing** | 15-day forecast; one 15-day location forecast = 1 record | JSON | 1,000 free records/day; $0.0001 per extra record | Its docs say commercial use is allowed; full license text not checked | mixed / proprietary blend (unverified) |
| **Weatherbit** | 16-day daily on paid tiers; free tier 7 days, 50 requests/day | JSON | paid for 16 days | not verified | proprietary blend (unverified) |
| **Tomorrow.io** | free tier about 4.5 days; up to 14 days on premium (support article) | JSON | free 500/day, 25/hour | not verified | proprietary |
| **Pirate Weather** | daily length not stated on docs page | JSON | 10,000 calls/month free | not verified | NOAA models (GFS, HRRR, NBM) |

Leading candidates for days 9-15, in order:

1. **ECMWF AIFS / IFS open data.** Free, 15 days, commercial use allowed with attribution, and a
   genuinely independent model family at long lead (AIFS especially). Cost is engineering: GRIB
   decoding and a pre-computed per-venue/per-city cache job (no per-request calls).
2. **NOAA GEFS / GFS.** Free and public domain, 16 days. Likely correlated with what Open-Meteo
   already blends, so a smaller accuracy gain, but GEFS gives a real ensemble spread that could
   replace guesswork in pricing sigma.
3. **Visual Crossing** as a JSON option if GRIB processing is not wanted: 15 days, cheap, commercial
   use stated as allowed. Upstream model and license text must be verified first.

Sources:
- ECMWF open data: https://www.ecmwf.int/en/forecasts/datasets/open-data
- ECMWF AIFS: https://www.ecmwf.int/en/forecasts/datasets/aifs-machine-learning-data
- Open-Meteo pricing: https://open-meteo.com/en/pricing
- MET Norway Locationforecast: https://api.met.no/weatherapi/locationforecast/2.0/documentation
- NOAA NOMADS: https://nomads.ncep.noaa.gov and https://www.nco.ncep.noaa.gov/pmb/products/gfs/nomads/
- Visual Crossing pricing: https://www.visualcrossing.com/weather-data-pricing/ and
  https://www.visualcrossing.com/resources/blog/how-do-i-get-free-weather-api-access/
- Weatherbit pricing: https://www.weatherbit.io/pricing
- Tomorrow.io: https://support.tomorrow.io/hc/en-us/articles/20273728362644-Free-API-Plan-Rate-Limits
  and https://support.tomorrow.io/hc/en-us/articles/38449008659220-Weather-Timeline-Historical-and-Forecast-Coverage
- Pirate Weather: https://docs.pirateweather.net/en/latest/ and https://pirateweather.net/

## 6. Shadow-first adoption rule

1. A new source is first written **to the Forecast Tracker only**, under its own source name,
   **outside both blends** and outside `CONSENSUS_WEIGHTS_V1`. Because of finding 1c, logging it for a
   priced location already affects pricing sigma; so the shadow period either uses a source name the
   pricing engine excludes from sigma (needs a ruling) or logs only for non-priced locations.
2. Shadow period: at least **45 days**, and long enough that every lead-day bucket it claims has
   **at least 30 distinct target dates** across several locations.
3. It enters the **public** blend only after a paired comparison on held-out dates shows the blend's
   MAE improves, bucket by bucket, with the improvement larger than its uncertainty. Uncertainty by
   a date-block bootstrap (resample whole target dates); distinct target dates, not rows, are the
   sample size.
4. It enters the **pricing** engine (weights or sigma) only with a Professor ruling and a
   fresh-context review: that is money logic.
5. **Scoring (WOW-015).** Shadow scoring reports MAE **and** mean bias (signed error) **and** RMSE
   for each source × lead bucket, for a single measure at a time (daily high °F first) and a pinned
   lead bucket. Paired cases only (identical location, date, metric). Uncertainty by date-block
   bootstrap. A source is never ranked on MAE alone: in an equal-weight average a biased source pulls
   the blend even when its MAE looks acceptable.

### 6.5 Bias correction as an alternative to exclusion

A per-source, per-lead-bucket rolling bias correction is evaluated in shadow alongside the raw
sources. The correction for a scored date is estimated **only from dates before it** (out-of-sample;
never from the date being scored or later). Report raw and corrected MAE/bias/RMSE side by side.
A corrected source enters any blend only through the same §6 rules 3-4; reaching pricing is money
logic.

## 7. Load

- All new forecast reads use background mode (`maxAgeSeconds = BACKGROUND_FORECAST_MAX_AGE_SECONDS`,
  3 h) wherever a 3-hour-old forecast is acceptable. WOW-004 showed that a single full-league
  cold fetch at 10-minute freshness cost about 30 refused Open-Meteo calls.
- GRIB sources (ECMWF, NOAA) should be fetched by **one scheduled job per model run** that extracts
  the site's venues and cities into a cache, never per page view.
- Budget per source per day must be written down before any build: calls/day vs the provider quota,
  with a health row (`data-source-health.ts`) for each new source.
- MET Norway's cache should follow its 3-hour guidance for non-Nordic points (noted in section 2).

## 8. Honest copy by lead day

Current public copy: footer "Hourly and 15-day forecasts" and "Forecasts on this site are produced by
Wager on Weather and cover the next 15 days" (src/components/layout/Footer.astro:13, :50); home title
"Weather Forecast by ZIP Code — 41,000+ US ZIP Pages, Hourly & 15-Day".

What can truthfully be said today:

- Days 0-8: "a consensus of several forecast models" (2-5 sources depending on day and keys).
- Days 9-15: "an extended outlook from a single global model blend" (Open-Meteo), until a second
  15-day source is live.
- "Most accurate": not until section 3 evidence exists and the blend is weighted or filtered by it.

Any public copy change waits for the Search Console baseline (WOW-007/010) and its own ruling.

Known honest-copy item (WOW-015, seen in the owner's 2026-11-14 screenshots): the public footer's
"cover the next 15 days" is unqualified. No change now.

## 9. Owner decisions (owner-reserved)

1. Any paid plan (Open-Meteo commercial, Visual Crossing, Weatherbit, Tomorrow.io, others).
2. Any new API key or environment variable (rule 9).
3. The Open-Meteo commercial-use question (owner question 9): the free tier is non-commercial only.
4. The wording "most accurate" and "15-day consensus" in public copy.
5. Whether to invest engineering time in GRIB processing (ECMWF, NOAA) versus a paid JSON API.
6. Whether to accept accuracy-based weighting for the public blend once evidence supports it.

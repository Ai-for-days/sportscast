# WagerOnWeather Data Sources Reference

> **Last Updated:** 2026-10-17  
> **Maintainer:** Claude Code  
> **Status:** Complete inventory of all external data sources, APIs, and integrations

This document is the single source of truth for every external data source feeding WagerOnWeather, including providers, endpoints, rate limits, fallbacks, and health monitoring.

---

## 📊 Weather & Forecast Data

### 1. **Open-Meteo** (Primary Weather Provider)
- **Purpose:** Base weather forecasts, current conditions, hourly forecasts, 15-day extended forecasts
- **Endpoints:**
  - `https://api.open-meteo.com/v1/forecast` — hourly/daily forecasts
  - `https://api.open-meteo.com/v1/archive` — historical weather
  - `https://previous-runs-api.open-meteo.com/v1/archive` — forecast model runs (for historical comparison)
  - `https://air-quality-api.open-meteo.com/v1/air_quality` — air quality index data
- **Rate Limit:** ~10,000 calls/day (shared across all callers)
- **Cost:** Free tier; billed tier available
- **Fallback:** Cached values (up to 3 hours old); kills forecast blend if unavailable
- **Health Monitoring:** `recordSourceSuccess/Failure` in `data-source-health.ts`
- **Key Files:**
  - `src/lib/weather-queries.ts` — main query handler
  - `src/lib/open-meteo.ts` — API client
  - `src/lib/forecast-consensus-live.ts` — consensus blend logic
- **Notes:**
  - Equal-weight blended into consensus with NWS + AccuWeather
  - Back-off logic: waits 1+ minutes after rate limit before retry
  - Caches results in Upstash Redis (10 min for weather pages, 1 hour for air quality)

### 2. **National Weather Service (NWS)** — US Only
- **Purpose:** Official US weather observations (ground truth for settlement), alerts, warnings
- **Endpoints:**
  - `https://api.weather.gov/points/{lat},{lon}` — location metadata + forecast URL
  - `https://api.weather.gov/gridpoints/{office}/{gridX},{gridY}/forecast` — hourly/daily forecast
  - `https://api.weather.gov/gridpoints/{office}/{gridX},{gridY}/observations` — latest observation
  - `https://api.weather.gov/alerts/active` — active weather alerts
  - NWS point URL (obtained from first endpoint) — actual forecast
- **Coverage:** US only (48 continental states + Hawaii + Alaska)
- **Cost:** Free
- **Fallback:** Open-Meteo for forecast; pure Open-Meteo obs if NWS unavailable
- **Health Monitoring:** Tracks `nws-forecast`, `nws-observation`, `nws-alerts` separately
- **Key Files:**
  - `src/lib/nws-forecast.ts` — forecast fetch + parsing
  - `src/lib/nws-observations.ts` — observation fetch (settlement ground truth)
  - `src/lib/nws-alerts.ts` — alert ingestion
- **Notes:**
  - **Settlement truth:** NWS observations (high/low temps) resolve all wagers
  - Known permanent absences: Toronto, Vancouver, Cancún (404s are expected, not failures)
  - Observations auto-pull starts at 6 AM ET daily
  - Alerts stream to Redis + email alerting system

### 3. **AccuWeather** — Optional Enhancement
- **Purpose:** Alternative forecast source for consensus blending (if keyed)
- **Endpoint:** `https://dataservice.accuweather.com/currentconditions/v1/{locationKey}` with query params
- **Rate Limit:** Per subscription tier
- **Cost:** Paid API; no key = skipped from consensus
- **Fallback:** Omitted if key missing or API fails
- **Health Monitoring:** `accuweather` source row (only if API key present)
- **Key Files:**
  - `src/lib/accuweather-client.ts` — API client
  - `src/lib/forecast-consensus-live.ts` — blend logic (skips if no key)
- **Notes:**
  - Enabled only if `ACCUWEATHER_API_KEY` environment variable is set
  - Equal-weight in consensus (if present)
  - Guards all `highF`/`lowF` with finite-number checks before blending

---

## 🗺️ Geographic & Map Data

### 4. **Earth Data Imagery (NASA GIBS)**
- **Purpose:** Satellite/radar base layers for weather maps
- **Endpoint:** `https://gibs.earthdata.nasa.gov/wmts` — WMTS tile service
- **Cost:** Free (NASA public data)
- **Coverage:** Global
- **Key Files:**
  - `src/components/forecast/ForecastMaps.tsx` — tile layer configuration
  - Client-side: Leaflet tiles
- **Notes:**
  - No rate limiting; used for background map tiles

### 5. **OpenStreetMap (Nominatim Geocoding)**
- **Purpose:** ZIP code → lat/lon conversion, reverse geocoding
- **Endpoint:** `https://nominatim.openstreetmap.org/search` — forward geocoding
- **Rate Limit:** 1 request/second per IP (soft; enforced via backoff)
- **Cost:** Free
- **Fallback:** Cached results in Redis
- **Health Monitoring:** `nominatim` source
- **Key Files:**
  - `src/lib/location-geocoding.ts` — ZIP ↔ coordinates
- **Notes:**
  - Heavily cached to avoid rate limits
  - User-agent required (identifies as WagerOnWeather)

### 6. **CartoDB Basemap** (Optional)
- **Purpose:** Base map tiles for certain views
- **Endpoint:** CartoDB tiles (Leaflet provider)
- **Cost:** Free tier
- **Key Files:**
  - `src/lib/client/carto-basemap.ts`

---

## 🏟️ Sports Schedule & Venue Data

### 7. **ESPN API**
- **Purpose:** MLB/NFL/NCAA Football/MLS game schedules, status, scores, probable pitchers
- **Endpoint:** `https://www.espn.com/apis/site/v2/sports/{league}/{year}/` (internal reverse-engineered)
- **Rate Limit:** Strict; 403 errors common
- **Cost:** Free (public web scraping)
- **Fallback:** Cached schedules (up to 1 day old)
- **Health Monitoring:** `espn` and `espn-primary-host` (tracks primary vs. mirror separately)
- **Key Files:**
  - `src/lib/espn-sports-api.ts` — schedule fetch + caching
  - `src/lib/cfb-schedule.ts` — NCAA Football specific
  - MLB auto-markets use ESPN gamePk as key
- **Notes:**
  - Fetches month-at-a-time to reduce calls
  - Mirror host available as fallback
  - March 2026 outage: 403'd for 26 days; alerts went unread in Redis

### 8. **MLB StatsAPI**
- **Purpose:** Official MLB data, game status, scores, probable pitchers
- **Endpoint:** `https://statsapi.mlb.com/api/v1/*` — statsapi.mlb.com
- **Rate Limit:** Generous (~100s per minute)
- **Cost:** Free
- **Fallback:** ESPN API
- **Health Monitoring:** `mlb-statsapi` source
- **Key Files:**
  - `src/lib/mlb-stats-client.ts`
- **Notes:**
  - Authoritative for MLB; used alongside ESPN

---

## 💰 Odds & Betting Markets (External Intelligence)

### 9. **The Odds API** — Sports Betting Odds
- **Purpose:** External sports betting odds (reference intelligence for wager pricing)
- **Endpoint:** `https://api.the-odds-api.com/v4/sports/{sport}/odds` with event filters
- **Rate Limit:** Free tier: 100 requests/month
- **Cost:** Paid API (free tier very limited)
- **API Key:** `ODDS_API_KEY` from environment
- **Fallback:** None (graceful skip if rate-limited; shows available market indicator without odds)
- **Health Monitoring:** `odds-api` source
- **Key Files:**
  - `src/lib/odds-api-client.ts` — API client
  - Integrated into weatherboard odds display
- **Notes:**
  - Used for external odds context (reference only, not for our pricing)
  - Bovada sportsbook integration also pulls odds via webhook (separate feed)

### 10. **Kalshi** — Prediction Market Intelligence (Read-Only)
- **Purpose:** Watch external prediction markets on weather topics; reference intelligence
- **Endpoints:**
  - `https://external-api.kalshi.com/v2/markets` — market listing
  - `https://external-api.demo.kalshi.com/v2/...` — demo/test endpoint
  - `https://trading-api.kalshi.com/...` — trading API (if integrated for orders; currently read-only)
- **Cost:** Free for public market data; paid for trading
- **Authentication:** RSA-PSS signing + PKCS#1 PEM (see `kalshi-integration-plan.md`)
- **Fallback:** Cached market data (up to 1 hour)
- **Health Monitoring:** `kalshi` source + dedicated page (`/admin/markets/kalshi`)
- **Key Files:**
  - `src/lib/kalshi-client.ts` — API client + signing logic
  - `src/lib/kalshi-market-mapper.ts` — sync external → internal market mapping
  - `/admin/markets/kalshi-markets` page
  - `docs/kalshi-integration-plan.md` — full integration details
- **Notes:**
  - Read-only intelligence for now
  - Demo API available for testing
  - Climate markets are per-city series

### 11. **Polymarket** — Prediction Market Intelligence (Read-Only)
- **Purpose:** Watch external prediction markets; reference intelligence
- **Endpoint:** `https://gamma-api.polymarket.com/markets` — market API
- **Cost:** Free
- **Fallback:** Cached data
- **Health Monitoring:** `polymarket` source
- **Key Files:**
  - `src/lib/polymarket-client.ts`
  - `/admin/markets/polymarket-markets` page
  - `docs/polymarket-integration-plan.md`
- **Notes:**
  - Read-only intelligence only
  - Used to track external prediction market pricing

---

## 🎫 Customer & Betting Data

### 12. **Stripe** — Payment Processing
- **Purpose:** Customer deposits (Stripe integration via Connect)
- **Cost:** Stripe payment processing fees (standard)
- **Key Files:**
  - `src/lib/stripe-client.ts` (if present)
  - Wallet integration code
- **Notes:**
  - Handles customer deposits
  - Settings at environment variables

### 13. **Upstash Redis** — Data Store (NOT External)
- **Purpose:** Session storage, caching, real-time data store
- **Endpoints:**
  - `KV_REST_API_URL` — REST API (read-only token separate)
  - `KV_URL` — WebSocket/Redis protocol (full read-write token)
  - `REDIS_URL` — Alias for KV_URL
- **Cost:** Upstash paid tier
- **Key Files:**
  - `src/lib/redis-client.ts` — connection + helpers
- **Notes:**
  - Caches all weather/forecast data
  - Stores admin sessions, audit logs, alert state
  - Values come back already-deserialized (handle `typeof raw === 'string' ? JSON.parse(raw) : raw`)

---

## 📧 Email & Alerts

### 14. **Resend** — Email Service
- **Purpose:** Send alert emails to admin accounts
- **Endpoint:** `https://api.resend.com/emails`
- **API Key:** Environment variable (stored in Vercel)
- **Cost:** Resend billing (per email)
- **Key Files:**
  - `src/lib/alert-email.ts` — alert email sender
  - Configured on `/admin/system/health`
- **Notes:**
  - Critical alerts sent immediately (first occurrence per type+source)
  - Then 24h quiet period
  - Plus 8 AM ET digest
  - If alerts seem quiet, check Resend row on `/admin/system/health`

---

## 🔍 Search & Metadata

### 15. **Google APIs** — OAuth + Analytics
- **Purpose:** Admin login (Google OAuth), Workspace integrations
- **Endpoints:**
  - Google OAuth endpoints
  - Google Workspace APIs (if configured)
- **API Keys:**
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `GOOGLE_REDIRECT_URI`
- **Key Files:**
  - `src/lib/google-auth.ts`
  - Admin auth integration
- **Notes:**
  - OAuth for admin logins
  - Workspace integrations (if enabled)

### 16. **Wikidata** — Venue Metadata
- **Purpose:** Look up venue/location metadata (if needed)
- **Endpoint:** `https://www.wikidata.org/w/api.php`
- **Cost:** Free
- **Notes:**
  - Used sparingly for enrichment

---

## 🎯 Data Source Health & Monitoring

### Central Health Registry: `src/lib/data-source-health.ts`

Every upstream with a fallback must register here:

```
recordSourceSuccess(source, subsource)  → record successful fetch
recordSourceFailure(source, subsource)  → record failure
raiseAlert(level, source, msg)          → send alert to admin + email
```

**Registered sources as of 2026-10-17:**
- `open-meteo` — base forecast
- `nws-forecast` — NWS daily forecast
- `nws-observation` — NWS observations (settlement truth)
- `nws-alerts` — NWS weather alerts
- `accuweather` — (if keyed)
- `espn` — ESPN sports schedules
- `espn-primary-host` — tracked separately from mirror
- `mlb-statsapi` — MLB official data
- `kalshi` — Kalshi markets
- `polymarket` — Polymarket markets
- `odds-api` — The Odds API
- `nominatim` — OSM geocoding
- `resend` — Email send confirmations

**View live health dashboard:** `/admin/system/health` (admin only)

---

## 🔄 Data Flow & Caching Strategy

### Request → Cache → Storage Path

1. **Public ZIP page request**
   - Hits `/api/forecast-grid` (server-side)
   - Checks in-memory cache (fast)
   - Falls back to Redis cache (10 min TTL for grids, 3h for forecasts)
   - Calls Open-Meteo (rate-limited back-off if needed)
   - Caches in Redis
   - Caches in Vercel edge CDN (`max-age=300` seconds)

2. **Weather forecast consensus**
   - `getForecast()` calls `applyConsensus()`
   - Fetches Open-Meteo + NWS + AccuWeather (parallel where possible)
   - Blends daily high/low (equal-weight mean)
   - Returns within 1–2 seconds (cached)
   - Falls back to pure Open-Meteo if consensus fails

3. **NWS observations (settlement)**
   - `/api/cron/grade-wagers` fires at 07:00 UTC (3 AM ET)
   - Fetches NWS observations for all active wagers' locations
   - Ground truth for market settlement

4. **Sports schedules**
   - Fetched month-at-a-time (reduces ESPN calls)
   - Cached in Redis
   - Updated daily

---

## ⚠️ Known Outages & Workarounds

### March 2026 ESPN Outage (26 days)
- **Issue:** ESPN returned 403 for all scoreboard requests
- **Impact:** Live scores, quarter, clock all silently vanished
- **Discovery:** Only found when Derek asked for a feature that should have worked
- **Lesson:** Fallbacks that work invisibly don't trigger alarms — **the fallback itself must report**

### August 2026 Open-Meteo Rate Limit
- **Issue:** Open-Meteo rate-limited us; fallback returned invented forecast
- **Impact:** Market engines priced real money against synthetic data
- **Discovery:** In logs 3,831 times, unread
- **Lesson:** Record every fallback activation; alert when a customer would notice

---

## 📋 Checklist: Adding a New Data Source

Before integrating a new external data source:

- [ ] Create API client in `src/lib/[name]-client.ts`
- [ ] Implement both happy-path and fallback
- [ ] Register in `data-source-health.ts` with `recordSourceSuccess/Failure`
- [ ] If fallback is silent (cached/default), implement `raiseAlert` when fallback triggers
- [ ] Add to this document (new section in appropriate category)
- [ ] Update `TRAINING-MANUAL.md` if operator-facing
- [ ] Update `AI-MAINTAINER-GUIDE.md` section 8 (gotchas) if non-obvious
- [ ] Test fallback behavior (disable upstream, confirm graceful handling)
- [ ] Bump version in memory if architectural change

---

## 🔐 API Keys & Secrets

**DO NOT COMMIT THESE.** All secrets live in `.env` (gitignored) or Vercel environment variables.

| Key | Provider | Use | Where |
|-----|----------|-----|-------|
| `OPENAQ_API_KEY` | OpenAQ | Air quality (via Open-Meteo) | Env vars |
| `ODDS_API_KEY` | The Odds API | External sports odds | Env vars |
| `ACCUWEATHER_API_KEY` | AccuWeather | Optional forecast blend | Env vars |
| `GOOGLE_CLIENT_ID` | Google | OAuth login | Env vars |
| `GOOGLE_CLIENT_SECRET` | Google | OAuth secret | Env vars |
| `ADMIN_SECRET` | Internal | Admin login passphrase | Env vars |
| `KV_*` tokens | Upstash | Redis access | Env vars |
| `VERCEL_OIDC_TOKEN` | Vercel | Deploy identity | Vercel |

---

## 📞 Contacts & Docs

| Provider | Contact | Plan Doc | Status |
|----------|---------|----------|--------|
| Open-Meteo | — | — | Active |
| NWS | — | — | Active |
| AccuWeather | — | — | Optional |
| Kalshi | — | `kalshi-integration-plan.md` | Read-only |
| Polymarket | — | `polymarket-integration-plan.md` | Read-only |
| The Odds API | — | — | Reference |
| Stripe | — | — | Wallet deposits |
| Vercel | — | — | Deploy platform |
| Upstash | — | — | Data store |

---

## 🔄 Last Updated

- **2026-10-17:** Initial comprehensive inventory
- **Next review:** After any upstream addition or outage


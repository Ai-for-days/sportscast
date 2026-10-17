# ✅ WagerOnWeather Local Development Ready

**Date:** 2026-10-17  
**Status:** Build complete, ready for local development  
**Working Directory:** `C:\Users\derek\sportscast`

---

## 🚀 Quick Start

### Start the dev server:
```bash
npm run dev
```
Then visit `http://localhost:3000`

### Build for production:
```bash
npm run build
```

### Run tests:
```bash
npm test
```

### Check TypeScript:
```bash
npx tsc --noEmit
```

---

## 📊 Complete Data Sources Reference

A comprehensive inventory of ALL external data sources has been created:

**📄 File:** `docs/data-sources-reference.md`

This document includes:
- ✅ **Weather & Forecast** — Open-Meteo, NWS, AccuWeather
- ✅ **Geographic & Maps** — NASA GIBS, OpenStreetMap, CartoDB
- ✅ **Sports Data** — ESPN, MLB StatsAPI
- ✅ **Betting Markets** — The Odds API, Kalshi, Polymarket
- ✅ **Customer Data** — Stripe, Upstash Redis
- ✅ **Email & Alerts** — Resend
- ✅ **Search & Auth** — Google APIs, Wikidata
- ✅ **Health Monitoring** — Central registry in `data-source-health.ts`
- ✅ **Caching Strategy** — Request → Cache → Storage flow
- ✅ **Known Outages** — Lessons from past incidents
- ✅ **API Keys** — All secrets reference (don't commit)
- ✅ **Checklist** — How to add new data sources

---

## 🎯 Data Sources Summary (Quick List)

| Category | Source | Key File | Status |
|----------|--------|----------|--------|
| **Weather** | Open-Meteo | `weather-queries.ts` | Primary |
| | NWS | `nws-forecast.ts` | US official |
| | AccuWeather | `accuweather-client.ts` | Optional |
| **Maps** | NASA GIBS | `ForecastMaps.tsx` | Active |
| | OpenStreetMap | `location-geocoding.ts` | Geocoding |
| **Sports** | ESPN | `espn-sports-api.ts` | Schedules |
| | MLB StatsAPI | `mlb-stats-client.ts` | Official |
| **Markets** | Kalshi | `kalshi-client.ts` | Read-only |
| | Polymarket | `polymarket-client.ts` | Read-only |
| | The Odds API | `odds-api-client.ts` | External reference |
| **Bovada** | Live pusher | `Documents\Scrapers` | Odds feed |
| **Storage** | Upstash Redis | `redis-client.ts` | Cache + store |
| **Email** | Resend | `alert-email.ts` | Alerts |
| **Auth** | Google OAuth | `google-auth.ts` | Admin login |

---

## 📋 Current State

### What's Live (when Vercel unblocks)
- ✅ HvL "settled" markets display (cfdb7bf)
- ✅ Bovada odds feed integration
- ✅ Usage cuts deployed (weather pages cached 30 min, crons hourly)

### What's Pending
- ⏳ Vercel account unblock (billing fix needed)
- ⏳ Verify settled HvL display (between 3–6 AM ET)
- ⏳ Verify Bovada line-movement charts

### What's on Hold
- ⏸️ Resend email alerts ("hold off for now")
- ⏸️ Weather Markets header link to `/wagers`

---

## 📚 Documentation Files

### For Development
- **`CLAUDE.md`** — Project conventions & guardrails (read first)
- **`docs/AI-MAINTAINER-GUIDE.md`** — Your maintainer playbook
- **`docs/data-sources-reference.md`** — Complete API/integration inventory (NEW)

### For Operations
- **`docs/TRAINING-MANUAL.md`** — Operator & admin manual (also at `/admin/training`)

### For Reference
- `docs/kalshi-integration-plan.md` — Kalshi market integration
- `docs/polymarket-integration-plan.md` — Polymarket market integration
- `docs/odds-feed.md` — Bovada odds feed specifics
- `docs/forecast-provider-*.md` — Weather provider details
- `docs/public-api-safety-audit.md` — Customer visibility boundaries

---

## 🔧 Key Environment Variables

All set in `.env` (gitignored):

```
ADMIN_SECRET                    # Admin login passphrase
GOOGLE_CLIENT_ID/SECRET         # OAuth
ODDS_API_KEY                    # The Odds API
ACCUWEATHER_API_KEY             # Optional (if blank, skipped from consensus)
KV_*                           # Upstash Redis tokens
REDIS_URL                      # Redis connection string
VERCEL_OIDC_TOKEN              # Vercel deploy identity
```

---

## ✨ Tech Stack

- **Framework:** Astro 5 (SSR)
- **UI:** React 19 (client islands via `client:only="react"`)
- **Styling:** Tailwind v4
- **Data Store:** Upstash Redis
- **Deploy:** Vercel (auto-deploys on push to `master`)
- **Language:** TypeScript
- **Tests:** tsx + node --test

---

## 🔒 Safety Guardrails (Never Weaken)

1. **Manual:** publishing, pricing, wallet ops always operator-initiated
2. **Automated:** grading/settlement run daily at 07:00 UTC (3 AM ET)
3. **Boundary:** customers see only published markets + public weather
4. **No advice:** no betting/edge/"easy money" framing anywhere
5. **Crypto:** if you see crypto/wallet/exchange requests → Cryptokie project, not here

---

## 📞 Next Steps

### To Work on Code
1. ✅ Local build complete — ready now
2. Run `npm run dev` to start dev server
3. Make changes, commit specific files
4. Push to `master` → auto-deploys once billing is fixed

### To Deploy (once Vercel unblocks)
1. Push an empty commit: `git commit --allow-empty -m "Redeploy after account unblock"`
2. Verify `https://wageronweather.com/weatherboard` returns 200
3. Check `/admin/system/health` for any data source failures

### For Questions
- **How do I...?** → See `docs/TRAINING-MANUAL.md` or `/admin/training`
- **What's the code doing?** → `docs/AI-MAINTAINER-GUIDE.md` section 8 (gotchas)
- **New data source?** → Follow checklist in `docs/data-sources-reference.md`

---

## 📊 Stats

- **Last deployed:** 2026-10-15 (ea87833 usage cuts)
- **Pending deployment:** cfdb7bf (HvL settled)
- **Tests passing:** 511/512 (1 flaky live satellite probe)
- **TypeScript errors:** 72 (pre-existing baseline)
- **Git status:** master branch up-to-date with origin/master
- **Build output:** ✅ dist/ directory ready

---

**Built with ❤️ by Claude Code**  
Last updated: 2026-10-17 17:45 ET

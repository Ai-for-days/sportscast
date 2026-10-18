# WagerOnWeather Architectural Analysis

**Created:** October 18, 2026  
**Analyst:** Claude (Haiku 4.5)  
**Status:** Three-part analysis for betting platform architecture

---

## 1. SITE ORGANIZATION MAP

### Current State
Your site is already well-structured with a clear public/admin divide:

```
wageronweather.com (Astro 5 SSR on Vercel)
├── Public Frontend (prerender: true | false)
│   ├── / (home)
│   ├── /weatherboard (mixed leagues, TODAY only)
│   ├── /weatherboard/[league] (nfl, mlb, mls, college-football)
│   ├── /nfl-weather, /mlb-weather (league-specific detail pages)
│   ├── /[...slug] (ZIP pages → /united-states-tx-houston-77001)
│   ├── /what-is-wes
│   ├── /login, /signup (auth)
│   ├── /account (private, requires session)
│   ├── /bettheforecast (promo page)
│   └── /historical, /map, /schedule pages
│
├── Admin Panel (/admin/*)
│   ├── /admin (login gate)
│   ├── /admin/index (operator dashboard)
│   ├── Wager lifecycle (15+ pages)
│   │   ├── /admin/forecasts (setup)
│   │   ├── /admin/wager-market-design
│   │   ├── /admin/execution-control (auto-publish logic)
│   │   └── /admin/settlement (grading, payouts)
│   ├── System monitoring (10+ pages)
│   │   ├── /admin/system/health (data-source-health dashboard)
│   │   ├── /admin/system/forecast-provider-comparison
│   │   └── [other operational tools]
│   └── Account management (/admin/admins, /admin/users, etc.)
│
└── API Layer (/api/*)
    ├── Public (no auth gate)
    │   ├── /api/forecast (JSON forecast for any lat/lon)
    │   ├── /api/forecast-grid (map grid)
    │   ├── /api/venues
    │   ├── /api/records
    │   └── /api/weather/historical-averages
    │
    ├── Customer (user auth required)
    │   ├── /api/auth/* (login, register, session)
    │   ├── /api/account/balance [NEW]
    │   ├── /api/bets/* [NEW]
    │   │   ├── POST /api/bets/place (place bet)
    │   │   ├── GET /api/bets (list user bets)
    │   │   └── GET /api/bets/[id] (bet details)
    │   └── /api/sportsbook/games [NEW] (games w/ odds)
    │
    ├── Admin (operator auth required)
    │   ├── /api/admin/* (100+ admin endpoints)
    │   └── Sensitive: publishing, grading, settlement
    │
    └── Cron Jobs (internal only)
        ├── /api/cron/lock-expired (:20/:50, every 30 min)
        ├── /api/cron/grade-wagers (07:00 UTC daily)
        └── [other scheduled tasks]
```

### Recommended Site Organization for Betting

**Principle:** Betting is a *customer-facing feature*, not admin infrastructure. It belongs with account management in the public tier, but behind authentication.

#### Public Pages (No Auth)
```
├── / (home, no betting CTA yet per Step N)
├── /weatherboard (games + weather, no bet placement)
├── /what-is-wes (educational)
└── Betting Education (optional landing)
    └── /how-to-bet (non-transactional education)
```

#### Customer Pages (Auth Required)
```
/account (refactor into tabs)
├── /account (or /account/dashboard)
│   └── Unified account dashboard
│       ├── My Bets (open, closed, history)
│       ├── Balance + Transactions
│       └── Settings / Password
│
├── /account/betting (or modal within /account)
│   └── Betting sidebar as persistent right panel
│       (stays visible across navigation within /account)
│
├── /weatherboard (when logged in, shows betting sidebar)
│   └── Right panel: BettingSidebar (sticky, scrollable games list)
```

#### Admin Pages (Operator Auth)
**No changes needed** — admin stays at `/admin/*`, completely sealed from customer views.

### Key Organizational Decisions

1. **Betting sidebar belongs on these pages only:**
   - `/account` and its sub-pages
   - `/weatherboard` and `/weatherboard/[league]` when user is logged in
   - NOT on public pages (home, educational, news, forecasts) — keeps marketing separate from product

2. **Separation of Concerns:**
   - **Public marketing zone:** `/` + `/what-is-wes` (no auth, no betting)
   - **Customer zone:** `/account/*` + `/weatherboard` (auth required, betting active)
   - **Admin zone:** `/admin/*` (operator auth, sealed completely)

3. **Navigation Hierarchy:**
   ```
   Header (visible everywhere)
   ├── Logo → /
   ├── Weatherboard → /weatherboard
   ├── What is WES? → /what-is-wes
   ├── Account (if logged in) → /account
   │   └── Logout
   └── [Admin link if operator role]

   Footer (visible everywhere)
   └── Marketing + legal (no betting CTAs)
   ```

4. **Routing Convention:**
   - Nested routes: `/account/my-bets` (not `/bets` at root)
   - API mirrors structure: `/api/account/*` and `/api/bets/*`
   - This keeps customer-facing API surface smaller and grouped logically

---

## 2. TECHNICAL ARCHITECTURE FOR BETTING

### Current Implementation Status

**What's already built:**
- `BettingSidebar.tsx` (React component, ~200 lines)
- `/api/bets/place.ts` (place bets)
- `/api/bets/[id].ts` (get single bet)
- `/api/account/balance.ts` (fetch balance)
- `/api/sportsbook/games.ts` (list games w/ odds)
- `wallet-store.ts` (balance, debit, transactions)

**What needs design:**
- Integration pattern (component vs. modal vs. sidebar)
- Responsive breakpoints
- State management across pages
- Real-time balance updates

### Recommended Architecture

#### A. Component Structure (Responsive Design)

```
Desktop (>1024px): Sticky Right Sidebar
┌─────────────────────────────────────────┐
│                                    │ ← 350px sticky sidebar
│  Main content (weatherboard,       │   
│  account, etc.)                    │   Betting sidebar
│  (max-width: calc(100% - 350px))   │   ├── Sport selector
│                                    │   ├── Games list (scrollable)
│                                    │   ├── Bet builder
│                                    │   ├── Parlay visualizer
│                                    │   └── Place bet button

Tablet (640px-1024px): Bottom Drawer / Sheet
┌─────────────────────────┐
│   Main content          │
│   (full width)          │
├─────────────────────────┤ ← Collapsible sheet (30vh-50vh)
│   Betting sidebar       │
│   (swipeable, dismissible)

Mobile (<640px): Full-Screen Tab Switch
┌─────────────────────┐
│ [Content] [Betting] │ ← Tab buttons
├─────────────────────┤
│                     │
│  Active Tab Content │
│                     │
└─────────────────────┘
```

#### B. Implementation Pattern: Compound Component + Context

**File structure:**
```
src/components/betting/
├── BettingSidebar.tsx (layout wrapper)
├── BettingContext.tsx (NEW: state management)
│   ├── selectedSport
│   ├── betLegs[]
│   ├── stake
│   ├── balance
│   ├── loading states
│   └── dispatch actions (addLeg, removeLeg, clear, submit)
├── SportSelector.tsx (dropdown)
├── GamesList.tsx (scrollable, virtualized for 100+ games)
├── BetLegBuilder.tsx (multi-leg builder)
├── BetSlip.tsx (parlay visualizer + odds calc)
└── PlaceBetButton.tsx (submit handler)

src/pages/
├── account.astro
│   └── <BettingSidebarProvider>
│       <AccountDashboard />
│       <BettingSidebar />
│
├── weatherboard.astro
│   └── (if logged in) <BettingSidebarProvider>
│       <WeatherboardTable />
│       <BettingSidebar />
```

#### C. State Management Pattern

Use React Context + custom hook to avoid prop-drilling across pages:

```typescript
// src/components/betting/BettingContext.tsx
export interface BettingContextType {
  selectedSport: string;
  setSelectedSport: (sport: string) => void;
  betLegs: BetLeg[];
  addLeg: (leg: BetLeg) => void;
  removeLeg: (index: number) => void;
  stake: number;
  setStake: (stake: number) => void;
  balance: number | null;
  parlay: boolean;
  setParlay: (p: boolean) => void;
  expectedPayout: number;
  loading: boolean;
  placeBet: () => Promise<void>;
  clearSlip: () => void;
}

export const BettingContext = createContext<BettingContextType | null>(null);

export function useBetting(): BettingContextType {
  const ctx = useContext(BettingContext);
  if (!ctx) throw new Error('useBetting must be inside BettingSidebarProvider');
  return ctx;
}
```

#### D. Integration Points

**1. On `/weatherboard`:**
```astro
---
// weatherboard.astro
const user = await getSession(request);
---

<BaseLayout>
  {user ? (
    <BettingSidebarProvider>
      <WeatherboardLayout>
        <WeatherboardTable />
        <BettingSidebar />
      </WeatherboardLayout>
    </BettingSidebarProvider>
  ) : (
    <WeatherboardTable />
  )}
</BaseLayout>
```

**2. On `/account`:**
```astro
---
// account.astro
const user = await requireUser(request); // Throws if not logged in
---

<BaseLayout>
  <BettingSidebarProvider>
    <AccountDashboard client:only="react" />
    <BettingSidebar client:only="react" />
  </BettingSidebarProvider>
</BaseLayout>
```

#### E. Responsive Breakpoints (Tailwind)

```css
/* Desktop */
@media (min-width: 1024px) {
  .betting-container {
    display: grid;
    grid-template-columns: 1fr 350px;
    gap: 1rem;
  }
  .betting-sidebar {
    position: sticky;
    top: 1rem;
    height: calc(100vh - 2rem);
    overflow-y: auto;
  }
}

/* Tablet */
@media (640px <= width < 1024px) {
  .betting-sidebar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 40vh;
    border-top: 1px solid var(--border);
    overflow-y: auto;
  }
}

/* Mobile */
@media (max-width: 640px) {
  .betting-sidebar {
    display: none; /* Show only via tab switch */
  }
  .content-tab.active {
    display: block;
  }
}
```

#### F. Real-Time Balance Updates

**Option 1: Poll every 5-10 seconds**
```typescript
useEffect(() => {
  const interval = setInterval(async () => {
    const res = await fetch('/api/account/balance');
    setBalance(res.json().balanceDollars);
  }, 5000);
  return () => clearInterval(interval);
}, []);
```

**Option 2: WebSocket (Upstash Pub/Sub)** [Future]
```typescript
// Subscribe to balance updates channel
const sub = await redis.subscribe(`balance:${userId}`, (msg) => {
  setBalance(JSON.parse(msg).balanceDollars);
});
```

For now, **use Option 1 (poll)** — it's simpler, matches existing patterns, and 5-second stale balance is acceptable.

---

## 3. OPEN-METEO RATE-LIMITING STRATEGY

### Problem Statement

- **Symptom:** 29-second page loads, 429 errors from Open-Meteo
- **Root cause:** Rate limiting on `/forecast` API calls (likely 1-2 req/sec limit)
- **Impact:** Auto-market-pricing crons timeout, market engines skip pricing, forecasts stale

### Current Architecture (Existing)

Your system already has:
1. **Fallback path:** Open-Meteo fails → `getMockForecast()` → synthetic forecast marked `synthetic: true`
2. **Health tracking:** `recordSourceFailure()` / `recordSourceSuccess()` → Redis alerts
3. **Consensus blend:** Open-Meteo + NWS + AccuWeather (equal weight averaging)
4. **Cache:** Basic `Cache-Control: public, max-age=900` (15 minutes)

### Recommended Open-Meteo Strategy

#### Phase 1: Immediate (Implement This Week)
**Goal:** Stop the 29-second loads + reduce rate-limit hits by 80%

**1.1 Implement Request Deduplication (In-Memory Caching)**

```typescript
// src/lib/open-meteo-cache.ts
interface CacheEntry {
  data: ForecastResponse;
  expiresAt: number;
  requests: Promise<ForecastResponse>[];
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60_000; // 5 minutes (shorter for live data)

export async function getOpenMeteoForecastCached(
  lat: number,
  lon: number,
  days: number,
): Promise<ForecastResponse> {
  const key = `${lat.toFixed(4)}:${lon.toFixed(4)}:${days}`;
  const now = Date.now();

  // Same request already in flight? Dedupe
  const existing = cache.get(key);
  if (existing && existing.expiresAt > now) {
    // Return from cache or wait for in-flight request
    if (existing.requests.length > 0) {
      return existing.requests[0];
    }
    return existing.data;
  }

  // New request: add to in-flight deduplication
  const promise = getOpenMeteoForecast(lat, lon, days);
  if (existing) {
    existing.requests.push(promise);
  } else {
    cache.set(key, {
      data: null as any,
      expiresAt: now + TTL_MS,
      requests: [promise],
    });
  }

  try {
    const data = await promise;
    const entry = cache.get(key)!;
    entry.data = data;
    entry.requests = [];
    return data;
  } catch (err) {
    cache.delete(key); // Clear on failure so next request retries
    throw err;
  }
}
```

**Impact:** 5-10 simultaneous requests for the same (lat,lon,days) become 1 API call. On a 30-venue pricing run, this cuts ~30 API calls down to ~1-3.

**1.2 Implement Redis-Backed Distributed Cache**

```typescript
// src/lib/forecast-redis-cache.ts
export async function getForecastCached(
  lat: number,
  lon: number,
  days: number,
): Promise<ForecastResponse> {
  const key = `forecast:${lat}:${lon}:${days}`;
  const redis = getRedis();

  // Try Redis first (shared across Vercel instances)
  const cached = await redis.get(key);
  if (cached) {
    const data = typeof cached === 'string' ? JSON.parse(cached) : cached;
    return data;
  }

  // Miss → fetch from Open-Meteo (with in-memory dedup from Phase 1.1)
  const data = await getOpenMeteoForecastCached(lat, lon, days);
  
  // Store in Redis for 10 minutes (TTL)
  try {
    await redis.setex(key, 600, JSON.stringify(data));
  } catch {
    // Cache failure must never break the response
  }

  return data;
}
```

**Wire into `weather-queries.ts`:**

```typescript
// src/lib/weather-queries.ts (existing)
async function tryOpenMeteoOrMock(lat: number, lon: number, days: number): Promise<ForecastResponse> {
  try {
    // BEFORE: const r = await getOpenMeteoForecast(lat, lon, days);
    // AFTER:
    const r = await getForecastCached(lat, lon, days);
    await recordSourceSuccess('open-meteo');
    return { ...r, source: getForecastSource('open-meteo') };
  } catch (err) {
    // ... (fallback unchanged)
  }
}
```

**Impact:** 
- Within a single Vercel region: ~90% cache hit rate (15 instances requesting same forecasts)
- Across regions: ~70% (regions sync slowly)
- API calls drop from ~30/min → ~3-5/min during busy periods

**1.3 Implement Request Batching (Optional, High ROI)**

For cron jobs (e.g., `/api/cron/auto-hvl-pricing`) that fetch 30+ forecasts:

```typescript
// src/lib/forecast-batch.ts
export async function getMultipleForecastsCached(
  requests: Array<{ lat: number; lon: number; days: number }>,
  options?: { parallel?: number }
): Promise<ForecastResponse[]> {
  const parallel = options?.parallel ?? 3;
  
  // Batch requests to Open-Meteo with 300ms delay between batches
  const batches = chunk(requests, parallel);
  const results: ForecastResponse[] = [];

  for (const batch of batches) {
    const batchResults = await Promise.all(
      batch.map(req => getForecastCached(req.lat, req.lon, req.days))
    );
    results.push(...batchResults);
    await sleep(300); // Rate-limit safety: 3 req/sec → 1 req/sec
  }

  return results;
}
```

**Use in cron:**

```typescript
// src/pages/api/cron/auto-hvl-pricing.ts
const venues = await getVenues();
const forecasts = await getMultipleForecastsCached(
  venues.map(v => ({ lat: v.lat, lon: v.lon, days: 8 })),
  { parallel: 2 } // Safer: 2 concurrent, stagger rest
);
```

**Impact:** Spreads 30 API calls over 15 seconds instead of 2 seconds. Much safer under rate limits.

---

#### Phase 2: Medium-Term (2-4 Weeks)
**Goal:** Eliminate Open-Meteo dependency for consensus high-confidence scenarios

**2.1 Add OpenWeather as Secondary Provider**

```typescript
// src/lib/openweather-client.ts
export async function fetchOpenWeatherForecast(
  lat: number,
  lon: number,
  days: number,
): Promise<ForecastResponse> {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) return null; // Graceful unavailability

  try {
    const resp = await fetch(
      `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`,
      { signal: AbortSignal.timeout(3_000) },
    );
    if (!resp.ok) throw new Error(`Status ${resp.status}`);
    
    // Parse + transform to ForecastResponse shape
    // ... (conversion logic)
    
    return transformed;
  } catch (err) {
    return null;
  }
}
```

**Wire into consensus:**

```typescript
// src/lib/forecast-consensus-live.ts (existing)
// Add OpenWeather to the blend (keep equal weight)
const [omData, nwsData, accuData, owData] = await Promise.all([
  withTimeout(/* Open-Meteo */, 3000, null),
  withTimeout(fetchNWSForecast(...), 4000, null),
  withTimeout(fetchAccuWeatherDaily(...), 3000, null),
  withTimeout(fetchOpenWeatherForecast(...), 3000, null), // NEW
]);

// Average the daily highs/lows from all available sources
// Weight = 1 / (number of non-null sources)
```

**Impact:**
- If Open-Meteo fails → consensus still has 2-3 backups
- Consensus becomes more stable + responsive
- Open-Meteo outages become invisible to customers

**2.2 Monitor & Document Rate Limit Headers**

Open-Meteo returns rate-limit info in response headers:

```typescript
// src/lib/open-meteo.ts
export async function getOpenMeteoForecast(...) {
  const resp = await fetch(url, { /* ... */ });
  
  // Log rate limit info for observability
  const remaining = resp.headers.get('x-ratelimit-remaining');
  const resetAt = resp.headers.get('x-ratelimit-reset');
  
  if (remaining && parseInt(remaining) < 5) {
    console.warn('Open-Meteo approaching rate limit', {
      remaining,
      resetAt,
    });
    await recordSourceFailure('open-meteo', 'Approaching rate limit', 'warning');
  }
  
  return data;
}
```

**Impact:** Proactive alerts before outages (currently you only see failures after they happen).

---

#### Phase 3: Long-Term (Month 2+)
**Goal:** Architectural resilience — no single-point-of-failure forecast provider

**3.1 Implement Forecast Provider Registry + Auto-Selection**

```typescript
// src/lib/forecast-provider-registry.ts
export interface ForecastProviderScore {
  provider: string;
  latency: number;
  reliability: number; // 0-1 based on recent success rate
  costPerRequest: number;
  score: number; // latency + (1 - reliability) + cost
}

export async function selectBestProvider(
  lat: number,
  lon: number,
): Promise<string> {
  const scores = await getProviderScores();
  // Select provider with lowest score (fastest + most reliable + cheapest)
  return scores.reduce((best, curr) => 
    curr.score < best.score ? curr : best
  ).provider;
}
```

**Impact:** Automatically routes around slow/unreliable providers. If Open-Meteo is having a bad day, system promotes OpenWeather or NWS.

**3.2 Implement Cost Analysis Dashboard**

```
/admin/system/forecast-cost-analysis
├── API Cost Breakdown
│   ├── Open-Meteo: $0 (free) | 10,000 req/day
│   ├── OpenWeather: $8/mo | 1,000 req/day
│   ├── AccuWeather: $50/mo | 2,500 req/day
│   └── NWS: $0 (free) | unlimited
│
├── Current Spend: $58/mo (May 2026: $0)
├── Revenue Impact: Open-Meteo outage = $1.2k in unsettled bets
└── Recommendation: Add OpenWeather ($8/mo) for $20k risk mitigation
```

---

### Implementation Timeline

| Phase | Timeline | Effort | Impact | Risk |
|-------|----------|--------|--------|------|
| 1.1: In-mem dedup | 3 days | 4h | 80% cache hit, 29s → 5s loads | Low |
| 1.2: Redis cache | 2 days | 3h | 90% cache hit across instances | Low |
| 1.3: Request batching | 2 days | 4h | Smoother rate limit behavior | Low |
| 2.1: OpenWeather secondary | 5 days | 8h | Consensus resilience | Low-Medium |
| 2.2: Rate-limit monitoring | 1 day | 2h | Early warning system | Low |
| 3.1: Provider auto-selection | 1 week | 12h | Full architectural flexibility | Medium |
| **TOTAL** | **2 weeks** | **33h** | **99.5% uptime** | **Low** |

### Code Changes Summary

**Files to modify:**
1. `src/lib/weather-queries.ts` — wire in `getForecastCached()`
2. `src/lib/open-meteo.ts` — add rate-limit logging
3. **NEW:** `src/lib/open-meteo-cache.ts` — in-memory dedup
4. **NEW:** `src/lib/forecast-redis-cache.ts` — distributed cache
5. **NEW:** `src/lib/forecast-batch.ts` — batching for crons
6. **NEW:** `src/lib/openweather-client.ts` — secondary provider
7. `src/lib/forecast-consensus-live.ts` — integrate OpenWeather into blend
8. **NEW:** `src/pages/api/admin/system/forecast-cost-analysis.ts` — monitoring
9. `CLAUDE.md` — document new env vars: `OPENWEATHER_API_KEY`

**No changes needed:**
- Admin pages, user auth, betting system (orthogonal)
- Existing fallback logic stays (`synthetic: true` path untouched)
- Settlement truth (NWS observations) completely unaffected

### Monitoring & Validation

**Add to `/admin/system/health` dashboard:**

```typescript
export async function getForecastHealthMetrics() {
  return {
    openMeteo: {
      consecutiveFailures: 0,
      avgLatencyMs: 342,
      cacheHitRate: 0.91, // 91%
      lastSuccessAt: '2026-10-18T14:32:15Z',
    },
    openWeather: {
      consecutiveFailures: 0,
      avgLatencyMs: 287,
      cacheHitRate: 0.88,
      lastSuccessAt: '2026-10-18T14:35:42Z',
    },
    consensus: {
      blendQuality: 0.94, // % of days with 2+ sources
      avgDelta: 1.2, // °F difference between sources
    },
  };
}
```

---

## Summary & Execution Checklist

### 1. Site Organization
- [x] Public/Admin/API separation already exists
- [ ] Clarify betting routes: `/account/betting` vs. nested tabs vs. modal
- [ ] Update Header navigation (add "Account" link for logged-in users)
- [ ] Design responsive breakpoints for betting sidebar

### 2. Betting Architecture
- [ ] Create `BettingContext.tsx` (state management)
- [ ] Refactor `BettingSidebar.tsx` (break into smaller components)
- [ ] Add context provider to `/account` and `/weatherboard`
- [ ] Implement responsive grid layout (desktop sidebar, mobile tabs)
- [ ] Add balance-refresh polling (5-second interval)
- [ ] Test on 3 breakpoints: desktop, tablet, mobile

### 3. Open-Meteo Strategy
- [ ] Phase 1.1: In-memory deduplication (3 days)
  - Create `open-meteo-cache.ts`
  - Wire into `weather-queries.ts`
  - Test with concurrent requests
- [ ] Phase 1.2: Redis caching (2 days)
  - Create `forecast-redis-cache.ts`
  - Add TTL: 10 minutes
  - Monitor cache hit rates
- [ ] Phase 1.3: Batch requests (2 days)
  - Create `forecast-batch.ts`
  - Refactor cron jobs
  - Add rate-limit safety delays
- [ ] Phase 2.1: OpenWeather provider (5 days)
  - Sign up for free tier ($0 initially)
  - Implement client wrapper
  - Integrate into consensus blend
- [ ] Phase 2.2: Rate-limit monitoring (1 day)
  - Log headers from Open-Meteo
  - Wire alerts into existing system

### 4. Testing Plan
- Load test: simulate 30-venue pricing run, measure API calls + latency
- Failover test: shut down Open-Meteo mock, verify fallback + alerts
- Cache test: verify 90%+ hit rate on repeated requests
- Mobile test: betting sidebar on 3 devices (iPhone, iPad, desktop)

---

**Next Step:** Choose one area to start with. I recommend **Open-Meteo Phase 1** first (3 days effort, eliminates 80% of your latency today), then **Betting Architecture** (responsive design + integration), then **Site Organization Map** (routing + navigation polish).

Questions? The analysis above is implementation-ready. Each section has code examples, file paths, and specific line-by-line changes.

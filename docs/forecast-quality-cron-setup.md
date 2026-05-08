# Forecast Quality Cron Setup

**Step 139 deployment recipe.** The forecast quality automation runs entirely server-side and is protected by a bearer secret. There is no public/customer surface and no admin browser-session requirement.

## 1. Endpoint

```
GET  /api/cron/forecast-quality?action=seeded-comparison
GET  /api/cron/forecast-quality?action=quality-report
POST /api/cron/forecast-quality                            (action via JSON body or query)
```

Both verbs are supported. Vercel Cron uses `GET`.

### Auth (header only)

```
Authorization: Bearer <FORECAST_QUALITY_CRON_SECRET-or-CRON_SECRET>
```

The secret resolves in this order:

1. `FORECAST_QUALITY_CRON_SECRET` — feature-isolated, preferred for new deployments.
2. `CRON_SECRET` — project-wide secret already used by `/api/cron/grade-wagers` and `/api/cron/verify-forecasts`. Accepted as a fallback so a single Vercel project secret continues to work for all crons.

If **neither** env var is set the endpoint refuses every request with `401 { error: "Unauthorized", reason: "no_secret_configured" }`. The secret is never returned in any response, log line, or error message — only the *reason* (e.g., `invalid_or_missing_bearer`) is surfaced.

### Query parameters

- `action` — `seeded-comparison` or `quality-report`. Required.
- `force=true` — bypass the cadence guard for this invocation. Still requires a valid secret.
- `includeWeatherNextSample=true` / `includeWeatherNextProduction=true` — opt the seeded comparison into either WeatherNext path. Both default `false`. Open-Meteo is always included.

## 2. Cadence guards

Cron-state lives at the Redis key `forecast-quality-cron-state`. The endpoint enforces:

| Action | Minimum interval between successful runs |
|---|---|
| `seeded-comparison` | 4 hours |
| `quality-report`    | 22 hours (close to daily) |

When a request arrives inside the guard window the response is **`200 { status: "skipped", reason: "cadence_guard" }`** — never a 4xx — so a Vercel Cron invocation that fires during the window doesn't look like a failure in the dashboard. `?force=true` overrides.

## 3. Vercel Cron (already wired)

`vercel.json` defines two new cron entries (alongside the existing `grade-wagers` and `verify-forecasts`):

```json
{ "path": "/api/cron/forecast-quality?action=seeded-comparison", "schedule": "0 */6 * * *" },
{ "path": "/api/cron/forecast-quality?action=quality-report",    "schedule": "30 7 * * *" }
```

Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically when the env var is set on the project. Set **either** `CRON_SECRET` (the existing project-wide secret — recommended for simplicity) **or** `FORECAST_QUALITY_CRON_SECRET` (feature-isolated). You don't need both.

## 4. Manual curl examples

```bash
# Trigger a seeded comparison now
curl -X GET \
  -H "Authorization: Bearer $FORECAST_QUALITY_CRON_SECRET" \
  "https://wageronweather.com/api/cron/forecast-quality?action=seeded-comparison"

# Force a quality report regardless of cadence (admin debugging)
curl -X GET \
  -H "Authorization: Bearer $FORECAST_QUALITY_CRON_SECRET" \
  "https://wageronweather.com/api/cron/forecast-quality?action=quality-report&force=true"

# Verify auth is wired correctly — should return 401
curl -X GET "https://wageronweather.com/api/cron/forecast-quality?action=quality-report"
```

## 5. Response shape

Successful run:

```json
{
  "ok": true,
  "action": "quality-report",
  "status": "ran",
  "summary": "Quality report bqr-...: scored 11 of 12 eligible cities across 1 provider(s).",
  "reportId": "bqr-...",
  "seedCityCount": 12,
  "eligibleCityCount": 12,
  "scoredCityCount": 11,
  "providerCount": 1,
  "topIssueCount": 0,
  "warningCount": 1,
  "timestamp": "2026-05-08T11:30:00.000Z"
}
```

Skipped run:

```json
{
  "ok": true,
  "action": "seeded-comparison",
  "status": "skipped",
  "reason": "cadence_guard",
  "summary": "Cadence guard: last successful run at 2026-05-08T05:00:00.000Z; min interval 4h. Use ?force=true to override.",
  "lastSeededComparisonRanAt": "2026-05-08T05:00:00.000Z",
  "timestamp": "2026-05-08T07:00:00.000Z"
}
```

Failure (e.g., upstream API down):

```json
{
  "ok": false,
  "action": "seeded-comparison",
  "status": "failed",
  "message": "Open-Meteo network error: ETIMEDOUT",
  "timestamp": "..."
}
```

## 6. Visibility

The `/admin/system/forecast-provider-comparison` "Batch Reports" tab now shows a "Scheduled automation" panel at the top with the last seeded-comparison and last quality-report timestamps + status + summary, plus the most recent cron-level failure. The cron-state record is read via `?action=get-cron-state` on the existing admin API.

## 7. Security notes

- The endpoint **never** returns or logs the secret value.
- Refusing when no secret is configured (rather than allowing) prevents accidental open access on a misconfigured environment.
- The endpoint does not call any settlement, grading, wallet, betting, or pricing code path. It only invokes the Step 137/138 batch runners which are admin-scope and read-only against `nws-observations.ts`.
- No customer-facing surface imports the cron endpoint or the cron-state module.
- Rotating the secret is a one-step operation: update `CRON_SECRET` (or `FORECAST_QUALITY_CRON_SECRET`) on Vercel, redeploy. Vercel Cron picks up the new value on the next invocation.

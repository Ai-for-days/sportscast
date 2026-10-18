# Betting System Quick Start (2 min)

## Start Dev Server
```bash
cd C:\Users\derek\sportscast
npm run dev
```
→ Open http://localhost:4321/weatherboard

## Test Features

### 1. Sign Up
```
http://localhost:4321/auth/register
Email: test@example.com
Password: testpass123
→ Get $100,000 play money automatically
```

### 2. Place a Bet
```
/weatherboard page:
1. Betting sidebar appears (right on desktop, bottom on mobile)
2. Select sport dropdown
3. Click odds to add legs
4. Enter stake ($10 default)
5. Click "Place Bet"
→ Balance updates in real-time
```

### 3. Check Balance
```
/account page:
→ Shows current balance + betting sidebar
```

## API Quick Test

### Get Balance
```bash
curl -b "auth_session=YOUR_SESSION" http://localhost:4321/api/account/balance
```

### Get Games
```bash
curl "http://localhost:4321/api/sportsbook/games?sport=football/nfl"
```
(Requires Practice Sportsbook scraper running at localhost:8765)

### Place Bet
```bash
curl -X POST http://localhost:4321/api/bets/place \
  -b "auth_session=YOUR_SESSION" \
  -H "Content-Type: application/json" \
  -d '{
    "legs": [{
      "gameId": "game_123",
      "gameDescription": "Team A vs Team B",
      "oddsType": "moneyline",
      "side": "away",
      "odds": -110
    }],
    "stake": 50
  }'
```

## Run Tests
```bash
npm test
→ All 560 tests should pass
```

## Build for Production
```bash
npm run build
→ Vercel-ready output in ./dist/
```

## Responsive Design

| Device | Behavior |
|--------|----------|
| Desktop (1024px+) | Sticky sidebar on right |
| Tablet (640-1024px) | Bottom sheet (50vh) |
| Mobile (<640px) | Bottom sheet (40vh) |

## File Locations

| What | Where |
|------|-------|
| Betting components | `src/components/betting/` |
| API endpoints | `src/pages/api/bets/`, `src/pages/api/account/` |
| Auth/signup | `src/pages/api/auth/` |
| Optimization | `src/lib/open-meteo*.ts`, `src/lib/openweather.ts` |

## Environment Variables (.env.local)

```env
# Redis (required for balance/bets)
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...

# Google OAuth (optional)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# Admin (optional)
ADMIN_SECRET=your-secret

# API optimization (optional)
OPENWEATHER_API_KEY=...
CONSENSUS_FORECAST_ENABLED=true
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Games endpoint returns error" | Start Practice Sportsbook scraper at localhost:8765 |
| "401 Not authenticated" | Log in at http://localhost:4321/auth/login |
| "Insufficient balance" | Create new account (auto-gets $100,000) |
| Build errors | Run `npm install` then `npm run build` |
| Test failures | Check Redis credentials in `.env.local` |

## Key Stats

- **Load time:** 29s → 5s (with all phases)
- **API calls:** ~10k/day → ~50-100/day (99% reduction)
- **Tests:** 560/560 passing
- **Responsive:** Works on all devices
- **Resilience:** Dual-provider forecasting (Open-Meteo + OpenWeather)

---

**Full docs:** See `BETTING_SYSTEM_SETUP.md`

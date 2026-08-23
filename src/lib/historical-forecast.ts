// ── Historical forecast backfill (Open-Meteo Previous Runs API) ──────────
//
// getForecastAccuracyWriteup (game-forecast-accuracy.ts) needs an honest
// answer to "what would Wager on Weather have forecast for kickoff" for
// EVERY finished game, not just ones rendered while still upcoming after
// the live-snapshot mechanism shipped — which, on day one, excluded nearly
// every game that had already kicked off (see that file's own comments).
//
// Re-running today's forecast model for a past hour would be cheating: by
// the time we check a finished game, the model has already converged
// toward the known outcome, so it would look artificially accurate. Open-
// Meteo's Previous Runs API sidesteps that by archiving each day's actual
// model output at a FIXED lead time — the `_previous_day1` suffix on any
// variable returns exactly what the model predicted 24 hours before the
// valid time, taken from that day's real historical model run. That's a
// genuine pre-game forecast, not hindsight, so it's safe to use here.
//
// Docs: https://open-meteo.com/en/docs/previous-runs-api

import { wmoCodeToDescription } from './open-meteo';
import type { KickoffSnapshot } from './game-forecast-accuracy';

const PREVIOUS_RUNS_URL = 'https://previous-runs-api.open-meteo.com/v1/forecast';

/**
 * Reconstructs what Wager on Weather would have forecast ~24 hours ahead of
 * kickoff, for any past game — used only when no live snapshot was ever
 * saved (see getKickoffSnapshot). Returns null on any failure; this is a
 * best-effort backfill, never load-bearing for anything but a "nice to
 * have" write-up.
 */
export async function fetchBackfilledSnapshot(lat: number, lon: number, kickoffUTC: string): Promise<KickoffSnapshot | null> {
  const kickoffMs = Date.parse(kickoffUTC);
  if (!Number.isFinite(kickoffMs)) return null;

  const dayMs = 86400000;
  // A 3-day UTC window bracketing kickoff, so the exact instant is covered
  // regardless of where it falls relative to a UTC calendar-day boundary.
  const startDate = new Date(kickoffMs - dayMs).toISOString().slice(0, 10);
  const endDate = new Date(kickoffMs + dayMs).toISOString().slice(0, 10);

  const url =
    `${PREVIOUS_RUNS_URL}?latitude=${lat}&longitude=${lon}` +
    `&hourly=temperature_2m_previous_day1,wind_speed_10m_previous_day1,precipitation_probability_previous_day1,weather_code_previous_day1` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&start_date=${startDate}&end_date=${endDate}&timezone=UTC`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    const times: string[] = data?.hourly?.time ?? [];
    const temps: (number | null)[] = data?.hourly?.temperature_2m_previous_day1 ?? [];
    const winds: (number | null)[] = data?.hourly?.wind_speed_10m_previous_day1 ?? [];
    const precips: (number | null)[] = data?.hourly?.precipitation_probability_previous_day1 ?? [];
    const codes: (number | null)[] = data?.hourly?.weather_code_previous_day1 ?? [];
    if (times.length === 0) return null;

    // Nearest hour to kickoff (times are UTC, no offset math needed since
    // the request was made with timezone=UTC).
    let bestIdx = -1;
    let bestDiff = Infinity;
    for (let i = 0; i < times.length; i++) {
      const ms = Date.parse(`${times[i]}Z`);
      if (!Number.isFinite(ms)) continue;
      const diff = Math.abs(ms - kickoffMs);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) return null;

    const tempF = temps[bestIdx];
    const windSpeedMph = winds[bestIdx];
    const precipProbability = precips[bestIdx];
    const code = codes[bestIdx];
    if (typeof tempF !== 'number' || typeof windSpeedMph !== 'number' || typeof precipProbability !== 'number') return null;

    return {
      tempF,
      windSpeedMph,
      precipProbability: Math.round(precipProbability),
      description: typeof code === 'number' ? wmoCodeToDescription(code) : 'Unknown',
    };
  } catch {
    return null;
  }
}

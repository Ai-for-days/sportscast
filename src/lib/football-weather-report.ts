// Shared render helpers for the weekly football weather-report pages
// (/college-football-weather and /nfl-weather). Pure functions — the pages fetch
// the schedule + forecasts, then use these to resolve game-day weather, sort,
// label kickoffs, and produce the factual (NEUTRAL — no betting advice) note.

import type { FootballGame } from './espn-football-schedule';
import type { ForecastResponse, DailyForecast } from './types';

export type ImpactTone = 'none' | 'moderate' | 'high';

/**
 * The daily forecast for a game's venue-local date. Games span the week, so
 * `current` conditions are the wrong day — resolve the game day via the
 * forecast's UTC offset. No match = the game is outside the forecast horizon
 * (e.g. offseason / a month out) → null, so the card shows "forecast closer to
 * kickoff" rather than today's (wrong-day) weather.
 */
export function gameDayForecast(game: FootballGame, f: ForecastResponse | undefined): DailyForecast | null {
  if (!game.venue || !f) return null;
  const kickMs = Date.parse(game.kickoffUTC);
  if (!Number.isFinite(kickMs)) return null;
  const localDate = new Date(kickMs + (f.utcOffsetSeconds ?? 0) * 1000).toISOString().slice(0, 10);
  return f.daily?.find((d) => d.date === localDate) ?? null;
}

/** Best (lowest) AP/CFP rank across the two teams; 99 = both unranked. */
export function bestRank(game: FootballGame): number {
  return Math.min(game.homeRank ?? 99, game.awayRank ?? 99);
}

/** Weekday + ET kickoff time, or the ESPN status detail for finished games. */
export function kickoffLabel(game: FootballGame, timeZone: string): string {
  if (game.state === 'post') return game.statusDetail || 'Final';
  if (!game.kickoffUTC) return 'TBD';
  try {
    const d = new Date(game.kickoffUTC);
    const day = d.toLocaleDateString('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' });
    const time = d.toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });
    return `${day} · ${time} ET`;
  } catch {
    return 'TBD';
  }
}

/** Factual, football-specific weather note (NEUTRAL — no betting advice). */
export function footballWeatherNote(game: FootballGame, day: DailyForecast | null): { text: string; tone: ImpactTone } {
  if (!game.venue) return { text: '', tone: 'none' };
  if (game.venue.type === 'indoor')
    return { text: 'Indoor stadium — the game is played in controlled conditions, so weather is not a factor.', tone: 'none' };
  if (!day)
    return {
      text: `${game.venue.type === 'retractable' ? 'Retractable roof — depends on whether it is open. ' : ''}Forecast available closer to kickoff.`,
      tone: 'none',
    };

  const parts: string[] = [];
  let tone: ImpactTone = 'none';
  const bump = (t: 'moderate' | 'high') => {
    tone = tone === 'high' || t === 'high' ? 'high' : 'moderate';
  };

  const wind = day.windSpeedMph;
  if (wind >= 20) {
    parts.push(`${Math.round(wind)} mph wind can significantly affect the passing and kicking game`);
    bump('high');
  } else if (wind >= 13) {
    parts.push(`a ${Math.round(wind)} mph breeze may nudge deep passes and field goals`);
    bump('moderate');
  }

  if (day.highF <= 32) {
    parts.push('freezing temperatures affect grip, ball handling, and kicking');
    bump('high');
  } else if (day.highF <= 45) {
    parts.push('cold conditions can stiffen grip and shorten kicks');
    bump('moderate');
  } else if (day.highF >= 90) {
    parts.push('high heat raises fatigue and cramping risk, especially early in the season');
    bump('moderate');
  }

  if (day.precipProbability >= 50) {
    parts.push(`${day.precipProbability}% rain chance — a wet ball and slick footing affect passing and ball security`);
    bump('high');
  } else if (day.precipProbability >= 30) {
    parts.push(`${day.precipProbability}% rain chance may bring damp conditions`);
    bump('moderate');
  }

  if (game.venue.type === 'retractable') parts.unshift('retractable roof may be open or closed');

  const text = parts.length
    ? parts.join('; ').replace(/^./, (s) => s.toUpperCase()) + '.'
    : 'Calm, mild conditions with little effect on play.';
  return { text, tone };
}

export const IMPACT_TONE_CLASS: Record<ImpactTone, string> = {
  none: 'bg-field/10 text-field-dark dark:text-field-light',
  moderate: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  high: 'bg-red-500/15 text-red-600 dark:text-red-400',
};

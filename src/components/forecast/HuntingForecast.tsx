import { useState, useMemo } from 'react';
import type { ForecastPoint } from '../../lib/types';
import { calculateSolunar } from '../../lib/solunar';
import { getAllHuntForecasts, huntSpeciesConfigs } from '../../lib/hunting-forecast';
import type { GameSpecies, HuntForecast } from '../../lib/types';

interface Props {
  forecast: ForecastPoint;
  tomorrowForecast: ForecastPoint;
  lat: number;
  lon: number;
  utcOffsetSeconds: number;
  today: string; // ISO date string
  tomorrowDate: string; // ISO date string for tomorrow
  state: string;
  locationName?: string;
}

const speciesIcons: Record<GameSpecies, string> = {
  whitetail: '🦌',
  duck: '🦆',
  turkey: '🦃',
  elk: '🫎',
  moose: '🫎',
  mule_deer: '🦌',
  wild_boar: '🐗',
  pheasant: '🐓',
};

const ratingColors: Record<string, { bg: string; text: string; border: string; bar: string }> = {
  excellent: { bg: 'bg-field/10', text: 'text-field-dark', border: 'border-field/30', bar: 'bg-field' },
  good: { bg: 'bg-field/10', text: 'text-field-dark', border: 'border-field/20', bar: 'bg-field/70' },
  fair: { bg: 'bg-heat/10', text: 'text-heat-dark', border: 'border-heat/30', bar: 'bg-heat' },
  poor: { bg: 'bg-alert/10', text: 'text-alert-dark', border: 'border-alert/30', bar: 'bg-alert' },
};

const impactIcons: Record<string, string> = {
  positive: '▲',
  neutral: '●',
  negative: '▼',
};

const impactColors: Record<string, string> = {
  positive: 'text-field',
  neutral: 'text-text-muted dark:text-text-dark-muted',
  negative: 'text-alert',
};

function parseTimeToMin(t: string): number {
  const m = t.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return -1;
  let h = parseInt(m[1]);
  const min = parseInt(m[2]);
  if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
  if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
  return h * 60 + min;
}

function HuntCard({ hunt, tomorrowHunt, utcOffsetSeconds }: { hunt: HuntForecast; tomorrowHunt?: HuntForecast; utcOffsetSeconds: number }) {
  const [expanded, setExpanded] = useState(false);
  const colors = ratingColors[hunt.activityRating];
  const config = huntSpeciesConfigs[hunt.species];
  const locationMs = Date.now() + utcOffsetSeconds * 1000;
  const locationDate = new Date(locationMs);
  const nowMin = locationDate.getUTCHours() * 60 + locationDate.getUTCMinutes();

  // Out of season — show only species name and badge, no conditions
  if (!hunt.inSeason) {
    return (
      <div className="rounded-xl border border-border bg-surface shadow-sm dark:border-border-dark dark:bg-surface-dark-alt opacity-60">
        <div className="flex flex-col items-center gap-2 p-4">
          <span className="text-3xl grayscale">{speciesIcons[hunt.species]}</span>
          <div className="font-semibold text-text dark:text-text-dark">{config.label}</div>
          <span className="rounded-full bg-text-muted/15 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-text-muted dark:bg-text-dark-muted/15 dark:text-text-dark-muted">
            Out of Season
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border bg-surface shadow-sm dark:bg-surface-dark-alt ${colors.border} border-border dark:border-border-dark`}>
      {/* Collapsed header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full flex-col items-center gap-2 p-4"
      >
        <span className="text-3xl">{speciesIcons[hunt.species]}</span>
        <div className="font-semibold text-text dark:text-text-dark">{config.label}</div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold uppercase ${colors.bg} ${colors.text}`}>
          {hunt.activityRating}
        </span>
        <div className="flex w-full items-center gap-2">
          <div className="h-2 flex-1 rounded-full bg-border/30 dark:bg-border-dark/30">
            <div
              className={`h-full rounded-full ${colors.bar}`}
              style={{ width: `${hunt.score}%` }}
            />
          </div>
          <span className="text-sm font-bold tabular-nums text-text dark:text-text-dark">{hunt.score}</span>
        </div>
        <svg
          className={`h-5 w-5 shrink-0 text-text-muted transition-transform dark:text-text-dark-muted ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-3 dark:border-border-dark">
          {/* Best Times */}
          {hunt.bestTimes.length > 0 && (
            <div className="mb-3 text-center">
              <div className="text-xs font-semibold uppercase tracking-wide text-text-muted dark:text-text-dark-muted mb-1.5">
                Best Times — Local (Solunar)
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {hunt.bestTimes.map((p, i) => {
                  const isPassed = nowMin > parseTimeToMin(p.end);
                  return (
                    <span
                      key={i}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                        p.type === 'major'
                          ? 'bg-field/10 text-field-dark'
                          : 'bg-sky/10 text-sky-dark'
                      }${isPassed ? ' line-through opacity-50' : ''}`}
                    >
                      {p.type === 'major' ? '★' : '☆'} {p.label}: {p.start}–{p.end}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Key Factors */}
          <div className="mb-3">
            <div className="text-center text-xs font-semibold uppercase tracking-wide text-text-muted dark:text-text-dark-muted mb-1.5">
              Key Factors
            </div>
            <div className="space-y-1">
              {hunt.keyFactors.map((f, i) => (
                <div key={i} className="flex items-center justify-center gap-2 text-sm">
                  <span className={`text-xs ${impactColors[f.impact]}`}>
                    {impactIcons[f.impact]}
                  </span>
                  <span className="font-medium text-text dark:text-text-dark w-24 shrink-0 text-right">{f.label}</span>
                  <span className="text-text-muted dark:text-text-dark-muted w-40 shrink-0">{f.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Tips */}
          {hunt.tips.length > 0 && (
            <div className="text-center">
              <div className="text-xs font-semibold uppercase tracking-wide text-text-muted dark:text-text-dark-muted mb-1.5">
                Tips
              </div>
              <ul className="space-y-1 inline-block text-left">
                {hunt.tips.map((tip, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-text-muted dark:text-text-dark-muted">
                    <span className="mt-0.5 shrink-0 text-field">•</span>
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Tomorrow Section */}
          {tomorrowHunt && tomorrowHunt.inSeason && (
            <div className="mt-4 border-t border-border/50 pt-3 dark:border-border-dark/50">
              <div className="mb-3 flex items-center justify-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-text-muted/70 dark:text-text-dark-muted/70">
                  Tomorrow
                </span>
                {(() => {
                  const tmColors = ratingColors[tomorrowHunt.activityRating];
                  return (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${tmColors.bg} ${tmColors.text}`}>
                      {tomorrowHunt.activityRating} &middot; {tomorrowHunt.score}
                    </span>
                  );
                })()}
              </div>

              {/* Tomorrow Best Times */}
              {tomorrowHunt.bestTimes.length > 0 && (
                <div className="mb-3 text-center opacity-80">
                  <div className="text-xs font-semibold uppercase tracking-wide text-text-muted dark:text-text-dark-muted mb-1.5">
                    Best Times — Local (Solunar)
                  </div>
                  <div className="flex flex-wrap justify-center gap-2">
                    {tomorrowHunt.bestTimes.map((p, i) => (
                      <span
                        key={i}
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                          p.type === 'major'
                            ? 'bg-field/10 text-field-dark'
                            : 'bg-sky/10 text-sky-dark'
                        }`}
                      >
                        {p.type === 'major' ? '★' : '☆'} {p.label}: {p.start}–{p.end}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Tomorrow Key Factors */}
              <div className="mb-3 opacity-80">
                <div className="text-center text-xs font-semibold uppercase tracking-wide text-text-muted dark:text-text-dark-muted mb-1.5">
                  Key Factors
                </div>
                <div className="space-y-1">
                  {tomorrowHunt.keyFactors.map((f, i) => (
                    <div key={i} className="flex items-center justify-center gap-2 text-sm">
                      <span className={`text-xs ${impactColors[f.impact]}`}>
                        {impactIcons[f.impact]}
                      </span>
                      <span className="font-medium text-text dark:text-text-dark w-24 shrink-0 text-right">{f.label}</span>
                      <span className="text-text-muted dark:text-text-dark-muted w-40 shrink-0">{f.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tomorrow Tips */}
              {tomorrowHunt.tips.length > 0 && (
                <div className="text-center opacity-80">
                  <div className="text-xs font-semibold uppercase tracking-wide text-text-muted dark:text-text-dark-muted mb-1.5">
                    Tips
                  </div>
                  <ul className="space-y-1 inline-block text-left">
                    {tomorrowHunt.tips.map((tip, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-text-muted dark:text-text-dark-muted">
                        <span className="mt-0.5 shrink-0 text-field">•</span>
                        {tip}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function HuntingForecast({ forecast, tomorrowForecast, lat, lon, utcOffsetSeconds, today, tomorrowDate, state, locationName }: Props) {
  const month = new Date(today).getMonth() + 1; // 1-12
  const tomorrowMonth = new Date(tomorrowDate).getMonth() + 1;

  const huntForecasts = useMemo(() => {
    const solunar = calculateSolunar(lat, lon, utcOffsetSeconds, today);
    return getAllHuntForecasts(forecast, solunar, state, month);
  }, [forecast, lat, lon, utcOffsetSeconds, today, state, month]);

  const tomorrowHuntForecasts = useMemo(() => {
    const tomorrowSolunar = calculateSolunar(lat, lon, utcOffsetSeconds, tomorrowDate);
    return getAllHuntForecasts(tomorrowForecast, tomorrowSolunar, state, tomorrowMonth);
  }, [tomorrowForecast, lat, lon, utcOffsetSeconds, tomorrowDate, state, tomorrowMonth]);

  // Build lookup by species for tomorrow data
  const tomorrowBySpecies = useMemo(() => {
    const map = new Map<GameSpecies, HuntForecast>();
    for (const h of tomorrowHuntForecasts) map.set(h.species, h);
    return map;
  }, [tomorrowHuntForecasts]);

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm dark:border-border-dark dark:bg-surface-dark-alt">
      <div className="mb-4 flex items-center justify-center gap-2">
        <span className="text-xl">🦌</span>
        <h3 className="text-lg font-semibold text-text dark:text-text-dark">Hunting Forecast{locationName ? ` for ${locationName}` : ''}</h3>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {huntForecasts.map(hunt => (
          <HuntCard key={hunt.species} hunt={hunt} tomorrowHunt={tomorrowBySpecies.get(hunt.species)} utcOffsetSeconds={utcOffsetSeconds} />
        ))}
      </div>
    </div>
  );
}

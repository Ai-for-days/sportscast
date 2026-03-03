import { useState, useEffect } from 'react';
import type { ForecastPoint } from '../../lib/types';
import { analyzeBettingWeather, getLeanLabel, type WeatherConditions, type BettingAnalysis, type ImpactLevel, type BettingLean } from '../../lib/betting-weather';

interface Props {
  hourly?: ForecastPoint[];
  lat: number;
  lon: number;
  cityName: string;
  stateName: string;
}

const LEVEL_COLORS: Record<ImpactLevel, string> = {
  none: 'bg-field/10 text-field-dark',
  moderate: 'bg-heat/10 text-heat-dark',
  high: 'bg-alert/10 text-alert-dark',
};

const LEAN_COLORS: Record<BettingLean, string> = {
  under: 'text-sky-600',
  over: 'text-red-600',
  underdog: 'text-amber-600',
  neutral: 'text-gray-400',
  possible_over_value: 'text-purple-600',
};

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function roundTo15(minutes: number): number {
  return Math.round(minutes / 15) * 15;
}

function buildTimeOptions(): string[] {
  const opts: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      opts.push(`${pad2(h)}:${pad2(m)}`);
    }
  }
  return opts;
}

const TIME_OPTIONS = buildTimeOptions();

export default function SportsMetrics({ hourly, lat, lon, cityName, stateName }: Props) {
  const now = new Date();
  const [selectedDate, setSelectedDate] = useState(toLocalDateStr(now));
  const [selectedTime, setSelectedTime] = useState(
    `${pad2(now.getHours())}:${pad2(roundTo15(now.getMinutes()) % 60)}`
  );
  const [analysis, setAnalysis] = useState<BettingAnalysis | null>(null);
  const [conditions, setConditions] = useState<WeatherConditions | null>(null);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<'forecast' | 'historical'>('forecast');

  useEffect(() => {
    let cancelled = false;

    async function analyze() {
      setLoading(true);

      const targetDateTime = new Date(`${selectedDate}T${selectedTime}:00`);
      const nowMs = Date.now();
      const diffDays = (targetDateTime.getTime() - nowMs) / (1000 * 60 * 60 * 24);

      let wx: WeatherConditions | null = null;
      let dataSource: 'forecast' | 'historical' = 'forecast';

      if (diffDays <= 15 && hourly && hourly.length > 0) {
        // Find closest hourly point to selected date/time
        const targetIso = `${selectedDate}T${selectedTime}`;
        let bestIdx = 0;
        let bestDiff = Infinity;
        for (let i = 0; i < hourly.length; i++) {
          const diff = Math.abs(new Date(hourly[i].time).getTime() - targetDateTime.getTime());
          if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
        }
        const h = hourly[bestIdx];
        wx = {
          tempF: h.tempF,
          windSpeedMph: h.windSpeedMph,
          windGustMph: h.windGustMph,
          precipProbability: h.precipProbability,
          humidity: h.humidity,
          description: h.description,
        };
        dataSource = 'forecast';
      } else {
        // Beyond 15 days — fetch historical averages
        try {
          const targetD = new Date(selectedDate);
          const month = targetD.getMonth() + 1;
          const day = targetD.getDate();
          const res = await fetch(`/api/weather/historical-averages?lat=${lat}&lon=${lon}&month=${month}&day=${day}`);
          if (res.ok) {
            const data = await res.json();
            wx = {
              tempF: data.tempF,
              windSpeedMph: data.windSpeedMph,
              windGustMph: data.windGustMph,
              precipProbability: data.precipProbability,
              humidity: data.humidity,
            };
            dataSource = 'historical';
          }
        } catch {
          // Failed to fetch historical
        }
      }

      if (cancelled) return;

      if (wx) {
        setConditions(wx);
        setAnalysis(analyzeBettingWeather(wx));
        setSource(dataSource);
      } else {
        setConditions(null);
        setAnalysis(null);
      }
      setLoading(false);
    }

    analyze();
    return () => { cancelled = true; };
  }, [selectedDate, selectedTime, hourly, lat, lon]);

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm dark:border-border-dark dark:bg-surface-dark-alt">
      <h3 className="mb-4 text-lg font-semibold text-text dark:text-text-dark">
        Weather's Impact on Sports Betting in {cityName}, {stateName}
      </h3>

      {/* Date/Time Picker */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-text-muted dark:text-text-dark-muted">Event Date</label>
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-muted dark:text-text-dark-muted">Event Time</label>
          <select
            value={selectedTime}
            onChange={e => setSelectedTime(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
          >
            {TIME_OPTIONS.map(t => (
              <option key={t} value={t}>
                {parseInt(t.split(':')[0]) === 0 ? '12' : parseInt(t.split(':')[0]) > 12 ? parseInt(t.split(':')[0]) - 12 : parseInt(t.split(':')[0])}
                :{t.split(':')[1]}
                {parseInt(t.split(':')[0]) >= 12 ? ' PM' : ' AM'}
              </option>
            ))}
          </select>
        </div>
        {source === 'historical' && !loading && (
          <span className="mt-5 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
            Based on 3-year historical avg
          </span>
        )}
      </div>

      {loading && (
        <div className="py-8 text-center text-sm text-text-muted dark:text-text-dark-muted">
          Analyzing weather conditions...
        </div>
      )}

      {!loading && !analysis && (
        <div className="py-8 text-center text-sm text-text-muted dark:text-text-dark-muted">
          No weather data available for this date.
        </div>
      )}

      {!loading && analysis && conditions && (
        <>
          {/* Weather conditions summary */}
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg bg-surface-dark/5 px-3 py-2 dark:bg-surface/5">
              <div className="text-xs font-medium text-text-muted dark:text-text-dark-muted">Temp</div>
              <div className="text-lg font-bold text-text dark:text-text-dark">{Math.round(conditions.tempF)}°F</div>
            </div>
            <div className="rounded-lg bg-surface-dark/5 px-3 py-2 dark:bg-surface/5">
              <div className="text-xs font-medium text-text-muted dark:text-text-dark-muted">Wind</div>
              <div className="text-lg font-bold text-text dark:text-text-dark">{Math.round(conditions.windSpeedMph)} mph</div>
            </div>
            <div className="rounded-lg bg-surface-dark/5 px-3 py-2 dark:bg-surface/5">
              <div className="text-xs font-medium text-text-muted dark:text-text-dark-muted">Precip</div>
              <div className="text-lg font-bold text-text dark:text-text-dark">{conditions.precipProbability}%</div>
            </div>
            <div className="rounded-lg bg-surface-dark/5 px-3 py-2 dark:bg-surface/5">
              <div className="text-xs font-medium text-text-muted dark:text-text-dark-muted">Humidity</div>
              <div className="text-lg font-bold text-text dark:text-text-dark">{conditions.humidity}%</div>
            </div>
          </div>

          {/* Impact summary table */}
          <div className="mb-4 overflow-hidden rounded-lg border border-border dark:border-border-dark">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-dark/5 dark:bg-surface/5">
                  <th className="px-3 py-2 text-left text-xs font-semibold text-text-muted dark:text-text-dark-muted">Factor</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-text-muted dark:text-text-dark-muted">Impact</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-text-muted dark:text-text-dark-muted">Betting Lean</th>
                </tr>
              </thead>
              <tbody>
                {analysis.factors.map((f, i) => (
                  <tr key={i} className="border-t border-border dark:border-border-dark">
                    <td className="px-3 py-2 font-medium text-text dark:text-text-dark">{f.factor}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${LEVEL_COLORS[f.level]}`}>
                        {f.level}
                      </span>
                    </td>
                    <td className={`px-3 py-2 font-semibold ${LEAN_COLORS[f.lean]}`}>
                      {getLeanLabel(f.lean)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Detail notes */}
          <div className="mb-4 space-y-2">
            {analysis.factors.filter(f => f.level !== 'none').map((f, i) => (
              <div key={i} className="flex items-start gap-2 text-sm text-text-muted dark:text-text-dark-muted">
                <span className="mt-0.5 shrink-0">{f.level === 'high' ? '⚠️' : 'ℹ️'}</span>
                <span><strong>{f.factor}:</strong> {f.detail}</span>
              </div>
            ))}
          </div>

          {/* Verdict */}
          <div className="rounded-lg border border-field/30 bg-field/5 p-4">
            <div className="mb-1 text-sm font-semibold text-field-dark">Verdict</div>
            <div className="text-sm text-text dark:text-text-dark">{analysis.verdict}</div>
            <div className="mt-2 text-xs italic text-text-muted dark:text-text-dark-muted">
              {analysis.keyInsight}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

import { useState } from 'react';
import LocationSearch from '../search/LocationSearch';
import type { GeoLocation, ForecastResponse } from '../../lib/types';
import { formatTemp, windDirectionLabel } from '../../lib/weather-utils';
import LoadingSpinner from '../ui/LoadingSpinner';
import TrendsChart from './TrendsChart';

export default function HistoricalLookup() {
  const [location, setLocation] = useState<GeoLocation | null>(null);
  const [date, setDate] = useState('');
  const [result, setResult] = useState<ForecastResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!location || !date) {
      setError('Please select a location and date');
      return;
    }
    setLoading(true);
    setError('');

    try {
      const res = await fetch(`/api/historical?lat=${location.lat}&lon=${location.lon}&date=${date}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setResult(data);
    } catch {
      setError('Failed to fetch historical data');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="rounded-xl border border-border bg-surface p-6 shadow-sm dark:border-border-dark dark:bg-surface-dark-alt">
        <h2 className="mb-4 text-xl font-bold text-text dark:text-text-dark">Historical Weather Lookup</h2>
        <p className="mb-4 text-sm text-text-muted dark:text-text-dark-muted">
          Look up past weather conditions for any location. Data available from January 1, 2022.
        </p>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-text dark:text-text-dark">Location</label>
            <LocationSearch onSelect={setLocation} />
            {location && (
              <p className="mt-1 text-xs text-text-muted dark:text-text-dark-muted">
                {location.displayName || location.name || `${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}`}
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-text dark:text-text-dark">Date</label>
            <input
              type="date"
              value={date}
              min="2022-01-01"
              max={new Date().toISOString().slice(0, 10)}
              onChange={e => setDate(e.target.value)}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={loading}
            className="rounded-lg bg-field px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-field-dark disabled:opacity-50"
          >
            {loading ? 'Looking up...' : 'Look Up Weather'}
          </button>

          {error && <p className="text-sm text-alert">{error}</p>}
        </div>
      </div>

      {loading && <LoadingSpinner label="Fetching historical data..." />}

      {!loading && result && (
        <div className="space-y-6">
          <div className="rounded-xl border border-border bg-surface p-6 shadow-sm dark:border-border-dark dark:bg-surface-dark-alt">
            <h3 className="mb-4 text-lg font-semibold text-text dark:text-text-dark">
              Weather on {new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            </h3>

            {result.daily.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
                <div className="rounded-lg bg-heat/5 px-4 py-3">
                  <div className="text-xs text-text-muted dark:text-text-dark-muted">High</div>
                  <div className="text-2xl font-bold text-text dark:text-text-dark">{formatTemp(result.daily[0].highF)}</div>
                </div>
                <div className="rounded-lg bg-sky/5 px-4 py-3">
                  <div className="text-xs text-text-muted dark:text-text-dark-muted">Low</div>
                  <div className="text-2xl font-bold text-text dark:text-text-dark">{formatTemp(result.daily[0].lowF)}</div>
                </div>
                <div className="rounded-lg bg-field/5 px-4 py-3">
                  <div className="text-xs text-text-muted dark:text-text-dark-muted">Wind</div>
                  <div className="text-2xl font-bold text-text dark:text-text-dark">{result.daily[0].windSpeedMph} mph</div>
                </div>
                <div className="rounded-lg bg-storm/5 px-4 py-3">
                  <div className="text-xs text-text-muted dark:text-text-dark-muted">Precipitation</div>
                  <div className="text-2xl font-bold text-text dark:text-text-dark">{result.daily[0].precipMm} mm</div>
                </div>
              </div>
            )}

            {result.hourly.length > 0 && (
              <div className="mt-6">
                <h4 className="mb-3 text-sm font-semibold text-text dark:text-text-dark">Hourly Conditions</h4>
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {result.hourly.map((pt, i) => (
                    <div key={i} className="flex shrink-0 flex-col items-center gap-1 text-xs">
                      <span className="text-text-muted dark:text-text-dark-muted">
                        {new Date(pt.time).getHours()}:00
                      </span>
                      <span className="text-lg">{pt.icon}</span>
                      <span className="font-semibold text-text dark:text-text-dark">{pt.tempF}°</span>
                      <span className="text-text-muted dark:text-text-dark-muted">{pt.windSpeedMph}mph</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <TrendsChart hourly={result.hourly} />
        </div>
      )}
    </div>
  );
}

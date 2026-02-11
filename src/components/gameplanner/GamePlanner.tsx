import { useState, useEffect } from 'react';
import LocationSearch from '../search/LocationSearch';
import EnsembleSpread from './EnsembleSpread';
import Recommendation from './Recommendation';
import type { GeoLocation, ForecastResponse, EnsembleForecast, SportType } from '../../lib/types';
import { assessPlayability, formatTemp } from '../../lib/weather-utils';
import LoadingSpinner from '../ui/LoadingSpinner';

const sportOptions: { value: SportType; label: string }[] = [
  { value: 'baseball', label: 'Baseball' },
  { value: 'football', label: 'Football' },
  { value: 'soccer', label: 'Soccer' },
  { value: 'tennis', label: 'Tennis' },
  { value: 'golf', label: 'Golf' },
  { value: 'youth', label: 'Youth Sports' },
];

export default function GamePlanner() {
  const [location, setLocation] = useState<GeoLocation | null>(null);
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('12:00');
  const [sport, setSport] = useState<SportType>('youth');
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [ensemble, setEnsemble] = useState<EnsembleForecast[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Read URL params on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const lat = params.get('lat');
    const lon = params.get('lon');
    const d = params.get('date');
    const s = params.get('start');
    const e = params.get('end');

    if (lat && lon) {
      setLocation({ lat: parseFloat(lat), lon: parseFloat(lon) });
    }
    if (d) setDate(d);
    if (s) setStartTime(s);
    if (e) setEndTime(e);
  }, []);

  const handleSubmit = async () => {
    if (!location || !date) {
      setError('Please select a location and date');
      return;
    }
    setLoading(true);
    setError('');

    const startISO = `${date}T${startTime}:00`;
    const endISO = `${date}T${endTime}:00`;

    // Update URL
    const params = new URLSearchParams({
      lat: String(location.lat),
      lon: String(location.lon),
      date,
      start: startTime,
      end: endTime,
    });
    window.history.replaceState({}, '', `?${params}`);

    try {
      const [forecastRes, ensembleRes] = await Promise.all([
        fetch(`/api/forecast?lat=${location.lat}&lon=${location.lon}&days=15`),
        fetch(`/api/ensemble?lat=${location.lat}&lon=${location.lon}&start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`),
      ]);

      if (!forecastRes.ok || !ensembleRes.ok) {
        throw new Error('Failed to fetch data');
      }

      const [forecastData, ensembleData] = await Promise.all([forecastRes.json(), ensembleRes.json()]);
      setForecast(forecastData);
      setEnsemble(ensembleData);
    } catch {
      setError('Failed to fetch forecast data. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Find the forecast point closest to game start time
  const gameTimeForecast = forecast?.hourly.find(pt => {
    const ptDate = pt.time.slice(0, 10);
    const ptHour = new Date(pt.time).getHours();
    const startHour = parseInt(startTime.split(':')[0]);
    return ptDate === date && ptHour === startHour;
  });

  const metrics = gameTimeForecast ? assessPlayability(gameTimeForecast, sport) : null;

  const handleCopyToClipboard = () => {
    if (!gameTimeForecast || !metrics || !ensemble) return;
    const text = [
      `Game Day Weather Report — SportsCast`,
      `Location: ${location?.displayName || `${location?.lat}, ${location?.lon}`}`,
      `Date: ${date}  |  Time: ${startTime} - ${endTime}  |  Sport: ${sport}`,
      ``,
      `Recommendation: ${metrics.recommendation.toUpperCase()} (${metrics.playability})`,
      `Temperature: ${formatTemp(gameTimeForecast.tempF)} (feels like ${formatTemp(gameTimeForecast.feelsLikeF)})`,
      `Wind: ${gameTimeForecast.windSpeedMph} mph, gusts ${gameTimeForecast.windGustMph} mph`,
      `Precipitation: ${gameTimeForecast.precipProbability}% chance`,
      metrics.heatIndex !== null ? `Heat Index: ${formatTemp(metrics.heatIndex)}` : '',
      metrics.windChill !== null ? `Wind Chill: ${formatTemp(metrics.windChill)}` : '',
      ``,
      `Ensemble spread: ${ensemble[0]?.p10.tempF}°F - ${ensemble[0]?.p90.tempF}°F`,
      ``,
      ...metrics.sportNotes.map(n => `- ${n}`),
      ``,
      `Powered by SportsCast + WeatherNext 2`,
    ].filter(Boolean).join('\n');
    navigator.clipboard.writeText(text);
  };

  // Default date to tomorrow
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const defaultDate = tomorrow.toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Input form */}
      <div className="rounded-xl border border-border bg-surface p-6 shadow-sm dark:border-border-dark dark:bg-surface-dark-alt">
        <h2 className="mb-4 text-xl font-bold text-text dark:text-text-dark">Game Day Setup</h2>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-text dark:text-text-dark">Location</label>
            <LocationSearch onSelect={setLocation} />
            {location && (
              <p className="mt-1 text-xs text-text-muted dark:text-text-dark-muted">
                Selected: {location.lat.toFixed(4)}, {location.lon.toFixed(4)}
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-text dark:text-text-dark">Date</label>
              <input
                type="date"
                value={date || defaultDate}
                onChange={e => setDate(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-text dark:text-text-dark">Start Time</label>
              <input
                type="time"
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-text dark:text-text-dark">End Time</label>
              <input
                type="time"
                value={endTime}
                onChange={e => setEndTime(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-text dark:text-text-dark">Sport</label>
              <select
                value={sport}
                onChange={e => setSport(e.target.value as SportType)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
              >
                {sportOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full rounded-lg bg-field px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-field-dark disabled:opacity-50 sm:w-auto"
          >
            {loading ? 'Loading...' : 'Get Forecast'}
          </button>

          {error && (
            <p className="text-sm text-alert">{error}</p>
          )}
        </div>
      </div>

      {loading && <LoadingSpinner label="Fetching ensemble forecast data..." />}

      {/* Results */}
      {!loading && forecast && ensemble && gameTimeForecast && metrics && (
        <div className="space-y-6">
          {/* Game time summary */}
          <div className="rounded-xl border border-border bg-gradient-to-r from-field/5 to-sky/5 p-6 shadow-sm dark:border-border-dark">
            <h3 className="mb-3 text-lg font-semibold text-text dark:text-text-dark">
              Game Time: {startTime} - {endTime}
            </h3>
            <div className="flex flex-wrap gap-6">
              <div>
                <div className="text-4xl">{gameTimeForecast.icon}</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-text dark:text-text-dark">{formatTemp(gameTimeForecast.tempF)}</div>
                <div className="text-sm text-text-muted dark:text-text-dark-muted">Feels like {formatTemp(gameTimeForecast.feelsLikeF)}</div>
              </div>
              <div>
                <div className="text-sm text-text-muted dark:text-text-dark-muted">Wind</div>
                <div className="font-semibold text-text dark:text-text-dark">{gameTimeForecast.windSpeedMph} mph</div>
                <div className="text-xs text-text-muted dark:text-text-dark-muted">Gusts {gameTimeForecast.windGustMph} mph</div>
              </div>
              <div>
                <div className="text-sm text-text-muted dark:text-text-dark-muted">Rain</div>
                <div className="font-semibold text-text dark:text-text-dark">{gameTimeForecast.precipProbability}%</div>
              </div>
              <div>
                <div className="text-sm text-text-muted dark:text-text-dark-muted">Humidity</div>
                <div className="font-semibold text-text dark:text-text-dark">{gameTimeForecast.humidity}%</div>
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Recommendation metrics={metrics} />
            <EnsembleSpread ensemble={ensemble} />
          </div>

          {/* Share */}
          <div className="flex gap-3">
            <button
              onClick={handleCopyToClipboard}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-surface-alt dark:border-border-dark dark:text-text-dark-muted dark:hover:bg-surface-dark"
            >
              Copy Summary to Clipboard
            </button>
            <button
              onClick={() => navigator.clipboard.writeText(window.location.href)}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-surface-alt dark:border-border-dark dark:text-text-dark-muted dark:hover:bg-surface-dark"
            >
              Copy Share Link
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

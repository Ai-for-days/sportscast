import { useState, useEffect, useRef, useCallback } from 'react';
import type { ForecastEntry, ForecastMetric } from '../../lib/forecast-tracker-types';
import { METRIC_LABELS, METRIC_UNITS, metricNeedsTime, formatLeadTime } from '../../lib/forecast-tracker-types';

const METRICS: ForecastMetric[] = ['actual_temp', 'high_temp', 'low_temp', 'wind_speed', 'wind_gust'];

interface LocationSuggestion {
  display_name: string;
  lat: string;
  lon: string;
}

export default function ForecastTracker() {
  const [entries, setEntries] = useState<ForecastEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [locationName, setLocationName] = useState('');
  const [selectedMetrics, setSelectedMetrics] = useState<Set<ForecastMetric>>(new Set(['high_temp']));
  const [forecastValues, setForecastValues] = useState<Partial<Record<ForecastMetric, string>>>({});
  const [targetDate, setTargetDate] = useState('');
  const [targetTime, setTargetTime] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formMsg, setFormMsg] = useState<string | null>(null);

  // Location autocomplete state
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchingLocation, setSearchingLocation] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locationRef = useRef<HTMLDivElement>(null);

  // Verify state
  const [verifying, setVerifying] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);

  const fetchEntries = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/forecasts');
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchEntries(); }, []);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (locationRef.current && !locationRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Location search via Nominatim
  const searchLocations = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }
    setSearchingLocation(true);
    try {
      const encoded = encodeURIComponent(query);
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encoded}&countrycodes=us&format=json&limit=5&addressdetails=1`,
        { headers: { 'User-Agent': 'WagerOnWeather/1.0' } }
      );
      if (res.ok) {
        const data: LocationSuggestion[] = await res.json();
        setSuggestions(data);
        setShowSuggestions(data.length > 0);
      }
    } catch { /* ignore */ }
    setSearchingLocation(false);
  }, []);

  const handleLocationChange = (value: string) => {
    setLocationName(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchLocations(value), 350);
  };

  const selectSuggestion = (s: LocationSuggestion) => {
    // Shorten to "City, State" format
    const parts = s.display_name.split(', ');
    const short = parts.length >= 3
      ? `${parts[0]}, ${parts[parts.length - 3]}`
      : s.display_name;
    setLocationName(short);
    setShowSuggestions(false);
    setSuggestions([]);
  };

  // Metric checkbox toggle
  const toggleMetric = (m: ForecastMetric) => {
    setSelectedMetrics(prev => {
      const next = new Set(prev);
      if (next.has(m)) {
        next.delete(m);
        // Clean up value
        setForecastValues(fv => { const copy = { ...fv }; delete copy[m]; return copy; });
      } else {
        next.add(m);
      }
      return next;
    });
  };

  const setMetricValue = (m: ForecastMetric, val: string) => {
    setForecastValues(prev => ({ ...prev, [m]: val }));
  };

  // Whether any selected metric needs a target time
  const anyNeedsTime = Array.from(selectedMetrics).some(m => metricNeedsTime(m));

  const handleSubmit = async () => {
    if (!locationName.trim() || !targetDate || selectedMetrics.size === 0) return;
    // Validate all selected metrics have values
    const metricsToSubmit = Array.from(selectedMetrics);
    for (const m of metricsToSubmit) {
      if (!forecastValues[m] && forecastValues[m] !== '0') return;
    }

    setSubmitting(true);
    setFormMsg(null);
    const results: string[] = [];
    let hasError = false;

    for (const m of metricsToSubmit) {
      try {
        const res = await fetch('/api/admin/forecasts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            locationName: locationName.trim(),
            metric: m,
            targetDate,
            targetTime: metricNeedsTime(m) && targetTime ? targetTime : undefined,
            forecastValue: parseFloat(forecastValues[m]!),
          }),
        });
        const data = await res.json();
        if (res.ok) {
          results.push(`${METRIC_LABELS[m]}: ${formatLeadTime(data.leadTimeHours)} (${data.stationId})`);
        } else {
          results.push(`${METRIC_LABELS[m]}: Error — ${data.error}`);
          hasError = true;
        }
      } catch {
        results.push(`${METRIC_LABELS[m]}: Network error`);
        hasError = true;
      }
    }

    if (hasError) {
      setFormMsg(`Partial: ${results.join(' | ')}`);
    } else {
      setFormMsg(`Recorded ${results.length} forecast${results.length > 1 ? 's' : ''}! ${results.join(' | ')}`);
      setForecastValues({});
    }
    fetchEntries();
    setSubmitting(false);
  };

  const handleVerify = async () => {
    setVerifying(true);
    setVerifyMsg(null);
    try {
      const res = await fetch('/api/admin/forecasts/verify', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setVerifyMsg(`Verified: ${data.verified}, Skipped: ${data.skipped}${data.errors?.length ? `, Errors: ${data.errors.length}` : ''}`);
        fetchEntries();
      } else {
        setVerifyMsg(`Error: ${data.error}`);
      }
    } catch {
      setVerifyMsg('Network error');
    }
    setVerifying(false);
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/admin/forecasts?id=${id}`, { method: 'DELETE' });
    fetchEntries();
  };

  // Stats
  const verified = entries.filter(e => e.actualValue != null);
  const pending = entries.filter(e => e.actualValue == null);
  const avgAccuracy = verified.length > 0
    ? Math.round(verified.reduce((s, e) => s + (e.accuracyScore || 0), 0) / verified.length)
    : null;
  const avgWeighted = verified.length > 0
    ? Math.round(verified.reduce((s, e) => s + (e.weightedScore || 0), 0) / verified.length * 10) / 10
    : null;

  return (
    <div className="space-y-5">
      <h3 className="text-lg font-bold text-gray-900">Forecast Accuracy Tracker</h3>

      {/* Summary Stats */}
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-lg bg-gray-100 p-3 text-center">
          <div className="text-2xl font-bold text-gray-900">{entries.length}</div>
          <div className="text-xs text-gray-500">Total Forecasts</div>
        </div>
        <div className="rounded-lg bg-gray-100 p-3 text-center">
          <div className="text-2xl font-bold text-blue-600">{pending.length}</div>
          <div className="text-xs text-gray-500">Awaiting NWS</div>
        </div>
        <div className="rounded-lg bg-gray-100 p-3 text-center">
          <div className="text-2xl font-bold text-green-600">{avgAccuracy ?? '—'}{avgAccuracy != null ? '%' : ''}</div>
          <div className="text-xs text-gray-500">Avg Accuracy</div>
        </div>
        <div className="rounded-lg bg-gray-100 p-3 text-center">
          <div className="text-2xl font-bold text-purple-600">{avgWeighted ?? '—'}</div>
          <div className="text-xs text-gray-500">Avg Weighted Score</div>
        </div>
      </div>

      {/* Input Form */}
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
        <h4 className="mb-3 text-sm font-semibold text-gray-900">Record Forecast</h4>

        {/* Row 1: Location, Date, Time */}
        <div className="mb-3 flex flex-wrap items-end gap-3">
          {/* Location with autocomplete */}
          <div className="relative" ref={locationRef}>
            <label className="mb-1 block text-xs text-gray-500">Location</label>
            <input
              type="text"
              value={locationName}
              onChange={e => handleLocationChange(e.target.value)}
              onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
              placeholder="Houston, TX"
              className="w-56 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-field"
            />
            {searchingLocation && (
              <div className="absolute right-2 top-8 text-xs text-gray-400">...</div>
            )}
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute left-0 top-full z-50 mt-1 w-80 rounded-lg border border-gray-200 bg-white shadow-lg">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => selectSuggestion(s)}
                    className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-blue-50 first:rounded-t-lg last:rounded-b-lg"
                  >
                    {s.display_name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-500">Target Date</label>
            <input
              type="date"
              value={targetDate}
              onChange={e => setTargetDate(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-field"
              style={{ colorScheme: 'light' }}
            />
          </div>
          {anyNeedsTime && (
            <div>
              <label className="mb-1 block text-xs text-gray-500">Target Time</label>
              <input
                type="time"
                value={targetTime}
                onChange={e => setTargetTime(e.target.value)}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-field"
                style={{ colorScheme: 'light' }}
              />
            </div>
          )}
        </div>

        {/* Row 2: Metric checkboxes */}
        <div className="mb-3">
          <label className="mb-2 block text-xs text-gray-500">Metrics</label>
          <div className="flex flex-wrap gap-3">
            {METRICS.map(m => (
              <label key={m} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedMetrics.has(m)}
                  onChange={() => toggleMetric(m)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <span className="text-sm text-gray-700">{METRIC_LABELS[m]}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Row 3: Forecast values for each selected metric */}
        {selectedMetrics.size > 0 && (
          <div className="mb-3 flex flex-wrap items-end gap-3">
            {Array.from(selectedMetrics).map(m => (
              <div key={m}>
                <label className="mb-1 block text-xs text-gray-500">
                  {METRIC_LABELS[m]} ({METRIC_UNITS[m]})
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={forecastValues[m] || ''}
                  onChange={e => setMetricValue(m, e.target.value)}
                  placeholder="72"
                  className="w-24 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-field"
                />
              </div>
            ))}
          </div>
        )}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={submitting || !locationName.trim() || !targetDate || selectedMetrics.size === 0 ||
            Array.from(selectedMetrics).some(m => !forecastValues[m] && forecastValues[m] !== '0')}
          className="rounded-lg bg-field px-4 py-2 text-sm font-semibold text-white hover:bg-field-light disabled:opacity-50"
        >
          {submitting ? 'Saving...' : `Record ${selectedMetrics.size > 1 ? `${selectedMetrics.size} Forecasts` : 'Forecast'}`}
        </button>

        {formMsg && (
          <p className={`mt-2 text-xs ${formMsg.startsWith('Error') || formMsg.startsWith('Partial') ? 'text-red-600' : 'text-green-600'}`}>
            {formMsg}
          </p>
        )}
      </div>

      {/* Verify Button */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleVerify}
          disabled={verifying || pending.length === 0}
          className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
        >
          {verifying ? 'Checking NWS...' : `Verify Pending (${pending.length})`}
        </button>
        {verifyMsg && (
          <span className={`text-xs ${verifyMsg.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>
            {verifyMsg}
          </span>
        )}
      </div>

      {/* Results Table */}
      {loading ? (
        <div className="flex justify-center py-8">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-field/20 border-t-field" />
        </div>
      ) : entries.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-500">No forecasts recorded yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-sm text-gray-900">
            <thead className="bg-gray-100 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left">Location</th>
                <th className="px-3 py-2 text-left">Metric</th>
                <th className="px-3 py-2 text-left">Target</th>
                <th className="px-3 py-2 text-right">Our Forecast</th>
                <th className="px-3 py-2 text-right">NWS Actual</th>
                <th className="px-3 py-2 text-right">Error</th>
                <th className="px-3 py-2 text-center">Lead Time</th>
                <th className="px-3 py-2 text-center">Precision</th>
                <th className="px-3 py-2 text-right">Accuracy</th>
                <th className="px-3 py-2 text-right">Weighted</th>
                <th className="px-3 py-2 text-center">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {entries.map(e => {
                const isVerified = e.actualValue != null;
                const unit = METRIC_UNITS[e.metric];
                const precision = e.targetTime ? 'Hourly' : 'Daily';
                const precisionMult = e.precisionMultiplier ?? (e.targetTime ? 1.5 : 1.0);
                return (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium">{e.locationName}</td>
                    <td className="px-3 py-2 text-xs">{METRIC_LABELS[e.metric]}</td>
                    <td className="px-3 py-2 text-xs">
                      {e.targetDate}{e.targetTime ? ` ${e.targetTime}` : ''}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-bold">
                      {e.forecastValue}{unit}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {isVerified ? (
                        <span className="font-bold">{e.actualValue}{unit}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {isVerified ? (
                        <span className={e.errorAbs! <= 2 ? 'text-green-600' : e.errorAbs! <= 5 ? 'text-orange-500' : 'text-red-600'}>
                          {e.errorAbs! > 0 ? `${e.errorAbs}` : '0'}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className="text-xs text-gray-500" title={`${e.leadTimeMultiplier ?? '?'}x multiplier`}>
                        {formatLeadTime(e.leadTimeHours)}
                        {e.leadTimeMultiplier != null && (
                          <span className="ml-1 text-purple-500">({e.leadTimeMultiplier}x)</span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                        precision === 'Hourly' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {precision} ({precisionMult}x)
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {isVerified ? (
                        <span className={`font-bold ${
                          e.accuracyScore! >= 90 ? 'text-green-600' :
                          e.accuracyScore! >= 70 ? 'text-blue-600' :
                          e.accuracyScore! >= 50 ? 'text-orange-500' :
                          'text-red-600'
                        }`}>
                          {e.accuracyScore}%
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {isVerified ? (
                        <span className="font-bold text-purple-600">{e.weightedScore}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {isVerified ? (
                        <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                          Verified
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-semibold text-yellow-700">
                          Pending
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => handleDelete(e.id)}
                        className="text-xs text-red-500 hover:underline"
                      >
                        Del
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Scoring Legend */}
      <div className="rounded-lg bg-gray-50 p-4 text-xs text-gray-500">
        <div className="mb-1 font-semibold text-gray-700">Scoring System</div>
        <div className="grid gap-1 sm:grid-cols-2">
          <div>
            <span className="font-medium">Accuracy (0-100):</span> Temp: 100 - (error×5), Wind: 100 - (error×3.3)
          </div>
          <div>
            <span className="font-medium">Weighted Score:</span> Accuracy × Lead Time × Precision
          </div>
          <div>
            <span className="font-medium">Lead Time Multipliers:</span> &lt;1h: 1x, 1-6h: 1.5x, 6-24h: 2x, 1-3d: 3x, 3-5d: 5x, 5-7d: 7x, 7-10d: 10x, 10-14d: 13x, 14d+: 15x
          </div>
          <div>
            <span className="font-medium">Precision Bonus:</span> Daily: 1x, <span className="text-purple-600 font-semibold">Hourly: 1.5x</span> — picking the hour is harder!
          </div>
          <div>
            <span className="font-medium">Perfect 10-day hourly forecast:</span> 100 × 10x × 1.5x = <span className="font-bold text-purple-600">1,500 pts</span>
          </div>
        </div>
      </div>
    </div>
  );
}

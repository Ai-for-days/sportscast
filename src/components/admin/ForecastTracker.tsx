import { useState, useEffect, useRef, useCallback } from 'react';
import type { ForecastEntry, ForecastMetric } from '../../lib/forecast-tracker-types';
import { METRIC_LABELS, METRIC_UNITS, metricNeedsTime, formatLeadTime } from '../../lib/forecast-tracker-types';

/** Format an ISO timestamp to Eastern US time: "M/D h:mm AM ET" */
function formatET(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }) + ' ET';
  } catch {
    return iso;
  }
}

const METRICS: ForecastMetric[] = ['actual_temp', 'high_temp', 'low_temp', 'wind_speed', 'wind_gust'];

// Metric display order for grouping
const METRIC_ORDER: ForecastMetric[] = ['high_temp', 'low_temp', 'actual_temp', 'wind_speed', 'wind_gust'];

const METRIC_GROUP_LABELS: Record<string, string> = {
  high_temp: 'High Temperature',
  low_temp: 'Low Temperature',
  actual_temp: 'Temperature at Time',
  wind_speed: 'Wind Speed',
  wind_gust: 'Wind Gust',
};

interface LocationSuggestion {
  display_name: string;
  lat: string;
  lon: string;
}

type SortField = 'date' | 'forecast' | 'accuracy' | 'weighted' | 'lead';
type SortDir = 'asc' | 'desc';

interface Props {
  onImportToWager?: (data: {
    locationName: string;
    lat: number;
    lon: number;
    metric: string;
    targetDate: string;
    targetTime?: string;
    forecastValue: number;
  }) => void;
}

export default function ForecastTracker({ onImportToWager }: Props) {
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
  const [resolvedTz, setResolvedTz] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locationRef = useRef<HTMLDivElement>(null);

  // Verify state
  const [verifying, setVerifying] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);

  // Sort state
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Collapsed metric groups
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

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
    setResolvedTz(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchLocations(value), 350);
  };

  const selectSuggestion = (s: LocationSuggestion) => {
    const parts = s.display_name.split(', ');
    const short = parts.length >= 3
      ? `${parts[0]}, ${parts[parts.length - 3]}`
      : s.display_name;
    setLocationName(short);
    setShowSuggestions(false);
    setSuggestions([]);
  };

  const toggleMetric = (m: ForecastMetric) => {
    setSelectedMetrics(prev => {
      const next = new Set(prev);
      if (next.has(m)) {
        next.delete(m);
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

  const anyNeedsTime = Array.from(selectedMetrics).some(m => metricNeedsTime(m));

  const handleSubmit = async () => {
    if (!locationName.trim() || !targetDate || selectedMetrics.size === 0) return;
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
          if (!resolvedTz && data.timeZone) setResolvedTz(data.timeZone);
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
      let data: any;
      try {
        data = await res.json();
      } catch {
        setVerifyMsg('Error: Server returned invalid response');
        return;
      }
      if (res.ok) {
        const { verified = 0, skipped = 0, errors = [] } = data;
        let msg: string;
        if (verified > 0) {
          msg = `Verified ${verified} forecast${verified > 1 ? 's' : ''}`;
          if (skipped > 0) msg += `, ${skipped} skipped`;
          if (errors.length > 0) msg += `, ${errors.length} error${errors.length > 1 ? 's' : ''}`;
        } else if (skipped > 0) {
          msg = `0 verified — ${skipped} entr${skipped > 1 ? 'ies' : 'y'} skipped (NWS data not yet available or target date hasn't passed + 15 min buffer)`;
        } else if (errors.length > 0) {
          msg = `0 verified — ${errors.length} error${errors.length > 1 ? 's' : ''}: ${errors.slice(0, 3).join('; ')}`;
        } else {
          msg = 'No pending forecasts found';
        }
        setVerifyMsg(msg);
        fetchEntries();
      } else {
        setVerifyMsg(`Error: ${data.error || res.statusText}`);
      }
    } catch (err: any) {
      setVerifyMsg(`Error: ${err.message || 'Network error'}`);
    } finally {
      setVerifying(false);
    }
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/admin/forecasts?id=${id}`, { method: 'DELETE' });
    fetchEntries();
  };

  // Sorting
  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const sortIndicator = (field: SortField) => {
    if (sortField !== field) return '';
    return sortDir === 'asc' ? ' \u25B2' : ' \u25BC';
  };

  const sortEntries = (items: ForecastEntry[]): ForecastEntry[] => {
    const mul = sortDir === 'asc' ? 1 : -1;
    return [...items].sort((a, b) => {
      switch (sortField) {
        case 'date':
          return mul * (a.targetDate.localeCompare(b.targetDate) || (a.targetTime || '').localeCompare(b.targetTime || ''));
        case 'forecast':
          return mul * (a.forecastValue - b.forecastValue);
        case 'accuracy':
          return mul * ((a.accuracyScore ?? -1) - (b.accuracyScore ?? -1));
        case 'weighted':
          return mul * ((a.weightedScore ?? -1) - (b.weightedScore ?? -1));
        case 'lead':
          return mul * (a.leadTimeHours - b.leadTimeHours);
        default:
          return 0;
      }
    });
  };

  const toggleGroup = (metric: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(metric)) next.delete(metric);
      else next.add(metric);
      return next;
    });
  };

  // Group entries by metric
  const groupedEntries = METRIC_ORDER
    .map(metric => ({
      metric,
      label: METRIC_GROUP_LABELS[metric],
      entries: sortEntries(entries.filter(e => e.metric === metric)),
    }))
    .filter(g => g.entries.length > 0);

  // Stats
  const verified = entries.filter(e => e.actualValue != null);
  const pending = entries.filter(e => e.actualValue == null);
  const avgAccuracy = verified.length > 0
    ? Math.round(verified.reduce((s, e) => s + (e.accuracyScore || 0), 0) / verified.length)
    : null;
  const avgWeighted = verified.length > 0
    ? Math.round(verified.reduce((s, e) => s + (e.weightedScore || 0), 0) / verified.length * 10) / 10
    : null;

  const thClass = 'px-3 py-2 cursor-pointer select-none hover:text-gray-900 transition-colors';

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
          <div className="text-2xl font-bold text-green-600">{avgAccuracy ?? '\u2014'}{avgAccuracy != null ? '%' : ''}</div>
          <div className="text-xs text-gray-500">Avg Accuracy</div>
        </div>
        <div className="rounded-lg bg-gray-100 p-3 text-center">
          <div className="text-2xl font-bold text-purple-600">{avgWeighted ?? '\u2014'}</div>
          <div className="text-xs text-gray-500">Avg Weighted Score</div>
        </div>
      </div>

      {/* Input Form */}
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
        <h4 className="mb-3 text-sm font-semibold text-gray-900">Record Forecast</h4>

        {/* Row 1: Location, Date, Time */}
        <div className="mb-3 flex flex-wrap items-end gap-3">
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
            <label className="mb-1 block text-xs text-gray-500">Event Date</label>
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
              <label className="mb-1 block text-xs text-gray-500">
                Event Time{' '}
                <span className="text-blue-500 font-medium">
                  {resolvedTz
                    ? `(${resolvedTz.replace(/_/g, ' ')})`
                    : '(event local time)'}
                </span>
              </label>
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

      {/* Results — Grouped by Metric */}
      {loading ? (
        <div className="flex justify-center py-8">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-field/20 border-t-field" />
        </div>
      ) : entries.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-500">No forecasts recorded yet.</p>
      ) : (
        <div className="space-y-4">
          {groupedEntries.map(group => {
            const isCollapsed = collapsedGroups.has(group.metric);
            const groupVerified = group.entries.filter(e => e.actualValue != null);
            const groupAvg = groupVerified.length > 0
              ? Math.round(groupVerified.reduce((s, e) => s + (e.accuracyScore || 0), 0) / groupVerified.length)
              : null;

            return (
              <div key={group.metric} className="rounded-xl border border-gray-200 overflow-hidden">
                {/* Group header */}
                <button
                  onClick={() => toggleGroup(group.metric)}
                  className="flex w-full items-center justify-between bg-gray-100 px-4 py-3 text-left hover:bg-gray-150 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-gray-900">
                      {isCollapsed ? '\u25B6' : '\u25BC'} {group.label}
                    </span>
                    <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">
                      {group.entries.length}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    {groupAvg != null && (
                      <span className="font-medium">
                        Avg: <span className={groupAvg >= 70 ? 'text-green-600' : 'text-orange-500'}>{groupAvg}%</span>
                      </span>
                    )}
                    <span>
                      {groupVerified.length}/{group.entries.length} verified
                    </span>
                  </div>
                </button>

                {/* Group table */}
                {!isCollapsed && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-gray-900">
                      <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                        <tr>
                          <th className="px-3 py-2 text-left">Location</th>
                          <th className={`${thClass} text-left`} onClick={() => toggleSort('date')}>
                            Event Date{sortIndicator('date')}
                          </th>
                          <th className={`${thClass} text-right`} onClick={() => toggleSort('forecast')}>
                            Forecast{sortIndicator('forecast')}
                          </th>
                          <th className="px-3 py-2 text-right">Actual</th>
                          <th className="px-3 py-2 text-right">Error</th>
                          <th className={`${thClass} text-center`} onClick={() => toggleSort('lead')}>
                            Lead{sortIndicator('lead')}
                          </th>
                          <th className="px-3 py-2 text-center">Precision</th>
                          <th className={`${thClass} text-right`} onClick={() => toggleSort('accuracy')}>
                            Accuracy{sortIndicator('accuracy')}
                          </th>
                          <th className={`${thClass} text-right`} onClick={() => toggleSort('weighted')}>
                            Weighted{sortIndicator('weighted')}
                          </th>
                          <th className="px-3 py-2 text-left">Recorded</th>
                          <th className="px-3 py-2 text-left">Verified</th>
                          <th className="px-3 py-2 text-center">Status</th>
                          <th className="px-3 py-2"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {group.entries.map(e => {
                          const isVerified = e.actualValue != null;
                          const unit = METRIC_UNITS[e.metric];
                          const precision = e.targetTime ? 'Hourly' : 'Daily';
                          const precisionMult = e.precisionMultiplier ?? (e.targetTime ? 1.5 : 1.0);
                          return (
                            <tr key={e.id} className="hover:bg-gray-50">
                              <td className="px-3 py-2 font-medium">{e.locationName}</td>
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
                                  <span className="text-gray-400">{'\u2014'}</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right font-mono">
                                {isVerified ? (
                                  <span className={e.errorAbs! <= 2 ? 'text-green-600' : e.errorAbs! <= 5 ? 'text-orange-500' : 'text-red-600'}>
                                    {e.errorAbs! > 0 ? `${e.errorAbs}` : '0'}
                                  </span>
                                ) : (
                                  <span className="text-gray-400">{'\u2014'}</span>
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
                                  <span className="text-gray-400">{'\u2014'}</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right font-mono">
                                {isVerified ? (
                                  <span className="font-bold text-purple-600">{e.weightedScore}</span>
                                ) : (
                                  <span className="text-gray-400">{'\u2014'}</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-xs text-gray-500">
                                {e.inputAt ? formatET(e.inputAt) : '\u2014'}
                              </td>
                              <td className="px-3 py-2 text-xs text-gray-500">
                                {e.verifiedAt ? formatET(e.verifiedAt) : '\u2014'}
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
                                <div className="flex items-center gap-2">
                                  {onImportToWager && (
                                    <button
                                      onClick={() => onImportToWager({
                                        locationName: e.locationName,
                                        lat: e.lat,
                                        lon: e.lon,
                                        metric: e.metric,
                                        targetDate: e.targetDate,
                                        targetTime: e.targetTime,
                                        forecastValue: e.forecastValue,
                                      })}
                                      className="text-xs text-blue-600 hover:underline"
                                      title="Create wager from this forecast"
                                    >
                                      Wager
                                    </button>
                                  )}
                                  <button
                                    onClick={() => handleDelete(e.id)}
                                    className="text-xs text-red-500 hover:underline"
                                  >
                                    Del
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Scoring Legend */}
      <div className="rounded-lg bg-gray-50 p-4 text-xs text-gray-500">
        <div className="mb-1 font-semibold text-gray-700">Scoring System</div>
        <div className="grid gap-1 sm:grid-cols-2">
          <div>
            <span className="font-medium">Accuracy (0-100):</span> Temp: 100 - (error{'\u00D7'}5), Wind: 100 - (error{'\u00D7'}3.3)
          </div>
          <div>
            <span className="font-medium">Weighted Score:</span> Accuracy {'\u00D7'} Lead Time {'\u00D7'} Precision
          </div>
          <div>
            <span className="font-medium">Lead Time Multipliers:</span> &lt;1h: 1x, 1-6h: 1.5x, 6-24h: 2x, 1-3d: 3x, 3-5d: 5x, 5-7d: 7x, 7-10d: 10x, 10-14d: 13x, 14d+: 15x
          </div>
          <div>
            <span className="font-medium">Precision Bonus:</span> Daily: 1x, <span className="text-purple-600 font-semibold">Hourly: 1.5x</span> {'\u2014'} picking the hour is harder!
          </div>
          <div>
            <span className="font-medium">Perfect 10-day hourly forecast:</span> 100 {'\u00D7'} 10x {'\u00D7'} 1.5x = <span className="font-bold text-purple-600">1,500 pts</span>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect, useRef } from 'react';
import type { ForecastEntry, ForecastMetric } from '../../lib/forecast-tracker-types';
import { METRIC_LABELS, METRIC_UNITS, metricNeedsTime, formatLeadTime } from '../../lib/forecast-tracker-types';
import ForecastVerificationV2Panel from './ForecastVerificationV2Panel';
import ConfirmDialog from './ConfirmDialog';
import LocationSearch from '../search/LocationSearch';
import type { GeoLocation } from '../../lib/types';

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
  // Keyed by "metric:source" e.g. "high_temp:wageronweather"
  const [forecastValues, setForecastValues] = useState<Record<string, string>>({});
  const [targetDate, setTargetDate] = useState('');
  const [targetTime, setTargetTime] = useState('');
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set(['wageronweather']));
  const [submitting, setSubmitting] = useState(false);
  const [formMsg, setFormMsg] = useState<string | null>(null);

  // Location state
  const [resolvedTz, setResolvedTz] = useState<string | null>(null);
  const [selectedLat, setSelectedLat] = useState<number | null>(null);
  const [selectedLon, setSelectedLon] = useState<number | null>(null);

  // Verify state
  const [verifying, setVerifying] = useState(false);
  const [reverifying, setReverifying] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const [reverifyErrors, setReverifyErrors] = useState<any[]>([]);
  const [showReverifyErrors, setShowReverifyErrors] = useState(false);

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; locationName: string; metric: string; targetDate: string } | null>(null);

  // Source filter state
  const [sourceFilter, setSourceFilter] = useState<string>('all');

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

  const handleLocationSelect = (loc: GeoLocation) => {
    setLocationName(loc.displayName || loc.name || '');
    setSelectedLat(loc.lat);
    setSelectedLon(loc.lon);
    setResolvedTz(null);
  };

  const toggleMetric = (m: ForecastMetric) => {
    setSelectedMetrics(prev => {
      const next = new Set(prev);
      if (next.has(m)) {
        next.delete(m);
        setForecastValues(fv => {
          const copy = { ...fv };
          for (const key of Object.keys(copy)) {
            if (key.startsWith(`${m}:`)) delete copy[key];
          }
          return copy;
        });
      } else {
        next.add(m);
      }
      return next;
    });
  };

  const setMetricValue = (m: ForecastMetric, source: string, val: string) => {
    setForecastValues(prev => ({ ...prev, [`${m}:${source}`]: val }));
  };

  const FORECAST_SOURCES = [
    { id: 'wageronweather', label: 'WagerOnWeather.com' },
    { id: 'accuweather', label: 'AccuWeather' },
    { id: 'weather.com', label: 'Weather.com' },
  ] as const;

  const toggleSource = (id: string) => {
    setSelectedSources(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const anyNeedsTime = Array.from(selectedMetrics).some(m => metricNeedsTime(m));

  const handleSubmit = async () => {
    if (!locationName.trim() || !targetDate || selectedMetrics.size === 0 || selectedSources.size === 0) return;

    setSubmitting(true);
    setFormMsg(null);
    const results: string[] = [];
    let hasError = false;
    const metricsToSubmit = Array.from(selectedMetrics);
    const sourcesToSubmit = Array.from(selectedSources);

    for (const m of metricsToSubmit) {
      for (const src of sourcesToSubmit) {
        const val = forecastValues[`${m}:${src}`];
        if (!val && val !== '0') continue; // skip empty source fields
        const srcLabel = FORECAST_SOURCES.find(s => s.id === src)?.label || src;
        try {
          const res = await fetch('/api/admin/forecasts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              locationName: locationName.trim(),
              lat: selectedLat,
              lon: selectedLon,
              metric: m,
              targetDate,
              targetTime: metricNeedsTime(m) && targetTime ? targetTime : undefined,
              forecastValue: parseFloat(val),
              source: [src],
            }),
          });
          const data = await res.json();
          if (res.ok) {
            if (!resolvedTz && data.timeZone) setResolvedTz(data.timeZone);
            results.push(`${srcLabel} ${METRIC_LABELS[m]}: ${formatLeadTime(data.leadTimeHours)}`);
          } else {
            results.push(`${srcLabel} ${METRIC_LABELS[m]}: Error — ${data.error}`);
            hasError = true;
          }
        } catch {
          results.push(`${srcLabel} ${METRIC_LABELS[m]}: Network error`);
          hasError = true;
        }
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

  const handleReverify = async () => {
    setReverifying(true);
    setVerifyMsg(null);
    setReverifyErrors([]);
    setShowReverifyErrors(false);
    try {
      const res = await fetch('/api/admin/forecasts/reverify', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        const { updated = 0, unchanged = 0, errors = [] } = data;
        let msg = `Re-verified: ${updated} updated, ${unchanged} unchanged`;
        if (errors.length > 0) msg += `, ${errors.length} error(s)`;
        setVerifyMsg(msg);
        if (errors.length > 0) setReverifyErrors(errors);
        fetchEntries();
      } else {
        setVerifyMsg(`Error: ${data.error || res.statusText}`);
      }
    } catch (err: any) {
      setVerifyMsg(`Error: ${err.message || 'Network error'}`);
    } finally {
      setReverifying(false);
    }
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/admin/forecasts?id=${id}`, { method: 'DELETE' });
    setDeleteTarget(null);
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

  // Filter entries by selected source
  const filteredEntries = sourceFilter === 'all'
    ? entries
    : entries.filter(e => e.source && e.source.includes(sourceFilter));

  // Group entries by metric
  const groupedEntries = METRIC_ORDER
    .map(metric => ({
      metric,
      label: METRIC_GROUP_LABELS[metric],
      entries: sortEntries(filteredEntries.filter(e => e.metric === metric)),
    }))
    .filter(g => g.entries.length > 0);

  // Stats (based on filtered entries)
  const verified = filteredEntries.filter(e => e.actualValue != null);
  const pending = filteredEntries.filter(e => e.actualValue == null);
  const avgAccuracy = verified.length > 0
    ? Math.round(verified.reduce((s, e) => s + (e.accuracyScore || 0), 0) / verified.length)
    : null;
  // Weighted Accuracy: sum(accuracyScore * leadTimeMultiplier * precisionMultiplier) / sum(100 * leadTimeMultiplier * precisionMultiplier)
  const weightedAccuracy = (() => {
    const scored = verified.filter(e => e.leadTimeMultiplier != null);
    if (scored.length === 0) return null;
    const totalWeightedScore = scored.reduce((s, e) => s + (e.weightedScore || 0), 0);
    const totalMaxPossible = scored.reduce((s, e) => s + 100 * (e.leadTimeMultiplier || 1) * (e.precisionMultiplier || 1), 0);
    return totalMaxPossible > 0 ? Math.round(totalWeightedScore / totalMaxPossible * 100) : null;
  })();

  // Source counts for filter tabs
  const sourceCounts = {
    all: entries.length,
    wageronweather: entries.filter(e => e.source?.includes('wageronweather')).length,
    accuweather: entries.filter(e => e.source?.includes('accuweather')).length,
    'weather.com': entries.filter(e => e.source?.includes('weather.com')).length,
  };

  const thClass = 'px-3 py-2 cursor-pointer select-none hover:text-gray-900 transition-colors';

  return (
    <div className="space-y-5">
      {/* V2 Dashboard */}
      <ForecastVerificationV2Panel />

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
          <div className="text-2xl font-bold text-purple-600">{weightedAccuracy != null ? `${weightedAccuracy}%` : '\u2014'}</div>
          <div className="text-xs text-gray-500">Weighted Accuracy</div>
        </div>
      </div>

      {/* Input Form */}
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
        <h4 className="mb-3 text-sm font-semibold text-gray-900">Record Forecast</h4>

        {/* Row 1: Location, Date, Time */}
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div className="w-56">
            <label className="mb-1 block text-xs text-gray-500">Location</label>
            <LocationSearch
              onSelect={handleLocationSelect}
              placeholder="Houston, TX"
              defaultValue={locationName}
              inputClassName="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-field"
            />
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

        {/* Row 3: Forecast Source checkboxes */}
        <div className="mb-3">
          <label className="mb-2 block text-xs text-gray-500">Forecast Sources</label>
          <div className="flex flex-wrap gap-4">
            {FORECAST_SOURCES.map(s => (
              <label key={s.id} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedSources.has(s.id)}
                  onChange={() => toggleSource(s.id)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <span className="text-sm text-gray-700">{s.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Row 4: Forecast values — one row per metric, one input per source */}
        {Array.from(selectedMetrics).map(m => (
          <div key={m} className="mb-3">
            <label className="mb-1 block text-xs font-medium text-gray-700">{METRIC_LABELS[m]}</label>
            <div className="flex flex-wrap items-end gap-3">
              {FORECAST_SOURCES.map(src => {
                if (!selectedSources.has(src.id)) return null;
                return (
                  <div key={src.id}>
                    <label className="mb-1 block text-[10px] text-gray-400">{src.label}</label>
                    <input
                      type="number"
                      step="0.1"
                      value={forecastValues[`${m}:${src.id}`] || ''}
                      onChange={e => setMetricValue(m, src.id, e.target.value)}
                      placeholder="72"
                      className="w-20 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-900 text-center outline-none focus:border-field"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={submitting || !locationName.trim() || !targetDate || selectedMetrics.size === 0 || selectedSources.size === 0 ||
            Array.from(selectedMetrics).some(m =>
              Array.from(selectedSources).every(src => {
                const v = forecastValues[`${m}:${src}`];
                return !v && v !== '0';
              })
            )}
          className="rounded-lg bg-field px-4 py-2 text-sm font-semibold text-white hover:bg-field-light disabled:opacity-50"
        >
          {submitting ? 'Saving...' : (() => {
            const count = Array.from(selectedMetrics).reduce((n, m) =>
              n + Array.from(selectedSources).filter(src => {
                const v = forecastValues[`${m}:${src}`];
                return v || v === '0';
              }).length, 0);
            return count > 1 ? `Record ${count} Forecasts` : 'Record Forecast';
          })()}
        </button>

        {formMsg && (
          <p className={`mt-2 text-xs ${formMsg.startsWith('Error') || formMsg.startsWith('Partial') ? 'text-red-600' : 'text-green-600'}`}>
            {formMsg}
          </p>
        )}
      </div>

      {/* Verify Buttons */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleVerify}
          disabled={verifying || reverifying || pending.length === 0}
          className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
        >
          {verifying ? 'Checking NWS...' : `Verify Pending (${pending.length})`}
        </button>
        <button
          onClick={handleReverify}
          disabled={reverifying || verifying || verified.length === 0}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {reverifying ? 'Re-checking NWS...' : `Re-verify All (${verified.length})`}
        </button>
        {verifyMsg && (
          <span className={`text-xs ${verifyMsg.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>
            {verifyMsg}
            {reverifyErrors.length > 0 && (
              <button
                onClick={() => setShowReverifyErrors(!showReverifyErrors)}
                className="ml-2 text-blue-600 hover:underline"
              >
                {showReverifyErrors ? 'Hide errors' : 'Show errors'}
              </button>
            )}
          </span>
        )}
        {showReverifyErrors && reverifyErrors.length > 0 && (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs max-h-60 overflow-y-auto">
            <div className="font-semibold text-red-700 mb-2">Re-verify Errors ({reverifyErrors.length})</div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-red-200">
                  <th className="px-2 py-1 text-left text-red-600">Location</th>
                  <th className="px-2 py-1 text-left text-red-600">Metric</th>
                  <th className="px-2 py-1 text-left text-red-600">Date</th>
                  <th className="px-2 py-1 text-left text-red-600">Reason</th>
                </tr>
              </thead>
              <tbody>
                {reverifyErrors.map((err: any, i: number) => (
                  <tr key={i} className="border-b border-red-100">
                    <td className="px-2 py-1">{err.locationName || '—'}</td>
                    <td className="px-2 py-1">{err.metric || '—'}</td>
                    <td className="px-2 py-1">{err.targetDate || '—'}{err.targetTime ? ` ${err.targetTime}` : ''}</td>
                    <td className="px-2 py-1 text-red-700">{err.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Source Filter Tabs */}
      {entries.length > 0 && (
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
          {[
            { id: 'all', label: 'All Sources' },
            { id: 'wageronweather', label: 'WagerOnWeather' },
            { id: 'accuweather', label: 'AccuWeather' },
            { id: 'weather.com', label: 'Weather.com' },
          ].map(tab => {
            const count = sourceCounts[tab.id as keyof typeof sourceCounts];
            if (tab.id !== 'all' && count === 0) return null;
            return (
              <button
                key={tab.id}
                onClick={() => setSourceFilter(tab.id)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  sourceFilter === tab.id
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label} ({count})
              </button>
            );
          })}
        </div>
      )}

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
                          <th className="px-3 py-2 text-left">Source</th>
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
                              <td className="px-3 py-2 text-xs text-gray-500">
                                {e.source && e.source.length > 0
                                  ? e.source.map(s =>
                                      s === 'wageronweather' ? 'WoW' :
                                      s === 'accuweather' ? 'AW' :
                                      s === 'weather.com' ? 'W.com' : s
                                    ).join(', ')
                                  : '\u2014'}
                              </td>
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
                                    onClick={() => setDeleteTarget({ id: e.id, locationName: e.locationName, metric: e.metric, targetDate: e.targetDate })}
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

      {/* Delete Confirmation Dialog */}
      {deleteTarget && (
        <ConfirmDialog
          title="Delete Forecast Entry"
          message={`Permanently delete forecast for ${deleteTarget.locationName} — ${deleteTarget.metric} on ${deleteTarget.targetDate}? This cannot be undone.`}
          confirmLabel="Delete"
          confirmColor="red"
          onConfirm={() => handleDelete(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

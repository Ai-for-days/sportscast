import { useState, useEffect } from 'react';
import type { ForecastEntry, ForecastMetric } from '../../lib/forecast-tracker-types';
import { METRIC_LABELS, METRIC_UNITS, metricNeedsTime, formatLeadTime } from '../../lib/forecast-tracker-types';

const METRICS: ForecastMetric[] = ['actual_temp', 'high_temp', 'low_temp', 'wind_speed', 'wind_gust'];

export default function ForecastTracker() {
  const [entries, setEntries] = useState<ForecastEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [locationName, setLocationName] = useState('');
  const [metric, setMetric] = useState<ForecastMetric>('high_temp');
  const [targetDate, setTargetDate] = useState('');
  const [targetTime, setTargetTime] = useState('');
  const [forecastValue, setForecastValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formMsg, setFormMsg] = useState<string | null>(null);

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

  const handleSubmit = async () => {
    if (!locationName.trim() || !targetDate || forecastValue === '') return;
    setSubmitting(true);
    setFormMsg(null);
    try {
      const res = await fetch('/api/admin/forecasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationName: locationName.trim(),
          metric,
          targetDate,
          targetTime: metricNeedsTime(metric) && targetTime ? targetTime : undefined,
          forecastValue: parseFloat(forecastValue),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setFormMsg(`Forecast recorded! Lead time: ${formatLeadTime(data.leadTimeHours)} (${data.stationId})`);
        setForecastValue('');
        fetchEntries();
      } else {
        setFormMsg(`Error: ${data.error}`);
      }
    } catch {
      setFormMsg('Network error');
    }
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
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs text-gray-500">Location</label>
            <input
              type="text"
              value={locationName}
              onChange={e => setLocationName(e.target.value)}
              placeholder="Houston, TX"
              className="w-44 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-field"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">Metric</label>
            <select
              value={metric}
              onChange={e => setMetric(e.target.value as ForecastMetric)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-field"
            >
              {METRICS.map(m => (
                <option key={m} value={m}>{METRIC_LABELS[m]}</option>
              ))}
            </select>
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
          {metricNeedsTime(metric) && (
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
          <div>
            <label className="mb-1 block text-xs text-gray-500">
              Our Forecast ({METRIC_UNITS[metric]})
            </label>
            <input
              type="number"
              step="0.1"
              value={forecastValue}
              onChange={e => setForecastValue(e.target.value)}
              placeholder="72"
              className="w-24 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-field"
            />
          </div>
          <button
            onClick={handleSubmit}
            disabled={submitting || !locationName.trim() || !targetDate || forecastValue === ''}
            className="rounded-lg bg-field px-4 py-2 text-sm font-semibold text-white hover:bg-field-light disabled:opacity-50"
          >
            {submitting ? 'Saving...' : 'Record'}
          </button>
        </div>
        {formMsg && (
          <p className={`mt-2 text-xs ${formMsg.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>
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
            <span className="font-medium">Weighted Score:</span> Accuracy × Lead Time Multiplier
          </div>
          <div>
            <span className="font-medium">Lead Time Multipliers:</span> &lt;1h: 1x, 1-6h: 1.5x, 6-24h: 2x, 1-3d: 3x, 3-5d: 5x, 5-7d: 7x, 7-10d: 10x, 10-14d: 13x, 14d+: 15x
          </div>
          <div>
            <span className="font-medium">Perfect 10-day forecast:</span> 100 accuracy × 10x = <span className="font-bold text-purple-600">1,000 pts</span>
          </div>
        </div>
      </div>
    </div>
  );
}

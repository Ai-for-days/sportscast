import { useState } from 'react';
import LocationSearch from '../search/LocationSearch';
import type { GeoLocation } from '../../lib/types';

// ── Types ───────────────────────────────────────────────────────────────────

interface SourceForecast {
  source: string;
  forecastValue: number;
  leadTimeHours: number;
}

interface Consensus {
  sources: SourceForecast[];
  mean: number;
  weightedMean: number;
  median: number;
  min: number;
  max: number;
  stdDev: number;
  count: number;
}

interface OverUnder {
  line: number;
  fairLine: number;
  overProb: number;
  underProb: number;
  overOdds: number;
  underOdds: number;
  hold: number;
}

interface RangeBand {
  label: string;
  minValue: number;
  maxValue: number;
  probability: number;
  fairOdds: number;
  offeredOdds: number;
}

interface PointspreadResult {
  locationAConsensus: Consensus;
  locationBConsensus: Consensus;
  expectedDiff: number;
  spread: number;
  diffStdDev: number;
  locationAProb: number;
  locationBProb: number;
  locationAOdds: number;
  locationBOdds: number;
  hold: number;
}

// ── Metric options ──────────────────────────────────────────────────────────

const METRICS = [
  { value: 'actual_temp', label: 'Actual Temp at Time (°F)', needsTime: true },
  { value: 'high_temp', label: 'High Temp (°F)', needsTime: false },
  { value: 'low_temp', label: 'Low Temp (°F)', needsTime: false },
  { value: 'wind_speed', label: 'Wind Speed (mph)', needsTime: true },
  { value: 'wind_gust', label: 'Wind Gust (mph)', needsTime: true },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : String(odds);
}

function fmtPct(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

function fmtNum(n: number, decimals = 2): string {
  return n.toFixed(decimals);
}

// ── Styles ──────────────────────────────────────────────────────────────────

const inputClass = 'w-full rounded-lg border border-gray-200 bg-gray-100 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100';
const labelClass = 'mb-1 block text-xs font-medium text-gray-500';
const cardClass = 'rounded-lg border border-gray-200 bg-white p-4';
const btnClass = 'rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const btnBlue = `${btnClass} bg-blue-600 text-white hover:bg-blue-700`;
const thClass = 'px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider';
const tdClass = 'px-3 py-2 text-sm text-gray-900';

// ── Spinner ─────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg className="inline h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

// ── Time slots ──────────────────────────────────────────────────────────────

function generateTimeSlots(): string[] {
  const slots: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      slots.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);
    }
  }
  return slots;
}

function formatTime12h(t: string): string {
  const [hStr, mStr] = t.split(':');
  let h = parseInt(hStr);
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${mStr} ${ampm}`;
}

const TIME_SLOTS = generateTimeSlots();

// ═══════════════════════════════════════════════════════════════════════════
// ── Main Component ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

export default function PricingLab() {
  // ── Section A state ───────────────────────────────────────────────────
  const [locName, setLocName] = useState('');
  const [metric, setMetric] = useState('high_temp');
  const [targetDate, setTargetDate] = useState('');
  const [targetTime, setTargetTime] = useState('12:00');
  const [loadingConsensus, setLoadingConsensus] = useState(false);
  const [loadingLines, setLoadingLines] = useState(false);
  const [singleError, setSingleError] = useState('');
  const [consensus, setConsensus] = useState<Consensus | null>(null);
  const [overUnder, setOverUnder] = useState<OverUnder | null>(null);
  const [rangeBands, setRangeBands] = useState<RangeBand[] | null>(null);

  // ── Section B state ───────────────────────────────────────────────────
  const [locAName, setLocAName] = useState('');
  const [locBName, setLocBName] = useState('');
  const [psMetric, setPsMetric] = useState('high_temp');
  const [psDate, setPsDate] = useState('');
  const [psTime, setPsTime] = useState('12:00');
  const [loadingPs, setLoadingPs] = useState(false);
  const [psError, setPsError] = useState('');
  const [psResult, setPsResult] = useState<PointspreadResult | null>(null);

  const needsTime = METRICS.find(m => m.value === metric)?.needsTime ?? false;
  const psNeedsTime = METRICS.find(m => m.value === psMetric)?.needsTime ?? false;

  // ── Fetchers ──────────────────────────────────────────────────────────

  const buildParams = (base: Record<string, string>, time?: string, needsT?: boolean) => {
    const p = new URLSearchParams(base);
    if (needsT && time) p.set('targetTime', time);
    return p;
  };

  const fetchConsensus = async () => {
    if (!locName || !targetDate) return;
    setLoadingConsensus(true);
    setSingleError('');
    try {
      const p = buildParams({ locationName: locName, metric, targetDate }, targetTime, needsTime);
      const res = await fetch(`/api/admin/forecast-consensus?${p}`, { credentials: 'include' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setSingleError(d.error || `Error ${res.status}`);
        return;
      }
      const d = await res.json();
      setConsensus(d.consensus);
    } catch (e: any) {
      setSingleError(e?.message || 'Fetch failed');
    } finally {
      setLoadingConsensus(false);
    }
  };

  const fetchLines = async () => {
    if (!locName || !targetDate) return;
    setLoadingLines(true);
    setSingleError('');
    try {
      const p = buildParams({ locationName: locName, metric, targetDate }, targetTime, needsTime);
      const res = await fetch(`/api/admin/line-suggestions?${p}`, { credentials: 'include' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setSingleError(d.error || `Error ${res.status}`);
        return;
      }
      const d = await res.json();
      setConsensus(d.consensus);
      setOverUnder(d.overUnder);
      setRangeBands(d.rangeOdds?.bands || null);
    } catch (e: any) {
      setSingleError(e?.message || 'Fetch failed');
    } finally {
      setLoadingLines(false);
    }
  };

  const fetchPointspread = async () => {
    if (!locAName || !locBName || !psDate) return;
    setLoadingPs(true);
    setPsError('');
    try {
      const p = buildParams({ locationAName: locAName, locationBName: locBName, metric: psMetric, targetDate: psDate }, psTime, psNeedsTime);
      const res = await fetch(`/api/admin/pointspread-suggestions?${p}`, { credentials: 'include' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setPsError(d.error || `Error ${res.status}`);
        return;
      }
      const d = await res.json();
      setPsResult(d.pointspread);
    } catch (e: any) {
      setPsError(e?.message || 'Fetch failed');
    } finally {
      setLoadingPs(false);
    }
  };

  // ── Quick copy text ───────────────────────────────────────────────────

  const singleCopyText = consensus && overUnder
    ? `${locName} — ${METRICS.find(m => m.value === metric)?.label || metric} — ${targetDate}${needsTime ? ' ' + targetTime : ''}
Consensus Mean: ${consensus.mean}
Weighted Mean: ${consensus.weightedMean}
Std Dev: ${consensus.stdDev}
Suggested O/U: ${overUnder.line}
Over ${fmtOdds(overUnder.overOdds)} / Under ${fmtOdds(overUnder.underOdds)}`
    : '';

  const psCopyText = psResult
    ? `${locAName} vs ${locBName} — ${METRICS.find(m => m.value === psMetric)?.label || psMetric} — ${psDate}${psNeedsTime ? ' ' + psTime : ''}
Expected Diff: ${psResult.expectedDiff}
Suggested Spread: ${locAName.split(',')[0]} ${psResult.spread >= 0 ? '-' : '+'}${Math.abs(psResult.spread)}
${locAName.split(',')[0]} ${fmtOdds(psResult.locationAOdds)} / ${locBName.split(',')[0]} ${fmtOdds(psResult.locationBOdds)}`
    : '';

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Pricing Lab</h1>
        <a href="/admin/wagers" className="text-sm text-blue-600 hover:underline">&larr; Back to Wagers</a>
      </div>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* SECTION A — Single-Location Market Tester */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <section>
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Single-Location Market Tester</h2>
        <div className={`${cardClass} space-y-4`}>
          {/* Inputs */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className={labelClass}>Location Name</label>
              <LocationSearch
                onSelect={(loc: GeoLocation) => setLocName(loc.displayName || loc.name || '')}
                placeholder="e.g. Columbia, SC"
                defaultValue={locName}
                inputClassName={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Metric</label>
              <select value={metric} onChange={e => setMetric(e.target.value)} className={inputClass}>
                {METRICS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Target Date</label>
              <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} className={inputClass} style={{ colorScheme: 'light' }} />
            </div>
            {needsTime && (
              <div>
                <label className={labelClass}>Target Time</label>
                <select value={targetTime} onChange={e => setTargetTime(e.target.value)} className={inputClass}>
                  {TIME_SLOTS.map(t => <option key={t} value={t}>{formatTime12h(t)}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* Buttons */}
          <div className="flex gap-3">
            <button onClick={fetchConsensus} disabled={!locName || !targetDate || loadingConsensus} className={btnBlue}>
              {loadingConsensus ? <><Spinner /> Getting...</> : 'Get Consensus'}
            </button>
            <button onClick={fetchLines} disabled={!locName || !targetDate || loadingLines} className={btnBlue}>
              {loadingLines ? <><Spinner /> Getting...</> : 'Get Line Suggestions'}
            </button>
          </div>

          {singleError && <p className="text-sm text-red-600">{singleError}</p>}
        </div>

        {/* Results */}
        {consensus && (
          <div className="mt-4 space-y-4">
            {/* Consensus Card */}
            <div className={cardClass}>
              <h3 className="mb-3 text-sm font-semibold text-gray-700">Consensus</h3>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
                <div><span className="text-gray-500">Mean:</span> <span className="font-medium">{consensus.mean}</span></div>
                <div><span className="text-gray-500">Weighted Mean:</span> <span className="font-medium">{consensus.weightedMean}</span></div>
                <div><span className="text-gray-500">Median:</span> <span className="font-medium">{consensus.median}</span></div>
                <div><span className="text-gray-500">Std Dev:</span> <span className="font-medium">{consensus.stdDev}</span></div>
                <div><span className="text-gray-500">Min:</span> <span className="font-medium">{consensus.min}</span></div>
                <div><span className="text-gray-500">Max:</span> <span className="font-medium">{consensus.max}</span></div>
                <div><span className="text-gray-500">Sources:</span> <span className="font-medium">{consensus.count}</span></div>
              </div>
              {consensus.sources.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-100">
                      <th className={thClass}>Source</th>
                      <th className={thClass}>Value</th>
                      <th className={thClass}>Lead (hrs)</th>
                    </tr></thead>
                    <tbody>
                      {consensus.sources.map((s, i) => (
                        <tr key={i} className="border-b border-gray-50">
                          <td className={tdClass}>{s.source}</td>
                          <td className={tdClass}>{s.forecastValue}</td>
                          <td className={tdClass}>{fmtNum(s.leadTimeHours, 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Over/Under Card */}
            {overUnder && (
              <div className={cardClass}>
                <h3 className="mb-3 text-sm font-semibold text-gray-700">Over/Under Suggestion</h3>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
                  <div><span className="text-gray-500">Fair Line:</span> <span className="font-medium">{overUnder.fairLine}</span></div>
                  <div><span className="text-gray-500">Line:</span> <span className="font-mono font-bold text-blue-700">{overUnder.line}</span></div>
                  <div><span className="text-gray-500">Over Prob:</span> <span className="font-medium">{fmtPct(overUnder.overProb)}</span></div>
                  <div><span className="text-gray-500">Under Prob:</span> <span className="font-medium">{fmtPct(overUnder.underProb)}</span></div>
                  <div><span className="text-gray-500">Over Odds:</span> <span className="font-mono font-bold text-green-700">{fmtOdds(overUnder.overOdds)}</span></div>
                  <div><span className="text-gray-500">Under Odds:</span> <span className="font-mono font-bold text-red-700">{fmtOdds(overUnder.underOdds)}</span></div>
                  <div><span className="text-gray-500">Hold:</span> <span className="font-medium">{fmtPct(overUnder.hold)}</span></div>
                </div>
              </div>
            )}

            {/* Range Odds Table */}
            {rangeBands && rangeBands.length > 0 && (
              <div className={cardClass}>
                <h3 className="mb-3 text-sm font-semibold text-gray-700">Range Odds</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-100">
                      <th className={thClass}>Band</th>
                      <th className={thClass}>Min</th>
                      <th className={thClass}>Max</th>
                      <th className={thClass}>Probability</th>
                      <th className={thClass}>Fair Odds</th>
                      <th className={thClass}>Offered Odds</th>
                    </tr></thead>
                    <tbody>
                      {rangeBands.map((b, i) => (
                        <tr key={i} className="border-b border-gray-50">
                          <td className={`${tdClass} font-medium`}>{b.label}</td>
                          <td className={tdClass}>{b.minValue}</td>
                          <td className={tdClass}>{b.maxValue}</td>
                          <td className={tdClass}>{fmtPct(b.probability)}</td>
                          <td className={`${tdClass} font-mono`}>{fmtOdds(b.fairOdds)}</td>
                          <td className={`${tdClass} font-mono font-bold`}>{fmtOdds(b.offeredOdds)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* One-Click Market Creation Buttons */}
            {overUnder && (
              <div className={`${cardClass} flex flex-wrap gap-3`}>
                <h3 className="text-sm font-semibold text-gray-700 w-full">Create Wager from Results</h3>
                <button
                  onClick={() => {
                    const params = new URLSearchParams({
                      prefillKind: 'over-under',
                      prefillLocation: locName,
                      prefillMetric: metric,
                      prefillDate: targetDate,
                      ...(needsTime && targetTime ? { prefillTime: targetTime } : {}),
                      prefillLine: String(overUnder.line),
                      prefillOverOdds: String(overUnder.overOdds),
                      prefillUnderOdds: String(overUnder.underOdds),
                      prefillModelJson: JSON.stringify({ consensus, overUnder }),
                    });
                    window.location.href = `/admin/wagers?${params}`;
                  }}
                  className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700"
                >
                  Create Over/Under Wager
                </button>
                {rangeBands && rangeBands.length > 0 && (
                  <button
                    onClick={() => {
                      const params = new URLSearchParams({
                        prefillKind: 'odds',
                        prefillLocation: locName,
                        prefillMetric: metric,
                        prefillDate: targetDate,
                        ...(needsTime && targetTime ? { prefillTime: targetTime } : {}),
                        prefillBandsJson: JSON.stringify(rangeBands),
                        prefillModelJson: JSON.stringify({ consensus, rangeOdds: { bands: rangeBands } }),
                      });
                      window.location.href = `/admin/wagers?${params}`;
                    }}
                    className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700"
                  >
                    Create Range Odds Wager
                  </button>
                )}
              </div>
            )}

            {/* Quick Copy — Single Location */}
            {singleCopyText && (
              <div className={cardClass}>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-700">Quick Copy</h3>
                  <button
                    onClick={() => navigator.clipboard.writeText(singleCopyText)}
                    className="rounded bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200"
                  >
                    Copy
                  </button>
                </div>
                <pre className="whitespace-pre-wrap rounded bg-gray-50 p-3 text-xs text-gray-800 font-mono">{singleCopyText}</pre>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* SECTION B — Pointspread Market Tester */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <section>
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Pointspread Market Tester</h2>
        <div className={`${cardClass} space-y-4`}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className={labelClass}>Location A</label>
              <LocationSearch
                onSelect={(loc: GeoLocation) => setLocAName(loc.displayName || loc.name || '')}
                placeholder="e.g. Phoenix, Arizona"
                defaultValue={locAName}
                inputClassName={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Location B</label>
              <LocationSearch
                onSelect={(loc: GeoLocation) => setLocBName(loc.displayName || loc.name || '')}
                placeholder="e.g. Seattle, Washington"
                defaultValue={locBName}
                inputClassName={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Metric</label>
              <select value={psMetric} onChange={e => setPsMetric(e.target.value)} className={inputClass}>
                {METRICS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Target Date</label>
              <input type="date" value={psDate} onChange={e => setPsDate(e.target.value)} className={inputClass} style={{ colorScheme: 'light' }} />
            </div>
          </div>
          {psNeedsTime && (
            <div className="max-w-xs">
              <label className={labelClass}>Target Time</label>
              <select value={psTime} onChange={e => setPsTime(e.target.value)} className={inputClass}>
                {TIME_SLOTS.map(t => <option key={t} value={t}>{formatTime12h(t)}</option>)}
              </select>
            </div>
          )}

          <button onClick={fetchPointspread} disabled={!locAName || !locBName || !psDate || loadingPs} className={btnBlue}>
            {loadingPs ? <><Spinner /> Getting...</> : 'Get Pointspread Suggestion'}
          </button>

          {psError && <p className="text-sm text-red-600">{psError}</p>}
        </div>

        {/* Results */}
        {psResult && (
          <div className="mt-4 space-y-4">
            <div className={cardClass}>
              <h3 className="mb-3 text-sm font-semibold text-gray-700">Pointspread Result</h3>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
                <div><span className="text-gray-500">Expected Diff:</span> <span className="font-medium">{psResult.expectedDiff}</span></div>
                <div><span className="text-gray-500">Spread:</span> <span className="font-mono font-bold text-blue-700">{psResult.spread}</span></div>
                <div><span className="text-gray-500">Diff Std Dev:</span> <span className="font-medium">{psResult.diffStdDev}</span></div>
                <div><span className="text-gray-500">Hold:</span> <span className="font-medium">{fmtPct(psResult.hold)}</span></div>
                <div><span className="text-gray-500">{locAName.split(',')[0]} Prob:</span> <span className="font-medium">{fmtPct(psResult.locationAProb)}</span></div>
                <div><span className="text-gray-500">{locBName.split(',')[0]} Prob:</span> <span className="font-medium">{fmtPct(psResult.locationBProb)}</span></div>
                <div><span className="text-gray-500">{locAName.split(',')[0]} Odds:</span> <span className="font-mono font-bold text-green-700">{fmtOdds(psResult.locationAOdds)}</span></div>
                <div><span className="text-gray-500">{locBName.split(',')[0]} Odds:</span> <span className="font-mono font-bold text-red-700">{fmtOdds(psResult.locationBOdds)}</span></div>
              </div>
            </div>

            {/* Consensus summaries */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {[
                { label: locAName || 'Location A', cons: psResult.locationAConsensus },
                { label: locBName || 'Location B', cons: psResult.locationBConsensus },
              ].map(({ label, cons }) => (
                <div key={label} className={cardClass}>
                  <h4 className="mb-2 text-xs font-semibold text-gray-500">{label} Consensus</h4>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <div><span className="text-gray-500">Mean:</span> {cons.mean}</div>
                    <div><span className="text-gray-500">W.Mean:</span> {cons.weightedMean}</div>
                    <div><span className="text-gray-500">Std Dev:</span> {cons.stdDev}</div>
                    <div><span className="text-gray-500">Sources:</span> {cons.count}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* One-Click Pointspread Wager Creation */}
            <div className={`${cardClass} flex flex-wrap gap-3`}>
              <h3 className="text-sm font-semibold text-gray-700 w-full">Create Wager from Results</h3>
              <button
                onClick={() => {
                  const params = new URLSearchParams({
                    prefillKind: 'pointspread',
                    prefillLocationA: locAName,
                    prefillLocationB: locBName,
                    prefillMetric: psMetric,
                    prefillDate: psDate,
                    ...(psNeedsTime && psTime ? { prefillTime: psTime } : {}),
                    prefillSpread: String(psResult.spread),
                    prefillLocationAOdds: String(psResult.locationAOdds),
                    prefillLocationBOdds: String(psResult.locationBOdds),
                    prefillModelJson: JSON.stringify({ pointspread: psResult }),
                  });
                  window.location.href = `/admin/wagers?${params}`;
                }}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700"
              >
                Create Pointspread Wager
              </button>
            </div>

            {/* Quick Copy — Pointspread */}
            {psCopyText && (
              <div className={cardClass}>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-700">Quick Copy</h3>
                  <button
                    onClick={() => navigator.clipboard.writeText(psCopyText)}
                    className="rounded bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200"
                  >
                    Copy
                  </button>
                </div>
                <pre className="whitespace-pre-wrap rounded bg-gray-50 p-3 text-xs text-gray-800 font-mono">{psCopyText}</pre>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

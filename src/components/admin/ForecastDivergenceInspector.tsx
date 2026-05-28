// ── Step 165: Forecast divergence inspector UI ──────────────────────────
//
// Admin-only tool for running the Step 165 divergence engine on demand.
// Two modes:
//
//   - "Stored snapshots": pull historical revisions from the existing
//     `forecast-revision-store` for a zip / lat-lon / target date /
//     metric. This is the primary path — operators usually want to see
//     what the engine thinks of a real location.
//
//   - "Manual snapshots": paste / type a snapshot series for ad-hoc
//     analysis. Useful for what-if exploration.
//
// The card display is `ForecastDivergenceCard.tsx`. The API endpoint
// is `/api/admin/system/forecast-divergence`.

import { useEffect, useMemo, useState } from 'react';
import ForecastDivergenceCard from './ForecastDivergenceCard';
import type {
  ForecastDivergenceResult,
  DivergenceMetric,
} from '../../lib/forecast-divergence';

const API = '/api/admin/system/forecast-divergence';

type Mode = 'stored' | 'manual';

interface ManualRow {
  forecastTime: string;
  value: string;
}

export default function ForecastDivergenceInspector() {
  const [mode, setMode] = useState<Mode>('stored');
  const [metric, setMetric] = useState<DivergenceMetric>('high_temp');
  const [targetDate, setTargetDate] = useState<string>(defaultTargetDate());
  const [cityName, setCityName] = useState<string>('');
  const [zip, setZip] = useState<string>('');
  const [lat, setLat] = useState<string>('');
  const [lon, setLon] = useState<string>('');
  const [manualRows, setManualRows] = useState<ManualRow[]>(initialManualRows);
  const [result, setResult] = useState<ForecastDivergenceResult | null>(null);
  const [contextLine, setContextLine] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bootstrap, setBootstrap] = useState<any>(null);

  useEffect(() => {
    fetch(`${API}?action=bootstrap`)
      .then((r) => r.json())
      .then((j) => setBootstrap(j))
      .catch(() => undefined);
  }, []);

  const supportedMetrics: DivergenceMetric[] = useMemo(
    () =>
      Array.isArray(bootstrap?.metrics) && bootstrap.metrics.length > 0
        ? (bootstrap.metrics as DivergenceMetric[])
        : ['high_temp', 'low_temp', 'precipitation_probability', 'wind_speed'],
    [bootstrap],
  );

  async function runAnalyze() {
    setBusy(true);
    setError(null);
    setResult(null);
    setContextLine('');
    try {
      if (mode === 'stored') {
        const body: any = {
          action: 'analyze-stored',
          metric,
          targetDate,
          cityName: cityName || undefined,
        };
        if (zip.trim()) body.zip = zip.trim();
        if (lat.trim()) body.lat = Number(lat);
        if (lon.trim()) body.lon = Number(lon);
        const res = await fetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const j = await res.json();
        if (!res.ok) {
          setError(j?.error ?? `HTTP ${res.status}`);
          return;
        }
        setResult(j.result as ForecastDivergenceResult);
        if (typeof j.storedSnapshotCount === 'number') {
          setContextLine(
            `Loaded ${j.storedSnapshotCount} stored snapshot(s); ${j.result.comparedForecasts} had a usable value for ${targetDate}.`,
          );
        }
      } else {
        const snapshots = manualRows
          .filter((r) => r.forecastTime.trim() !== '' && r.value.trim() !== '')
          .map((r) => ({ forecastTime: r.forecastTime.trim(), value: Number(r.value) }));
        const body = {
          action: 'analyze',
          metric,
          targetDate,
          cityName: cityName || undefined,
          snapshots,
        };
        const res = await fetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const j = await res.json();
        if (!res.ok) {
          setError(j?.error ?? `HTTP ${res.status}`);
          return;
        }
        setResult(j.result as ForecastDivergenceResult);
        setContextLine(`Manual entry · ${snapshots.length} snapshot(s) supplied.`);
      }
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Header
        mode={mode}
        setMode={setMode}
        metric={metric}
        setMetric={setMetric}
        supportedMetrics={supportedMetrics}
        targetDate={targetDate}
        setTargetDate={setTargetDate}
        cityName={cityName}
        setCityName={setCityName}
        zip={zip}
        setZip={setZip}
        lat={lat}
        setLat={setLat}
        lon={lon}
        setLon={setLon}
        manualRows={manualRows}
        setManualRows={setManualRows}
        onRun={runAnalyze}
        busy={busy}
      />

      {error && (
        <div
          style={{
            padding: '10px 14px',
            border: '1px solid #fca5a5',
            background: '#fef2f2',
            color: '#7f1d1d',
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          Failed to analyze: {error}.
        </div>
      )}

      {result && <ForecastDivergenceCard result={result} contextLine={contextLine || undefined} />}
    </div>
  );
}

function Header({
  mode,
  setMode,
  metric,
  setMetric,
  supportedMetrics,
  targetDate,
  setTargetDate,
  cityName,
  setCityName,
  zip,
  setZip,
  lat,
  setLat,
  lon,
  setLon,
  manualRows,
  setManualRows,
  onRun,
  busy,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
  metric: DivergenceMetric;
  setMetric: (m: DivergenceMetric) => void;
  supportedMetrics: DivergenceMetric[];
  targetDate: string;
  setTargetDate: (s: string) => void;
  cityName: string;
  setCityName: (s: string) => void;
  zip: string;
  setZip: (s: string) => void;
  lat: string;
  setLat: (s: string) => void;
  lon: string;
  setLon: (s: string) => void;
  manualRows: ManualRow[];
  setManualRows: (r: ManualRow[]) => void;
  onRun: () => void;
  busy: boolean;
}) {
  const inputStyle: React.CSSProperties = {
    padding: '6px 8px',
    borderRadius: 6,
    border: '1px solid #cbd5e1',
    fontSize: 12,
    background: '#fff',
    color: '#0f172a',
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    display: 'block',
    marginBottom: 2,
  };
  return (
    <div
      style={{
        padding: 16,
        borderRadius: 12,
        background: 'linear-gradient(135deg,#0f172a,#1e293b)',
        color: '#e2e8f0',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.3 }}>
            Forecast divergence intelligence
          </div>
          <h1 style={{ margin: '4px 0 0 0', fontSize: 20, fontWeight: 700 }}>
            Where do forecasts disagree, swing, or settle uncertainly?
          </h1>
        </div>
        <button
          onClick={onRun}
          disabled={busy}
          style={{
            padding: '6px 14px',
            borderRadius: 6,
            border: '1px solid #475569',
            background: busy ? '#334155' : '#2563eb',
            color: '#fff',
            cursor: busy ? 'wait' : 'pointer',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {busy ? 'Analyzing…' : 'Run analysis'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <div>
          <span style={labelStyle}>Snapshot source</span>
          <select
            style={inputStyle}
            value={mode}
            onChange={(e) => setMode(e.target.value as Mode)}
          >
            <option value="stored">Stored revisions (Redis)</option>
            <option value="manual">Manual entry</option>
          </select>
        </div>
        <div>
          <span style={labelStyle}>Metric</span>
          <select
            style={inputStyle}
            value={metric}
            onChange={(e) => setMetric(e.target.value as DivergenceMetric)}
          >
            {supportedMetrics.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <div>
          <span style={labelStyle}>Target date</span>
          <input
            type="date"
            style={inputStyle}
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
          />
        </div>
        <div>
          <span style={labelStyle}>City label</span>
          <input
            style={inputStyle}
            value={cityName}
            placeholder="(optional)"
            onChange={(e) => setCityName(e.target.value)}
          />
        </div>
      </div>

      {mode === 'stored' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
          <div>
            <span style={labelStyle}>Zip (preferred)</span>
            <input
              style={inputStyle}
              value={zip}
              placeholder="e.g. 29209"
              onChange={(e) => setZip(e.target.value)}
            />
          </div>
          <div>
            <span style={labelStyle}>Lat (fallback)</span>
            <input
              style={inputStyle}
              value={lat}
              placeholder="33.97"
              onChange={(e) => setLat(e.target.value)}
            />
          </div>
          <div>
            <span style={labelStyle}>Lon (fallback)</span>
            <input
              style={inputStyle}
              value={lon}
              placeholder="-80.93"
              onChange={(e) => setLon(e.target.value)}
            />
          </div>
        </div>
      ) : (
        <ManualSnapshotsEditor rows={manualRows} setRows={setManualRows} inputStyle={inputStyle} labelStyle={labelStyle} />
      )}

      <div style={{ fontSize: 10, color: '#94a3b8' }}>
        Admin-only operator intelligence. Not customer-facing. Not betting advice. No publishing / pricing / settlement / grading / wallet / market-creation effect from this surface.
      </div>
    </div>
  );
}

function ManualSnapshotsEditor({
  rows,
  setRows,
  inputStyle,
  labelStyle,
}: {
  rows: ManualRow[];
  setRows: (r: ManualRow[]) => void;
  inputStyle: React.CSSProperties;
  labelStyle: React.CSSProperties;
}) {
  function updateRow(i: number, key: keyof ManualRow, value: string) {
    const next = rows.slice();
    next[i] = { ...next[i], [key]: value };
    setRows(next);
  }
  function addRow() {
    if (rows.length >= 30) return;
    setRows([...rows, { forecastTime: '', value: '' }]);
  }
  function removeRow(i: number) {
    const next = rows.slice();
    next.splice(i, 1);
    setRows(next);
  }
  return (
    <div>
      <span style={labelStyle}>Snapshot series (max 30)</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 100px 32px', gap: 6 }}>
            <input
              type="datetime-local"
              style={inputStyle}
              value={r.forecastTime}
              onChange={(e) => updateRow(i, 'forecastTime', e.target.value)}
            />
            <input
              style={inputStyle}
              value={r.value}
              placeholder="value"
              onChange={(e) => updateRow(i, 'value', e.target.value)}
            />
            <button
              onClick={() => removeRow(i)}
              style={{
                ...inputStyle,
                cursor: 'pointer',
                color: '#fff',
                background: '#7f1d1d',
                border: 'none',
                fontWeight: 700,
              }}
              title="Remove this row"
            >
              ×
            </button>
          </div>
        ))}
        <button
          onClick={addRow}
          style={{
            ...inputStyle,
            cursor: 'pointer',
            color: '#fff',
            background: '#1d4ed8',
            border: 'none',
            fontWeight: 600,
            marginTop: 4,
          }}
        >
          + add snapshot row
        </button>
      </div>
    </div>
  );
}

function defaultTargetDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 2);
  return d.toISOString().slice(0, 10);
}

const initialManualRows: ManualRow[] = [
  { forecastTime: '', value: '' },
  { forecastTime: '', value: '' },
  { forecastTime: '', value: '' },
];

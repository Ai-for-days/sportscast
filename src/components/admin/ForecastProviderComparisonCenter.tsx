// ── Step 136: Forecast Provider Comparison Center (admin-only UI) ──────────
//
// Read-only A/B harness for forecast providers. Mirrors the visual
// hierarchy of KalshiMarketDataCenter / PolymarketMarketDataCenter so
// operators have consistent muscle memory.
//
// Open-Meteo is always included. WeatherNext sample / WeatherNext
// production are explicit checkbox opt-ins. Per-provider failures show
// inline; one bad provider never breaks the whole comparison.

import React, { useEffect, useState } from 'react';
import SystemNav from './SystemNav';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const tile: React.CSSProperties = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 12 };
const btn = (bg: string): React.CSSProperties => ({ padding: '6px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const input: React.CSSProperties = { background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', padding: '6px 8px', borderRadius: 6, fontSize: 12 };
const labelStyle: React.CSSProperties = { fontSize: 11, color: '#94a3b8', marginBottom: 4, display: 'block' };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13, color: '#e2e8f0' };
const sectionHeader: React.CSSProperties = { fontSize: 16, fontWeight: 800, marginBottom: 8, color: '#e2e8f0' };
const muted: React.CSSProperties = { fontSize: 12, color: '#94a3b8' };

const BANNER: React.CSSProperties = {
  background: 'linear-gradient(90deg, #155e75, #0e7490)',
  color: '#fff',
  padding: '10px 14px',
  borderRadius: 8,
  marginBottom: 16,
  fontSize: 13,
  fontWeight: 600,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
};

type Tab = 'run' | 'snapshots' | 'gates' | 'methodology';

type QualityHorizon = 'h0' | 'h6' | 'h12' | 'h24';
type QualityField = 'temperature' | 'windSpeed' | 'windGust' | 'precipitation';
type QualityScoreBucket = 'good' | 'acceptable' | 'weak' | 'unavailable';

interface FieldHorizonScore {
  field: QualityField;
  horizon: QualityHorizon;
  forecastValue: number | null;
  observedValue: number | null;
  absError: number | null;
  bucket: QualityScoreBucket;
  unit: string;
  note?: string;
}

interface ProviderQualityScore {
  provider: string;
  label: string;
  scores: FieldHorizonScore[];
  summary: { good: number; acceptable: number; weak: number; unavailable: number };
}

interface ObservationMatch {
  horizon: QualityHorizon;
  targetIso: string;
  matchedIso: string | null;
  matchOffsetMinutes: number | null;
  observedTempF: number | null;
  observedWindMph: number | null;
  observedGustMph: number | null;
}

interface QualityGate {
  id: string;
  comparisonSnapshotId: string;
  comparisonRunAt: string;
  scoredAt: string;
  lat: number;
  lon: number;
  label?: string;
  stationId?: string;
  elapsedHorizons: QualityHorizon[];
  observationSourceNotes: string[];
  observationMatches: ObservationMatch[];
  providers: ProviderQualityScore[];
  warnings: string[];
}

const HORIZON_DISPLAY: Record<QualityHorizon, string> = {
  h0: 'Now',
  h6: '+6h',
  h12: '+12h',
  h24: '+24h',
};

const FIELD_DISPLAY: Record<QualityField, string> = {
  temperature: 'Temp',
  windSpeed: 'Wind',
  windGust: 'Gust',
  precipitation: 'Precip',
};

interface ProviderSummary {
  provider: string;
  label: string;
  ok: boolean;
  failureMode?: string;
  durationMs: number;
  notes: string[];
}

interface FieldDelta {
  field: string;
  label: string;
  values: Record<string, number | null>;
  maxDelta: number | null;
  unit: string;
}

interface ComparisonResult {
  providers: string[];
  completeness: Record<string, number>;
  freshnessMinutes: Record<string, number | null>;
  missingOrDerivedFields: Record<string, string[]>;
  fieldDeltas: FieldDelta[];
  agreement: Record<string, number>;
  warnings: string[];
}

interface Snapshot {
  id: string;
  runAt: string;
  lat: number;
  lon: number;
  days: number;
  label?: string;
  providerSummaries: ProviderSummary[];
  comparison: ComparisonResult;
}

const API = '/api/admin/system/forecast-provider-comparison';

function fmtN(n: number | null | undefined, unit = '', digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)}${unit}`;
}

function fmtAge(min: number | null): string {
  if (min === null) return '—';
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function ForecastProviderComparisonCenter() {
  const [tab, setTab] = useState<Tab>('run');
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [activeSnapshot, setActiveSnapshot] = useState<Snapshot | null>(null);
  const [qualityGates, setQualityGates] = useState<QualityGate[]>([]);
  const [activeGate, setActiveGate] = useState<QualityGate | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [lat, setLat] = useState<string>('34.0007');
  const [lon, setLon] = useState<string>('-81.0348');
  const [label, setLabel] = useState<string>('Columbia, SC');
  const [days, setDays] = useState<number>(5);
  const [includeSample, setIncludeSample] = useState(false);
  const [includeProd, setIncludeProd] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [snapsRes, gatesRes] = await Promise.all([
          fetch(`${API}?action=list-snapshots&limit=50`),
          fetch(`${API}?action=list-quality-gates&limit=50`),
        ]);
        const snapsJ = await snapsRes.json();
        const gatesJ = await gatesRes.json();
        if (cancelled) return;
        if (!snapsRes.ok) throw new Error(snapsJ.message ?? 'list-snapshots failed');
        if (!gatesRes.ok) throw new Error(gatesJ.message ?? 'list-quality-gates failed');
        setSnapshots(snapsJ.snapshots ?? []);
        setQualityGates(gatesJ.results ?? []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Failed to load.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshSnapshots() {
    const r = await fetch(`${API}?action=list-snapshots&limit=50`);
    const j = await r.json();
    if (r.ok) setSnapshots(j.snapshots ?? []);
  }

  async function refreshQualityGates() {
    const r = await fetch(`${API}?action=list-quality-gates&limit=50`);
    const j = await r.json();
    if (r.ok) setQualityGates(j.results ?? []);
  }

  async function onRun() {
    setBusy('run');
    setError(null);
    try {
      const latNum = parseFloat(lat);
      const lonNum = parseFloat(lon);
      if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) {
        throw new Error('lat and lon must be numeric');
      }
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'run-comparison',
          lat: latNum,
          lon: lonNum,
          days,
          label: label || undefined,
          includeWeatherNextSample: includeSample,
          includeWeatherNextProduction: includeProd,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'run-comparison failed');
      setActiveSnapshot(json.snapshot ?? null);
      await refreshSnapshots();
      setTab('snapshots');
    } catch (e: any) {
      setError(e?.message ?? 'Comparison failed.');
    } finally {
      setBusy(null);
    }
  }

  async function onOpenSnapshot(id: string) {
    setBusy('open');
    setError(null);
    try {
      const r = await fetch(`${API}?action=get-snapshot&id=${encodeURIComponent(id)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? 'get-snapshot failed');
      setActiveSnapshot(j.snapshot ?? null);
    } catch (e: any) {
      setError(e?.message ?? 'Open failed.');
    } finally {
      setBusy(null);
    }
  }

  async function onRunGate(comparisonSnapshotId: string) {
    setBusy('gate');
    setError(null);
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run-quality-gate', comparisonSnapshotId }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? 'run-quality-gate failed');
      setActiveGate(j.result ?? null);
      await refreshQualityGates();
      setTab('gates');
    } catch (e: any) {
      setError(e?.message ?? 'Quality gate failed.');
    } finally {
      setBusy(null);
    }
  }

  async function onOpenGate(id: string) {
    setBusy('open-gate');
    setError(null);
    try {
      const r = await fetch(`${API}?action=get-quality-gate&id=${encodeURIComponent(id)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? 'get-quality-gate failed');
      setActiveGate(j.result ?? null);
    } catch (e: any) {
      setError(e?.message ?? 'Open failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ background: '#0f172a', minHeight: '100vh', padding: 16, color: '#e2e8f0' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 12 }}>Forecast Provider Comparison</h1>

      <div style={BANNER}>
        <span>
          Admin-only, read-only diagnostics. Public default unchanged. Open-Meteo continues to serve every customer request.
        </span>
        <span style={{ fontSize: 11, fontWeight: 500 }}>READ_ONLY · ADMIN</span>
      </div>

      <div style={{ ...muted, marginBottom: 12, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        See also:
        <a href="/admin/system/kalshi-market-data" style={{ color: '#22d3ee' }}>Kalshi Market Data</a>
        <a href="/admin/system/polymarket-market-data" style={{ color: '#22d3ee' }}>Polymarket Market Data</a>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {(
          [
            ['run', 'Run Comparison'],
            ['snapshots', 'Snapshots'],
            ['gates', 'Quality Gates'],
            ['methodology', 'Methodology'],
          ] as [Tab, string][]
        ).map(([k, lbl]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            style={{
              ...btn(tab === k ? '#0e7490' : '#334155'),
              opacity: tab === k ? 1 : 0.85,
            }}
          >
            {lbl}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ ...card, background: '#7f1d1d', color: '#fef2f2' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {tab === 'run' && (
        <div style={card}>
          <h2 style={sectionHeader}>Run Comparison</h2>
          <p style={muted}>
            Fetches Open-Meteo (always) plus any explicitly-opted-in WeatherNext provider, in parallel, for the given lat/lon. Each provider runs in isolation — one failure won't break the whole comparison. Snapshot is persisted (retention 200) and audit-logged.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, marginTop: 12, maxWidth: 720 }}>
            <div>
              <span style={labelStyle}>Latitude</span>
              <input style={{ ...input, width: '100%' }} value={lat} onChange={(e) => setLat(e.target.value)} />
            </div>
            <div>
              <span style={labelStyle}>Longitude</span>
              <input style={{ ...input, width: '100%' }} value={lon} onChange={(e) => setLon(e.target.value)} />
            </div>
            <div>
              <span style={labelStyle}>Label (optional)</span>
              <input style={{ ...input, width: '100%' }} value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div>
              <span style={labelStyle}>Forecast horizon (days, 1–15)</span>
              <input style={{ ...input, width: '100%' }} type="number" min={1} max={15} value={days} onChange={(e) => setDays(Number(e.target.value) || 5)} />
            </div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#e2e8f0' }}>
              <input type="checkbox" checked={includeSample} onChange={(e) => setIncludeSample(e.target.checked)} />
              Include WeatherNext (sample) — research/preview, requires GCP creds
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#e2e8f0' }}>
              <input type="checkbox" checked={includeProd} onChange={(e) => setIncludeProd(e.target.checked)} />
              Include WeatherNext (production) — currently always returns endpoint_unconfirmed
            </label>
          </div>
          <div style={{ marginTop: 12 }}>
            <button
              style={{ ...btn('#0e7490'), opacity: busy ? 0.6 : 1 }}
              disabled={!!busy}
              onClick={onRun}
            >
              {busy === 'run' ? 'Comparing…' : 'Run comparison'}
            </button>
          </div>
        </div>
      )}

      {tab === 'snapshots' && (
        <div style={card}>
          <h2 style={sectionHeader}>Snapshots</h2>
          <p style={muted}>
            Each snapshot is one read-only comparison run. Rows here come from Redis, not from a fresh fetch. Retention: latest 200.
          </p>
          {loading ? (
            <div style={{ ...muted, marginTop: 12 }}>Loading…</div>
          ) : snapshots.length === 0 ? (
            <div style={{ ...muted, marginTop: 12 }}>No snapshots yet.</div>
          ) : (
            <div style={{ marginTop: 12, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>When</th>
                    <th style={th}>Location</th>
                    <th style={th}>Providers</th>
                    <th style={th}>Failures</th>
                    <th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((s) => {
                    const failures = s.providerSummaries.filter((p) => !p.ok).length;
                    return (
                      <tr key={s.id}>
                        <td style={td}>{new Date(s.runAt).toLocaleString()}</td>
                        <td style={td}>
                          {s.label ?? '—'}{' '}
                          <span style={muted}>({s.lat.toFixed(3)}, {s.lon.toFixed(3)})</span>
                        </td>
                        <td style={td}>{s.providerSummaries.length}</td>
                        <td style={td} title={failures > 0 ? 'see snapshot detail' : ''}>
                          {failures === 0 ? <span style={{ color: '#22c55e' }}>0</span> : <span style={{ color: '#f97316' }}>{failures}</span>}
                        </td>
                        <td style={td}>
                          <button style={btn('#475569')} onClick={() => onOpenSnapshot(s.id)}>
                            Open
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {activeSnapshot && (
            <div style={{ ...card, marginTop: 16, background: '#0f172a', border: '1px solid #1e293b' }}>
              <h3 style={{ ...sectionHeader, fontSize: 14 }}>Snapshot {activeSnapshot.id}</h3>
              <div style={muted}>
                {new Date(activeSnapshot.runAt).toLocaleString()} ·{' '}
                {activeSnapshot.label ?? `(${activeSnapshot.lat.toFixed(3)}, ${activeSnapshot.lon.toFixed(3)})`} ·{' '}
                horizon {activeSnapshot.days}d
              </div>

              {activeSnapshot.comparison.warnings.length > 0 && (
                <ul style={{ marginTop: 8, color: '#fbbf24', fontSize: 12 }}>
                  {activeSnapshot.comparison.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}

              {/* Provider status cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginTop: 12 }}>
                {activeSnapshot.providerSummaries.map((p) => (
                  <div key={p.provider} style={tile}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: p.ok ? '#22c55e' : '#f97316' }}>
                      {p.label}
                    </div>
                    <div style={muted}>
                      {p.ok
                        ? `Completeness ${activeSnapshot.comparison.completeness[p.provider] ?? '—'}% · ` +
                          `${fmtAge(activeSnapshot.comparison.freshnessMinutes[p.provider] ?? null)} · ` +
                          `${p.durationMs}ms`
                        : `Failed: ${p.failureMode ?? 'unknown'}`}
                    </div>
                    {p.notes.length > 0 && (
                      <ul style={{ marginTop: 6, fontSize: 11, color: '#94a3b8', paddingLeft: 16 }}>
                        {p.notes.slice(0, 3).map((n, i) => (
                          <li key={i}>{n}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>

              {/* Field deltas */}
              <h4 style={{ ...sectionHeader, fontSize: 13, marginTop: 16 }}>Field deltas</h4>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>Field</th>
                      {activeSnapshot.providerSummaries.map((p) => (
                        <th key={p.provider} style={th}>{p.label}</th>
                      ))}
                      <th style={th}>Max delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeSnapshot.comparison.fieldDeltas.map((fd) => (
                      <tr key={fd.field}>
                        <td style={td}>{fd.label}</td>
                        {activeSnapshot.providerSummaries.map((p) => (
                          <td key={p.provider} style={td}>
                            {fmtN(fd.values[p.provider] ?? null, fd.unit)}
                          </td>
                        ))}
                        <td style={td}>{fmtN(fd.maxDelta, ` ${fd.unit}`)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Agreement */}
              {Object.keys(activeSnapshot.comparison.agreement).length > 0 && (
                <>
                  <h4 style={{ ...sectionHeader, fontSize: 13, marginTop: 16 }}>Pairwise agreement</h4>
                  <ul style={{ marginTop: 6, fontSize: 13, color: '#e2e8f0', paddingLeft: 16 }}>
                    {Object.entries(activeSnapshot.comparison.agreement).map(([pair, score]) => (
                      <li key={pair}>{pair}: {score}/100</li>
                    ))}
                  </ul>
                  <div style={{ ...muted, marginTop: 4 }}>
                    Agreement = numerical proximity across temp / precip-prob / wind / gust / humidity / cloud cover. Not accuracy — neither provider is "ground truth" here.
                  </div>
                </>
              )}

              {/* Missing/derived fields per provider */}
              <h4 style={{ ...sectionHeader, fontSize: 13, marginTop: 16 }}>Field quality (per provider)</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                {activeSnapshot.providerSummaries.map((p) => (
                  <div key={p.provider} style={tile}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>{p.label}</div>
                    {(activeSnapshot.comparison.missingOrDerivedFields[p.provider] ?? []).length === 0 ? (
                      <div style={{ ...muted, marginTop: 4, color: '#22c55e' }}>All 14 fields real.</div>
                    ) : (
                      <ul style={{ marginTop: 4, fontSize: 11, color: '#94a3b8', paddingLeft: 16 }}>
                        {(activeSnapshot.comparison.missingOrDerivedFields[p.provider] ?? []).map((f, i) => (
                          <li key={i}>{f}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>

              {/* Step 137: Run quality gate against this snapshot */}
              <div style={{ ...tile, marginTop: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <strong style={{ color: '#e2e8f0' }}>Score this snapshot against NWS observations</strong>
                    <div style={muted}>
                      Retrospective scoring. Wait at least an hour after the snapshot for the first horizon to elapse.
                    </div>
                  </div>
                  <button
                    style={{ ...btn('#0e7490'), opacity: busy ? 0.6 : 1 }}
                    disabled={!!busy}
                    onClick={() => onRunGate(activeSnapshot.id)}
                  >
                    {busy === 'gate' ? 'Scoring…' : 'Run quality gate'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'gates' && (
        <div style={card}>
          <h2 style={sectionHeader}>Quality Gates</h2>
          <p style={muted}>
            Retrospective scoring of provider forecasts against official NWS observations. <strong>This measures forecast accuracy after the fact. It does not resolve markets.</strong> Single-snapshot, single-location scores are noisy by nature — use them as one data point, not a verdict.
          </p>

          {qualityGates.length === 0 ? (
            <div style={{ ...muted, marginTop: 12 }}>
              No quality-gate runs yet. Open a snapshot in the Snapshots tab and click "Run quality gate".
            </div>
          ) : (
            <div style={{ marginTop: 12, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>Scored at</th>
                    <th style={th}>Snapshot</th>
                    <th style={th}>Location</th>
                    <th style={th}>Station</th>
                    <th style={th}>Elapsed</th>
                    <th style={th}>Providers</th>
                    <th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {qualityGates.map((g) => (
                    <tr key={g.id}>
                      <td style={td}>{new Date(g.scoredAt).toLocaleString()}</td>
                      <td style={td}><code style={{ fontSize: 11 }}>{g.comparisonSnapshotId}</code></td>
                      <td style={td}>
                        {g.label ?? '—'}{' '}
                        <span style={muted}>({g.lat.toFixed(3)}, {g.lon.toFixed(3)})</span>
                      </td>
                      <td style={td}>{g.stationId ?? '—'}</td>
                      <td style={td}>{g.elapsedHorizons.join(', ') || '—'}</td>
                      <td style={td}>{g.providers.length}</td>
                      <td style={td}>
                        <button style={btn('#475569')} onClick={() => onOpenGate(g.id)}>
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeGate && (
            <div style={{ ...card, marginTop: 16, background: '#0f172a', border: '1px solid #1e293b' }}>
              <h3 style={{ ...sectionHeader, fontSize: 14 }}>Quality gate {activeGate.id}</h3>
              <div style={muted}>
                Snapshot {activeGate.comparisonSnapshotId} ·{' '}
                {activeGate.label ?? `(${activeGate.lat.toFixed(3)}, ${activeGate.lon.toFixed(3)})`} ·{' '}
                station {activeGate.stationId ?? '—'} ·{' '}
                scored {new Date(activeGate.scoredAt).toLocaleString()}
              </div>

              {activeGate.warnings.length > 0 && (
                <ul style={{ marginTop: 8, color: '#fbbf24', fontSize: 12 }}>
                  {activeGate.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
              {activeGate.observationSourceNotes.length > 0 && (
                <ul style={{ marginTop: 8, color: '#94a3b8', fontSize: 11 }}>
                  {activeGate.observationSourceNotes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              )}

              {/* Provider score cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 12 }}>
                {activeGate.providers.map((p) => (
                  <div key={p.provider} style={tile}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{p.label}</div>
                    <div style={muted}>
                      <span style={{ color: '#22c55e' }}>{p.summary.good} good</span>{' · '}
                      <span style={{ color: '#fbbf24' }}>{p.summary.acceptable} accept</span>{' · '}
                      <span style={{ color: '#f97316' }}>{p.summary.weak} weak</span>{' · '}
                      <span style={{ color: '#94a3b8' }}>{p.summary.unavailable} n/a</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Per-(field, horizon) score grid */}
              {activeGate.providers.length > 0 && (
                <>
                  <h4 style={{ ...sectionHeader, fontSize: 13, marginTop: 16 }}>Forecast vs observed (|error|)</h4>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={th}>Provider</th>
                          <th style={th}>Field</th>
                          {(['h0', 'h6', 'h12', 'h24'] as QualityHorizon[]).map((h) => (
                            <th key={h} style={th}>{HORIZON_DISPLAY[h]}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {activeGate.providers.flatMap((p) =>
                          (['temperature', 'windSpeed', 'windGust'] as QualityField[]).map((field) => (
                            <tr key={`${p.provider}:${field}`}>
                              <td style={td}>{p.label}</td>
                              <td style={td}>{FIELD_DISPLAY[field]}</td>
                              {(['h0', 'h6', 'h12', 'h24'] as QualityHorizon[]).map((h) => {
                                const cell = p.scores.find((s) => s.field === field && s.horizon === h);
                                if (!cell) {
                                  return <td key={h} style={td}>—</td>;
                                }
                                const tone =
                                  cell.bucket === 'good'
                                    ? '#22c55e'
                                    : cell.bucket === 'acceptable'
                                    ? '#fbbf24'
                                    : cell.bucket === 'weak'
                                    ? '#f97316'
                                    : '#94a3b8';
                                return (
                                  <td key={h} style={td} title={cell.note ?? ''}>
                                    {cell.absError !== null ? (
                                      <span style={{ color: tone, fontWeight: 600 }}>
                                        {cell.absError}
                                        {cell.unit}
                                      </span>
                                    ) : (
                                      <span style={{ color: tone, fontStyle: 'italic' }}>{cell.bucket}</span>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          )),
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* Observation matches */}
              <h4 style={{ ...sectionHeader, fontSize: 13, marginTop: 16 }}>Observation matches</h4>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>Horizon</th>
                      <th style={th}>Target</th>
                      <th style={th}>Matched</th>
                      <th style={th}>Off-target</th>
                      <th style={th}>Temp</th>
                      <th style={th}>Wind</th>
                      <th style={th}>Gust</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeGate.observationMatches.map((m) => (
                      <tr key={m.horizon}>
                        <td style={td}>{HORIZON_DISPLAY[m.horizon]}</td>
                        <td style={td}>{new Date(m.targetIso).toLocaleString()}</td>
                        <td style={td}>{m.matchedIso ? new Date(m.matchedIso).toLocaleString() : '—'}</td>
                        <td style={td}>{m.matchOffsetMinutes !== null ? `${m.matchOffsetMinutes} min` : '—'}</td>
                        <td style={td}>{m.observedTempF !== null ? `${m.observedTempF}°F` : '—'}</td>
                        <td style={td}>{m.observedWindMph !== null ? `${m.observedWindMph} mph` : '—'}</td>
                        <td style={td}>{m.observedGustMph !== null ? `${m.observedGustMph} mph` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'methodology' && (
        <div style={card}>
          <h2 style={sectionHeader}>Methodology</h2>
          <ul style={{ marginTop: 8, lineHeight: 1.7 }}>
            <li>Open-Meteo is fetched directly via <code>getOpenMeteoForecast</code>.</li>
            <li>WeatherNext (sample) is fetched via <code>fetchBigQueryWeatherNextSample</code> (Step 136 extraction).</li>
            <li>WeatherNext (production) is attempted via <code>tryWeatherNextForecast</code> — currently returns <code>endpoint_unconfirmed</code> until Step ?? confirms the Vertex AI contract.</li>
            <li>Per-provider fetches run in parallel and fail in isolation. One bad provider never breaks the comparison.</li>
            <li>Completeness = share of the 14 declared fields rated <code>'real'</code> (not derived/fabricated/absent) per <code>forecast-provider-metadata.ts</code>.</li>
            <li>Freshness = minutes since the provider's <code>generatedAt</code>.</li>
            <li>Field deltas evaluate at <code>current</code> for temp/wind/humidity/cloud-cover and <code>next-12h max</code> for precip-probability and wind gust.</li>
            <li>Agreement is heuristic numerical proximity across the 6 comparison fields with per-field tolerances. **Not accuracy.** No ground-truth observation comparison happens here.</li>
            <li>Snapshot store: <code>forecast-provider-comparison:&lt;id&gt;</code> + sorted set <code>forecast-provider-comparisons:all</code>, retention 200.</li>
            <li>Audit event: <code>forecast_provider_comparison_run</code> via <code>audit-log.ts</code>.</li>
          </ul>
          <div style={{ ...tile, marginTop: 12 }}>
            <strong>Step 137 quality gates:</strong>{' '}
            <span style={muted}>
              Retrospective scoring against NWS observations. Per-provider, per-horizon, per-field absolute error bucketed good (≤2°F / ≤4mph / ≤5mph gust), acceptable (≤5°F / ≤8mph / ≤10mph gust), weak, or unavailable. Precipitation probability calibration is intentionally not scored on a single snapshot — too noisy. Settlement still uses NWS observations through <code>nws-grading.ts</code> / <code>nws-observations.ts</code>; this layer reads the same source for diagnostics only.
            </span>
          </div>
          <div style={{ ...tile, marginTop: 12 }}>
            <strong>Out of scope (Step 136/137):</strong>{' '}
            <span style={muted}>
              automated quality gates across many cities, scheduled batch scoring, automatic public default switching. Those belong to later phases of <code>docs/weathernext-integration-plan.md</code>.
            </span>
          </div>
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <SystemNav activeHref="/admin/system/forecast-provider-comparison" />
      </div>
    </div>
  );
}

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

type Tab = 'run' | 'snapshots' | 'gates' | 'batch' | 'trends' | 'methodology';

type TrendWindow = '24h' | '7d' | '30d';
type TrendDirection = 'improving' | 'stable' | 'degrading' | 'insufficient_data';

interface AxisTrend {
  current: number | null;
  prior: number | null;
  direction: TrendDirection;
  note: string;
}

interface ProviderTrendSummary {
  provider: string;
  label: string;
  reportCount: number;
  totalCells: number;
  totalUnavailable: number;
  weakRatePct: number;
  unavailableRatePct: number;
  meanTempErrorTrend: AxisTrend;
  weakRateTrend: AxisTrend;
  unavailableRateTrend: AxisTrend;
  perField: Record<QualityField, AxisTrend>;
  perHorizon: Record<QualityHorizon, AxisTrend>;
}

interface CityOutlier {
  cityId: string;
  cityLabel: string;
  failureCount: number;
  appearanceCount: number;
  failureRatePct: number;
}

interface TrendInsight {
  text: string;
  severity: 'info' | 'notice' | 'warning';
}

interface TrendDashboard {
  window: TrendWindow;
  windowStartIso: string;
  windowEndIso: string;
  reportCount: number;
  providers: ProviderTrendSummary[];
  cityOutliers: CityOutlier[];
  insights: TrendInsight[];
  warnings: string[];
}

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

function DirectionBadge({ dir, title }: { dir: 'improving' | 'stable' | 'degrading' | 'insufficient_data'; title?: string }) {
  const tone =
    dir === 'improving'
      ? '#22c55e'
      : dir === 'stable'
      ? '#94a3b8'
      : dir === 'degrading'
      ? '#f97316'
      : '#475569';
  const arrow =
    dir === 'improving'
      ? '↓'
      : dir === 'degrading'
      ? '↑'
      : dir === 'stable'
      ? '·'
      : '?';
  const label =
    dir === 'improving'
      ? 'improving'
      : dir === 'stable'
      ? 'stable'
      : dir === 'degrading'
      ? 'degrading'
      : 'n/a';
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 11,
        fontWeight: 600,
        color: tone,
      }}
    >
      <span aria-hidden="true">{arrow}</span>
      <span>{label}</span>
    </span>
  );
}

interface SeedCity {
  id: string;
  label: string;
  lat: number;
  lon: number;
  region: string;
}

type BucketCounts = { good: number; acceptable: number; weak: number; unavailable: number };

interface FieldHorizonAggregate {
  cellsScored: number;
  buckets: BucketCounts;
  meanAbsError: number | null;
}

interface ProviderAggregate {
  provider: string;
  label: string;
  cellsScored: number;
  summary: BucketCounts;
  perField: Record<QualityField, FieldHorizonAggregate>;
  perHorizon: Record<QualityHorizon, FieldHorizonAggregate>;
  cityCount: number;
  meanTempErrorF: number | null;
}

interface BatchGateRow {
  cityId: string;
  cityLabel: string;
  comparisonSnapshotId: string;
  ok: boolean;
  qualityGateId?: string;
  warnings: string[];
}

interface BatchReport {
  id: string;
  runAt: string;
  seedCityCount: number;
  eligibleCityCount: number;
  scoredCityCount: number;
  rows: BatchGateRow[];
  providerAggregates: ProviderAggregate[];
  topIssues: string[];
  warnings: string[];
}

interface SeededBatchRow {
  cityId: string;
  cityLabel: string;
  ok: boolean;
  snapshotId?: string;
  providerCount?: number;
  durationMs: number;
  failureMode?: string;
  notes: string[];
}

interface SeededBatchResult {
  id: string;
  runAt: string;
  seedCityCount: number;
  rows: SeededBatchRow[];
  warnings: string[];
}

interface CronState {
  lastSeededComparisonAt?: string;
  lastSeededComparisonRanAt?: string;
  lastSeededComparisonStatus?: 'ran' | 'skipped' | 'failed';
  lastSeededComparisonSummary?: string;
  lastQualityReportAt?: string;
  lastQualityReportRanAt?: string;
  lastQualityReportStatus?: 'ran' | 'skipped' | 'failed';
  lastQualityReportSummary?: string;
  lastFailureAt?: string;
  lastFailureSummary?: string;
}

interface WeatherNextReadiness {
  ready: boolean;
  status: 'not_ready_contract' | 'config_present_contract_unconfirmed' | 'ready';
  statusLabel: string;
  missing: string[];
  envPresence: {
    GCP_PROJECT_ID: boolean;
    GCP_CREDENTIALS_BASE64: boolean;
    WEATHERNEXT_VERTEX_REGION: boolean;
    WEATHERNEXT_VERTEX_ENDPOINT_ID: boolean;
    WEATHERNEXT_VERTEX_MODEL_ID: boolean;
  };
  warnings: string[];
  contractConfirmed: boolean;
}

type SmokeProvider =
  | 'open-meteo'
  | 'weathernext-production'
  | 'weathernext-bigquery-sample'
  | 'weathernext-bigquery-production';

type SmokeStatus =
  | 'live_call_ok'
  | 'live_call_failed'
  | 'readiness_ok'
  | 'unconfigured'
  | 'contract_unconfirmed'
  | 'skipped'
  | 'failed';

interface SmokeProviderStatus {
  provider: SmokeProvider;
  label: string;
  liveCallAvailable: boolean;
  statusLabel: string;
}

interface SmokeTestResult {
  provider: SmokeProvider;
  label: string;
  ok: boolean;
  status: SmokeStatus;
  durationMs: number;
  summary: string;
  notes: string[];
  responseFingerprint?: Record<string, string | number | boolean | null>;
}

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
  const [seedCities, setSeedCities] = useState<SeedCity[]>([]);
  const [batchReports, setBatchReports] = useState<BatchReport[]>([]);
  const [activeReport, setActiveReport] = useState<BatchReport | null>(null);
  const [latestSeededBatch, setLatestSeededBatch] = useState<SeededBatchResult | null>(null);
  const [batchIncludeSample, setBatchIncludeSample] = useState(false);
  const [batchIncludeProd, setBatchIncludeProd] = useState(false);
  const [cronState, setCronState] = useState<CronState | null>(null);
  const [wnReadiness, setWnReadiness] = useState<WeatherNextReadiness | null>(null);
  const [smokeProviders, setSmokeProviders] = useState<SmokeProviderStatus[]>([]);
  const [smokeResults, setSmokeResults] = useState<Record<string, SmokeTestResult>>({});
  const [smokeBusy, setSmokeBusy] = useState<string | null>(null);
  const [trendWindow, setTrendWindow] = useState<TrendWindow>('7d');
  const [trendDashboard, setTrendDashboard] = useState<TrendDashboard | null>(null);
  const [trendLoading, setTrendLoading] = useState(false);
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
        const [snapsRes, gatesRes, seedsRes, reportsRes, cronRes, wnRes, smokeRes] = await Promise.all([
          fetch(`${API}?action=list-snapshots&limit=50`),
          fetch(`${API}?action=list-quality-gates&limit=50`),
          fetch(`${API}?action=list-seed-cities`),
          fetch(`${API}?action=list-quality-reports&limit=30`),
          fetch(`${API}?action=get-cron-state`),
          fetch(`${API}?action=get-weathernext-readiness`),
          fetch(`${API}?action=get-provider-smoke-tests`),
        ]);
        const snapsJ = await snapsRes.json();
        const gatesJ = await gatesRes.json();
        const seedsJ = await seedsRes.json();
        const reportsJ = await reportsRes.json();
        const cronJ = await cronRes.json();
        const wnJ = await wnRes.json();
        const smokeJ = await smokeRes.json();
        if (cancelled) return;
        if (!snapsRes.ok) throw new Error(snapsJ.message ?? 'list-snapshots failed');
        if (!gatesRes.ok) throw new Error(gatesJ.message ?? 'list-quality-gates failed');
        if (!seedsRes.ok) throw new Error(seedsJ.message ?? 'list-seed-cities failed');
        if (!reportsRes.ok) throw new Error(reportsJ.message ?? 'list-quality-reports failed');
        if (!cronRes.ok) throw new Error(cronJ.message ?? 'get-cron-state failed');
        if (!wnRes.ok) throw new Error(wnJ.message ?? 'get-weathernext-readiness failed');
        if (!smokeRes.ok) throw new Error(smokeJ.message ?? 'get-provider-smoke-tests failed');
        setSnapshots(snapsJ.snapshots ?? []);
        setQualityGates(gatesJ.results ?? []);
        setSeedCities(seedsJ.seedCities ?? []);
        setBatchReports(reportsJ.reports ?? []);
        setCronState(cronJ.state ?? {});
        setWnReadiness(wnJ.readiness ?? null);
        setSmokeProviders(smokeJ.providers ?? []);
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

  async function refreshBatchReports() {
    const r = await fetch(`${API}?action=list-quality-reports&limit=30`);
    const j = await r.json();
    if (r.ok) setBatchReports(j.reports ?? []);
  }

  async function onRunSeededBatch() {
    setBusy('seeded-batch');
    setError(null);
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'run-seeded-batch-comparison',
          includeWeatherNextSample: batchIncludeSample,
          includeWeatherNextProduction: batchIncludeProd,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? 'run-seeded-batch-comparison failed');
      setLatestSeededBatch(j.result ?? null);
      await refreshSnapshots();
    } catch (e: any) {
      setError(e?.message ?? 'Seeded batch failed.');
    } finally {
      setBusy(null);
    }
  }

  async function onRunBatchReport() {
    setBusy('batch-report');
    setError(null);
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run-batch-quality-report' }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? 'run-batch-quality-report failed');
      setActiveReport(j.report ?? null);
      await refreshBatchReports();
      await refreshQualityGates();
    } catch (e: any) {
      setError(e?.message ?? 'Batch report failed.');
    } finally {
      setBusy(null);
    }
  }

  async function onRunSmokeTest(provider: SmokeProvider, opts: { live?: boolean }) {
    setSmokeBusy(provider);
    setError(null);
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'run-provider-smoke-test',
          provider,
          attemptLiveCall: !!opts.live,
          attemptLiveQuery: !!opts.live,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? 'run-provider-smoke-test failed');
      setSmokeResults((prev) => ({ ...prev, [provider]: j.result }));
    } catch (e: any) {
      setError(e?.message ?? 'Smoke test failed.');
    } finally {
      setSmokeBusy(null);
    }
  }

  async function loadTrendDashboard(window: TrendWindow) {
    setTrendLoading(true);
    setError(null);
    try {
      const r = await fetch(`${API}?action=get-quality-trends&window=${encodeURIComponent(window)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? 'get-quality-trends failed');
      setTrendDashboard(j.dashboard ?? null);
    } catch (e: any) {
      setError(e?.message ?? 'Trend load failed.');
    } finally {
      setTrendLoading(false);
    }
  }

  // Auto-load trend dashboard the first time the tab is opened, and reload
  // when the window selector changes.
  useEffect(() => {
    if (tab === 'trends') {
      loadTrendDashboard(trendWindow);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, trendWindow]);

  async function onOpenReport(id: string) {
    setBusy('open-report');
    setError(null);
    try {
      const r = await fetch(`${API}?action=get-quality-report&id=${encodeURIComponent(id)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? 'get-quality-report failed');
      setActiveReport(j.report ?? null);
    } catch (e: any) {
      setError(e?.message ?? 'Open failed.');
    } finally {
      setBusy(null);
    }
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
            ['batch', 'Batch Reports'],
            ['trends', 'Trend Dashboard'],
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

      {tab === 'batch' && (
        <div style={card}>
          <h2 style={sectionHeader}>Batch Reports</h2>
          <p style={muted}>
            Run forecast comparisons across {seedCities.length} seeded city/cities, then aggregate quality-gate scores into a single rolling report. <strong>This is retrospective diagnostics. It does not resolve markets.</strong> Single-snapshot scores are noisy; batch aggregates across many cities are the real signal — but still treat any single report as a data point, not a verdict.
          </p>

          {/* Step 139: scheduled cron status */}
          {cronState && (
            <div style={{ ...tile, marginTop: 12, background: '#0c1f2c', borderColor: '#155e75' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>Scheduled automation</div>
              <div style={{ ...muted, marginTop: 4 }}>
                Vercel Cron drives <code>/api/cron/forecast-quality</code> on a 6-hour seeded-comparison cadence and a daily quality report. Cadence guards block accidental re-runs; <code>?force=true</code> + a valid bearer secret bypasses.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, marginTop: 8 }}>
                <div>
                  <div style={muted}>Last seeded comparison</div>
                  <div style={{ fontSize: 12, color: '#e2e8f0' }}>
                    {cronState.lastSeededComparisonRanAt
                      ? new Date(cronState.lastSeededComparisonRanAt).toLocaleString()
                      : '—'}
                    {' '}
                    {cronState.lastSeededComparisonStatus && (
                      <span
                        style={{
                          color:
                            cronState.lastSeededComparisonStatus === 'ran'
                              ? '#22c55e'
                              : cronState.lastSeededComparisonStatus === 'skipped'
                              ? '#94a3b8'
                              : '#f97316',
                        }}
                      >
                        ({cronState.lastSeededComparisonStatus})
                      </span>
                    )}
                  </div>
                  {cronState.lastSeededComparisonSummary && (
                    <div style={{ ...muted, marginTop: 2 }}>{cronState.lastSeededComparisonSummary}</div>
                  )}
                </div>
                <div>
                  <div style={muted}>Last quality report</div>
                  <div style={{ fontSize: 12, color: '#e2e8f0' }}>
                    {cronState.lastQualityReportRanAt
                      ? new Date(cronState.lastQualityReportRanAt).toLocaleString()
                      : '—'}
                    {' '}
                    {cronState.lastQualityReportStatus && (
                      <span
                        style={{
                          color:
                            cronState.lastQualityReportStatus === 'ran'
                              ? '#22c55e'
                              : cronState.lastQualityReportStatus === 'skipped'
                              ? '#94a3b8'
                              : '#f97316',
                        }}
                      >
                        ({cronState.lastQualityReportStatus})
                      </span>
                    )}
                  </div>
                  {cronState.lastQualityReportSummary && (
                    <div style={{ ...muted, marginTop: 2 }}>{cronState.lastQualityReportSummary}</div>
                  )}
                </div>
              </div>
              {cronState.lastFailureSummary && (
                <div style={{ ...muted, marginTop: 6, color: '#f97316' }}>
                  Last failure: {cronState.lastFailureSummary}
                  {cronState.lastFailureAt && ` (${new Date(cronState.lastFailureAt).toLocaleString()})`}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginTop: 12 }}>
            <div style={tile}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>1. Seeded batch comparison</div>
              <div style={muted}>
                Run a fresh comparison against every seeded city in parallel (concurrency 3). Each city's snapshot becomes eligible to score about an hour later, once h0 elapses + the publication grace.
              </div>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#e2e8f0' }}>
                  <input type="checkbox" checked={batchIncludeSample} onChange={(e) => setBatchIncludeSample(e.target.checked)} />
                  Include WeatherNext sample (research)
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#e2e8f0' }}>
                  <input type="checkbox" checked={batchIncludeProd} onChange={(e) => setBatchIncludeProd(e.target.checked)} />
                  Include WeatherNext production (currently fails closed)
                </label>
              </div>
              <button
                style={{ ...btn('#0e7490'), marginTop: 8, opacity: busy ? 0.6 : 1 }}
                disabled={!!busy}
                onClick={onRunSeededBatch}
              >
                {busy === 'seeded-batch' ? 'Running…' : `Run seeded comparison across ${seedCities.length} cities`}
              </button>
            </div>

            <div style={tile}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>2. Batch quality report</div>
              <div style={muted}>
                Score the most recent eligible snapshot for each seeded city against NWS observations and aggregate into one rolling report (retention 90).
              </div>
              <button
                style={{ ...btn('#0e7490'), marginTop: 8, opacity: busy ? 0.6 : 1 }}
                disabled={!!busy}
                onClick={onRunBatchReport}
              >
                {busy === 'batch-report' ? 'Aggregating…' : 'Run batch quality report'}
              </button>
            </div>
          </div>

          <h4 style={{ ...sectionHeader, fontSize: 13, marginTop: 16 }}>Seed cities ({seedCities.length})</h4>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Region</th>
                  <th style={th}>City</th>
                  <th style={th}>Lat</th>
                  <th style={th}>Lon</th>
                </tr>
              </thead>
              <tbody>
                {seedCities.map((c) => (
                  <tr key={c.id}>
                    <td style={td}>{c.region}</td>
                    <td style={td}>{c.label}</td>
                    <td style={td}>{c.lat.toFixed(3)}</td>
                    <td style={td}>{c.lon.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {latestSeededBatch && (
            <div style={{ ...card, marginTop: 16, background: '#0f172a', border: '1px solid #1e293b' }}>
              <h4 style={{ ...sectionHeader, fontSize: 13 }}>Latest seeded batch run</h4>
              <div style={muted}>
                {latestSeededBatch.id} · {new Date(latestSeededBatch.runAt).toLocaleString()} · {latestSeededBatch.seedCityCount} city/cities
              </div>
              {latestSeededBatch.warnings.length > 0 && (
                <ul style={{ marginTop: 8, color: '#fbbf24', fontSize: 12 }}>
                  {latestSeededBatch.warnings.map((w, i) => (<li key={i}>{w}</li>))}
                </ul>
              )}
              <div style={{ overflowX: 'auto', marginTop: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>City</th>
                      <th style={th}>Status</th>
                      <th style={th}>Providers</th>
                      <th style={th}>Duration</th>
                      <th style={th}>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latestSeededBatch.rows.map((r) => (
                      <tr key={r.cityId}>
                        <td style={td}>{r.cityLabel}</td>
                        <td style={td}>
                          {r.ok
                            ? <span style={{ color: '#22c55e' }}>ok</span>
                            : <span style={{ color: '#f97316' }}>{r.failureMode ?? 'failed'}</span>}
                        </td>
                        <td style={td}>{r.providerCount ?? '—'}</td>
                        <td style={td}>{r.durationMs}ms</td>
                        <td style={td}>{r.notes.slice(0, 1).join(' ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <h4 style={{ ...sectionHeader, fontSize: 13, marginTop: 16 }}>Recent quality reports</h4>
          {batchReports.length === 0 ? (
            <div style={muted}>No batch quality reports yet. Run a seeded comparison, wait an hour, then run a batch quality report.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>Run at</th>
                    <th style={th}>Eligible</th>
                    <th style={th}>Scored</th>
                    <th style={th}>Providers</th>
                    <th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {batchReports.map((r) => (
                    <tr key={r.id}>
                      <td style={td}>{new Date(r.runAt).toLocaleString()}</td>
                      <td style={td}>{r.eligibleCityCount} / {r.seedCityCount}</td>
                      <td style={td}>{r.scoredCityCount}</td>
                      <td style={td}>{r.providerAggregates.length}</td>
                      <td style={td}>
                        <button style={btn('#475569')} onClick={() => onOpenReport(r.id)}>Open</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeReport && (
            <div style={{ ...card, marginTop: 16, background: '#0f172a', border: '1px solid #1e293b' }}>
              <h3 style={{ ...sectionHeader, fontSize: 14 }}>Report {activeReport.id}</h3>
              <div style={muted}>
                {new Date(activeReport.runAt).toLocaleString()} · {activeReport.scoredCityCount} scored / {activeReport.eligibleCityCount} eligible / {activeReport.seedCityCount} seeded
              </div>
              {activeReport.topIssues.length > 0 && (
                <div style={{ ...tile, marginTop: 8, background: '#451a03', borderColor: '#7c2d12' }}>
                  <strong style={{ color: '#fef2f2' }}>Top issues</strong>
                  <ul style={{ marginTop: 4, fontSize: 12, color: '#fed7aa', paddingLeft: 16 }}>
                    {activeReport.topIssues.map((iss, i) => (<li key={i}>{iss}</li>))}
                  </ul>
                </div>
              )}
              {activeReport.warnings.length > 0 && (
                <ul style={{ marginTop: 8, color: '#fbbf24', fontSize: 12, paddingLeft: 16 }}>
                  {activeReport.warnings.map((w, i) => (<li key={i}>{w}</li>))}
                </ul>
              )}

              {/* Provider aggregate score cards */}
              <h4 style={{ ...sectionHeader, fontSize: 13, marginTop: 16 }}>Provider aggregates</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
                {activeReport.providerAggregates.map((p) => (
                  <div key={p.provider} style={tile}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{p.label}</div>
                    <div style={muted}>
                      {p.cityCount} city/cities · {p.cellsScored} cells scored
                    </div>
                    <div style={{ ...muted, marginTop: 4 }}>
                      <span style={{ color: '#22c55e' }}>{p.summary.good} good</span>{' · '}
                      <span style={{ color: '#fbbf24' }}>{p.summary.acceptable} accept</span>{' · '}
                      <span style={{ color: '#f97316' }}>{p.summary.weak} weak</span>{' · '}
                      <span style={{ color: '#94a3b8' }}>{p.summary.unavailable} n/a</span>
                    </div>
                    {p.meanTempErrorF !== null && (
                      <div style={{ ...muted, marginTop: 4 }}>
                        Mean |Δtemp|: <strong style={{ color: '#e2e8f0' }}>{p.meanTempErrorF}°F</strong>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Per-(provider, field) mean abs error grid */}
              {activeReport.providerAggregates.length > 0 && (
                <>
                  <h4 style={{ ...sectionHeader, fontSize: 13, marginTop: 16 }}>Mean |error| by field</h4>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={th}>Provider</th>
                          {(['temperature', 'windSpeed', 'windGust'] as QualityField[]).map((f) => (
                            <th key={f} style={th}>{FIELD_DISPLAY[f]}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {activeReport.providerAggregates.map((p) => (
                          <tr key={p.provider}>
                            <td style={td}>{p.label}</td>
                            {(['temperature', 'windSpeed', 'windGust'] as QualityField[]).map((f) => {
                              const slot = p.perField[f];
                              const unit = f === 'temperature' ? '°F' : 'mph';
                              return (
                                <td key={f} style={td}>
                                  {slot.meanAbsError !== null ? `${slot.meanAbsError}${unit}` : '—'}
                                  <div style={{ fontSize: 10, color: '#94a3b8' }}>
                                    {slot.cellsScored} cells
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <h4 style={{ ...sectionHeader, fontSize: 13, marginTop: 16 }}>Mean |error| by horizon</h4>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={th}>Provider</th>
                          {(['h0', 'h6', 'h12', 'h24'] as QualityHorizon[]).map((h) => (
                            <th key={h} style={th}>{HORIZON_DISPLAY[h]}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {activeReport.providerAggregates.map((p) => (
                          <tr key={p.provider}>
                            <td style={td}>{p.label}</td>
                            {(['h0', 'h6', 'h12', 'h24'] as QualityHorizon[]).map((h) => {
                              const slot = p.perHorizon[h];
                              return (
                                <td key={h} style={td}>
                                  {slot.meanAbsError !== null ? slot.meanAbsError : '—'}
                                  <div style={{ fontSize: 10, color: '#94a3b8' }}>
                                    {slot.cellsScored} cells
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* Per-city rows */}
              <h4 style={{ ...sectionHeader, fontSize: 13, marginTop: 16 }}>Per-city outcomes</h4>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>City</th>
                      <th style={th}>Snapshot</th>
                      <th style={th}>Status</th>
                      <th style={th}>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeReport.rows.map((r) => (
                      <tr key={r.cityId + r.comparisonSnapshotId}>
                        <td style={td}>{r.cityLabel}</td>
                        <td style={td}><code style={{ fontSize: 11 }}>{r.comparisonSnapshotId}</code></td>
                        <td style={td}>
                          {r.ok ? <span style={{ color: '#22c55e' }}>scored</span> : <span style={{ color: '#f97316' }}>not scored</span>}
                        </td>
                        <td style={td}>{r.warnings.slice(0, 2).join(' · ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'trends' && (
        <div style={card}>
          <h2 style={sectionHeader}>Trend Dashboard</h2>
          <p style={muted}>
            Rolling forecast quality trends aggregated from the Step 138 batch reports. <strong>Heuristic, not statistical inference.</strong> Direction labels (improving / stable / degrading) compare the later half of the window against the earlier half — useful as a prompt to investigate, not a verdict. Sample counts are surfaced everywhere; trust persistent multi-period direction rather than single readings.
          </p>

          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={muted}>Window:</span>
            {(['24h', '7d', '30d'] as TrendWindow[]).map((w) => (
              <button
                key={w}
                onClick={() => setTrendWindow(w)}
                style={{
                  ...btn(trendWindow === w ? '#0e7490' : '#334155'),
                  opacity: trendWindow === w ? 1 : 0.85,
                }}
              >
                {w}
              </button>
            ))}
            <button
              style={{ ...btn('#475569'), opacity: trendLoading ? 0.6 : 1 }}
              disabled={trendLoading}
              onClick={() => loadTrendDashboard(trendWindow)}
            >
              {trendLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {!trendDashboard ? (
            <div style={{ ...muted, marginTop: 12 }}>
              {trendLoading ? 'Loading trend data…' : 'No trend data loaded yet.'}
            </div>
          ) : (
            <>
              <div style={{ ...muted, marginTop: 12 }}>
                {trendDashboard.reportCount} report(s) in window ·{' '}
                {new Date(trendDashboard.windowStartIso).toLocaleString()} →{' '}
                {new Date(trendDashboard.windowEndIso).toLocaleString()}
              </div>

              {trendDashboard.warnings.length > 0 && (
                <ul style={{ marginTop: 8, color: '#fbbf24', fontSize: 12, paddingLeft: 16 }}>
                  {trendDashboard.warnings.map((w, i) => (<li key={i}>{w}</li>))}
                </ul>
              )}

              {/* Insights */}
              {trendDashboard.insights.length > 0 && (
                <div style={{ ...tile, marginTop: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0', marginBottom: 6 }}>Insights</div>
                  <ul style={{ fontSize: 12, paddingLeft: 16, margin: 0 }}>
                    {trendDashboard.insights.map((ins, i) => (
                      <li
                        key={i}
                        style={{
                          color:
                            ins.severity === 'warning'
                              ? '#f97316'
                              : ins.severity === 'notice'
                              ? '#fbbf24'
                              : '#e2e8f0',
                          marginBottom: 4,
                        }}
                      >
                        {ins.text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Provider trend cards */}
              {trendDashboard.providers.length === 0 ? (
                <div style={{ ...muted, marginTop: 12 }}>No providers with reports in this window.</div>
              ) : (
                <>
                  <h4 style={{ ...sectionHeader, fontSize: 13, marginTop: 16 }}>Provider trends</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
                    {trendDashboard.providers.map((p) => (
                      <div key={p.provider} style={tile}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{p.label}</div>
                        <div style={muted}>
                          {p.reportCount} report(s) · {p.totalCells} scored cells · {p.totalUnavailable} unavailable
                        </div>
                        <div style={{ marginTop: 6, display: 'grid', gridTemplateColumns: 'auto auto auto', columnGap: 12, rowGap: 4, fontSize: 12 }}>
                          <span style={muted}>Mean |Δtemp|</span>
                          <span style={{ color: '#e2e8f0' }}>
                            {p.meanTempErrorTrend.current !== null ? `${p.meanTempErrorTrend.current}°F` : '—'}
                          </span>
                          <DirectionBadge dir={p.meanTempErrorTrend.direction} title={p.meanTempErrorTrend.note} />

                          <span style={muted}>Weak-bucket %</span>
                          <span style={{ color: '#e2e8f0' }}>{p.weakRatePct}%</span>
                          <DirectionBadge dir={p.weakRateTrend.direction} title={p.weakRateTrend.note} />

                          <span style={muted}>Unavailable %</span>
                          <span style={{ color: '#e2e8f0' }}>{p.unavailableRatePct}%</span>
                          <DirectionBadge dir={p.unavailableRateTrend.direction} title={p.unavailableRateTrend.note} />
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Per-field trend table */}
                  <h4 style={{ ...sectionHeader, fontSize: 13, marginTop: 16 }}>Mean |error| by field — current vs prior half</h4>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={th}>Provider</th>
                          {(['temperature', 'windSpeed', 'windGust'] as QualityField[]).map((f) => (
                            <th key={f} style={th}>{FIELD_DISPLAY[f]}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {trendDashboard.providers.map((p) => (
                          <tr key={p.provider}>
                            <td style={td}>{p.label}</td>
                            {(['temperature', 'windSpeed', 'windGust'] as QualityField[]).map((f) => {
                              const slot = p.perField[f];
                              const unit = f === 'temperature' ? '°F' : 'mph';
                              return (
                                <td key={f} style={td}>
                                  {slot.current !== null ? `${slot.current}${unit}` : '—'}
                                  <div style={{ fontSize: 10, color: '#94a3b8' }}>
                                    prior {slot.prior !== null ? `${slot.prior}${unit}` : '—'} · {slot.direction}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Per-horizon trend table */}
                  <h4 style={{ ...sectionHeader, fontSize: 13, marginTop: 16 }}>Mean |error| by horizon — current vs prior half</h4>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={th}>Provider</th>
                          {(['h0', 'h6', 'h12', 'h24'] as QualityHorizon[]).map((h) => (
                            <th key={h} style={th}>{HORIZON_DISPLAY[h]}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {trendDashboard.providers.map((p) => (
                          <tr key={p.provider}>
                            <td style={td}>{p.label}</td>
                            {(['h0', 'h6', 'h12', 'h24'] as QualityHorizon[]).map((h) => {
                              const slot = p.perHorizon[h];
                              return (
                                <td key={h} style={td}>
                                  {slot.current !== null ? slot.current : '—'}
                                  <div style={{ fontSize: 10, color: '#94a3b8' }}>
                                    prior {slot.prior !== null ? slot.prior : '—'} · {slot.direction}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* City outliers */}
              <h4 style={{ ...sectionHeader, fontSize: 13, marginTop: 16 }}>City outliers (highest failure rate)</h4>
              {trendDashboard.cityOutliers.length === 0 ? (
                <div style={muted}>No city outliers in this window.</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={th}>City</th>
                        <th style={th}>Failures</th>
                        <th style={th}>Appearances</th>
                        <th style={th}>Failure rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trendDashboard.cityOutliers.map((c) => (
                        <tr key={c.cityId}>
                          <td style={td}>{c.cityLabel}</td>
                          <td style={td}>{c.failureCount}</td>
                          <td style={td}>{c.appearanceCount}</td>
                          <td style={td}>
                            <span style={{ color: c.failureRatePct >= 30 ? '#f97316' : '#fbbf24' }}>
                              {c.failureRatePct}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
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
          {smokeProviders.length > 0 && (
            <div style={{ ...tile, marginTop: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', marginBottom: 6 }}>
                Provider smoke tests
              </div>
              <div style={{ ...muted, marginBottom: 8 }}>
                Predefined per-provider diagnostics. The harness only allows hardcoded test paths — no arbitrary endpoints or SQL from this UI. Live calls (Vertex AI, BigQuery sample) are explicit opt-ins per click; BigQuery queries cost real money per byte scanned.
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>Provider</th>
                    <th style={th}>Status</th>
                    <th style={th}>Last result</th>
                    <th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {smokeProviders.map((p) => {
                    const result = smokeResults[p.provider];
                    const tone =
                      !result
                        ? '#94a3b8'
                        : result.status === 'live_call_ok' || result.status === 'readiness_ok'
                        ? '#22c55e'
                        : result.status === 'contract_unconfirmed' || result.status === 'unconfigured' || result.status === 'skipped'
                        ? '#fbbf24'
                        : '#f97316';
                    const liveSupported =
                      p.provider === 'open-meteo' ||
                      (p.provider === 'weathernext-bigquery-sample' && p.liveCallAvailable) ||
                      (p.provider === 'weathernext-production' && p.liveCallAvailable);
                    return (
                      <tr key={p.provider}>
                        <td style={td}>
                          <div style={{ fontWeight: 600 }}>{p.label}</div>
                          <div style={{ ...muted, fontSize: 11 }}>{p.statusLabel}</div>
                        </td>
                        <td style={td}>
                          {result ? (
                            <>
                              <span style={{ color: tone, fontWeight: 600 }}>{result.status}</span>
                              <div style={{ ...muted, fontSize: 11 }}>{result.durationMs}ms</div>
                            </>
                          ) : (
                            <span style={muted}>—</span>
                          )}
                        </td>
                        <td style={td}>
                          {result ? (
                            <>
                              <div style={{ fontSize: 12 }}>{result.summary}</div>
                              {result.responseFingerprint && (
                                <div style={{ ...muted, fontSize: 10, marginTop: 2 }}>
                                  hourly={String(result.responseFingerprint.hourlyLength)} ·
                                  current={String(result.responseFingerprint.currentTempF)}°F
                                </div>
                              )}
                            </>
                          ) : (
                            <span style={muted}>Not yet run.</span>
                          )}
                        </td>
                        <td style={td}>
                          <button
                            style={{ ...btn(p.provider === 'open-meteo' ? '#0e7490' : '#475569'), opacity: smokeBusy ? 0.6 : 1 }}
                            disabled={!!smokeBusy}
                            onClick={() => onRunSmokeTest(p.provider, { live: false })}
                          >
                            {smokeBusy === p.provider ? 'Running…' : p.provider === 'open-meteo' ? 'Test' : 'Check readiness'}
                          </button>
                          {liveSupported && p.provider !== 'open-meteo' && (
                            <button
                              style={{ ...btn('#7c2d12'), marginLeft: 6, opacity: smokeBusy ? 0.6 : 1 }}
                              disabled={!!smokeBusy}
                              onClick={() => onRunSmokeTest(p.provider, { live: true })}
                              title="Attempt a live call (BigQuery queries cost real money; Vertex AI counts against quota)."
                            >
                              {smokeBusy === p.provider ? '…' : 'Live'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {wnReadiness && (
            <div
              style={{
                ...tile,
                marginTop: 12,
                background: wnReadiness.ready ? '#052e16' : '#1a1a2e',
                borderColor: wnReadiness.ready
                  ? '#15803d'
                  : wnReadiness.status === 'config_present_contract_unconfirmed'
                  ? '#a16207'
                  : '#7f1d1d',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>
                WeatherNext production readiness ·{' '}
                <span
                  style={{
                    color: wnReadiness.ready
                      ? '#22c55e'
                      : wnReadiness.status === 'config_present_contract_unconfirmed'
                      ? '#fbbf24'
                      : '#f97316',
                  }}
                >
                  {wnReadiness.ready ? 'ready' : wnReadiness.status === 'config_present_contract_unconfirmed' ? 'config OK · contract unconfirmed' : 'NOT READY'}
                </span>
              </div>
              <div style={{ ...muted, marginTop: 4 }}>{wnReadiness.statusLabel}</div>
              <div style={{ ...muted, marginTop: 6 }}>
                Contract confirmed:{' '}
                <strong style={{ color: wnReadiness.contractConfirmed ? '#22c55e' : '#f97316' }}>
                  {wnReadiness.contractConfirmed ? 'yes' : 'no'}
                </strong>
              </div>
              {wnReadiness.missing.length > 0 && (
                <div style={{ ...muted, marginTop: 4 }}>
                  Missing required env: {wnReadiness.missing.map((m) => <code key={m} style={{ color: '#fbbf24', marginRight: 6 }}>{m}</code>)}
                </div>
              )}
              {wnReadiness.warnings.length > 0 && (
                <ul style={{ marginTop: 6, fontSize: 11, color: '#94a3b8', paddingLeft: 16 }}>
                  {wnReadiness.warnings.map((w, i) => (<li key={i}>{w}</li>))}
                </ul>
              )}
              <div style={{ ...muted, marginTop: 6 }}>
                Env presence (booleans only — values never returned):{' '}
                {Object.entries(wnReadiness.envPresence).map(([k, v]) => (
                  <span key={k} style={{ marginRight: 8 }}>
                    {v ? '✓' : '✗'} <code>{k}</code>
                  </span>
                ))}
              </div>
              <div style={{ ...muted, marginTop: 6, fontStyle: 'italic' }}>
                See <code>docs/weathernext-contract-readiness.md</code> for the rollout checklist.
              </div>
            </div>
          )}

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

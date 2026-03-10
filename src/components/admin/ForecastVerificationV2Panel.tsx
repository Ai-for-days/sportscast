import { useState, useEffect, useCallback } from 'react';

// ── Types for API responses ─────────────────────────────────────────────────

interface OverviewStats {
  total: number;
  verified: number;
  pending: number;
  avgAbsError: number | null;
  avgAdjustedError: number | null;
  avgAccuracyScoreV2: number | null;
}

interface LeaderboardRow {
  rank: number;
  source: string;
  verifiedCount: number;
  avgAccuracyScoreV2: number | null;
  avgAbsError: number | null;
  avgAdjustedError: number | null;
  avgSignedError: number | null;
}

interface BySourceRow {
  source: string;
  count: number;
  verifiedCount: number;
  avgAbsError: number | null;
  avgAdjustedError: number | null;
  avgAccuracyScoreV2: number | null;
  avgSignedError: number | null;
}

interface ByMetricRow {
  metric: string;
  metricGroup: string;
  count: number;
  verifiedCount: number;
  avgAbsError: number | null;
  avgAdjustedError: number | null;
  avgAccuracyScoreV2: number | null;
  avgSignedError: number | null;
}

interface ByLeadBucketRow {
  leadBucket: string;
  count: number;
  verifiedCount: number;
  avgAbsError: number | null;
  avgAdjustedError: number | null;
  avgAccuracyScoreV2: number | null;
}

interface BackfillResult {
  scanned: number;
  updated: number;
  skipped: number;
  errors: string[];
}

// ── Formatters ──────────────────────────────────────────────────────────────

function fmt2(v: number | null): string {
  if (v == null) return '\u2014';
  return v.toFixed(2);
}

function fmtAcc(v: number | null): string {
  if (v == null) return '\u2014';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function fmtSigned(v: number | null): string {
  if (v == null) return '\u2014';
  const s = v.toFixed(2);
  return v > 0 ? `+${s}` : s;
}

// ── Detail tab type ─────────────────────────────────────────────────────────

type DetailTab = 'by-source' | 'by-metric' | 'by-lead-bucket';

// ── Component ───────────────────────────────────────────────────────────────

export default function ForecastVerificationV2Panel() {
  // Overview
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [overviewErr, setOverviewErr] = useState<string | null>(null);

  // Leaderboard
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [leaderboardErr, setLeaderboardErr] = useState<string | null>(null);

  // Detail tabs
  const [detailTab, setDetailTab] = useState<DetailTab>('by-source');
  const [bySource, setBySource] = useState<BySourceRow[]>([]);
  const [byMetric, setByMetric] = useState<ByMetricRow[]>([]);
  const [byLeadBucket, setByLeadBucket] = useState<ByLeadBucketRow[]>([]);
  const [detailErr, setDetailErr] = useState<string | null>(null);

  // Backfill
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<BackfillResult | null>(null);
  const [backfillErr, setBackfillErr] = useState<string | null>(null);

  // Loading
  const [statsLoading, setStatsLoading] = useState(false);

  // ── Fetch helpers ───────────────────────────────────────────────────────

  const fetchOverview = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/forecasts/stats/overview');
      if (!res.ok) throw new Error(`${res.status}`);
      setOverview(await res.json());
      setOverviewErr(null);
    } catch (e: any) {
      setOverviewErr(e.message || 'Failed to load overview');
    }
  }, []);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/forecasts/stats/leaderboard');
      if (!res.ok) throw new Error(`${res.status}`);
      setLeaderboard(await res.json());
      setLeaderboardErr(null);
    } catch (e: any) {
      setLeaderboardErr(e.message || 'Failed to load leaderboard');
    }
  }, []);

  const fetchDetailTab = useCallback(async (tab: DetailTab) => {
    try {
      const res = await fetch(`/api/admin/forecasts/stats/${tab}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      if (tab === 'by-source') setBySource(data);
      else if (tab === 'by-metric') setByMetric(data);
      else setByLeadBucket(data);
      setDetailErr(null);
    } catch (e: any) {
      setDetailErr(e.message || 'Failed to load detail stats');
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setStatsLoading(true);
    await Promise.all([fetchOverview(), fetchLeaderboard(), fetchDetailTab(detailTab)]);
    setStatsLoading(false);
  }, [fetchOverview, fetchLeaderboard, fetchDetailTab, detailTab]);

  // Initial load
  useEffect(() => { refreshAll(); }, []);

  // Reload detail tab data when tab changes
  useEffect(() => { fetchDetailTab(detailTab); }, [detailTab, fetchDetailTab]);

  // ── Backfill handler ──────────────────────────────────────────────────

  const handleBackfill = async () => {
    setBackfilling(true);
    setBackfillResult(null);
    setBackfillErr(null);
    try {
      const res = await fetch('/api/admin/forecasts/backfill-v2', { method: 'POST' });
      if (!res.ok) throw new Error(`${res.status}`);
      const data: BackfillResult = await res.json();
      setBackfillResult(data);
      await refreshAll();
    } catch (e: any) {
      setBackfillErr(e.message || 'Backfill failed');
    } finally {
      setBackfilling(false);
    }
  };

  // ── Table cell style ──────────────────────────────────────────────────

  const thCls = 'px-3 py-2 text-left text-xs font-medium uppercase text-gray-500';
  const tdCls = 'px-3 py-2 text-sm text-gray-900';
  const tdRight = 'px-3 py-2 text-sm text-gray-900 text-right font-mono';

  return (
    <div className="space-y-4 rounded-xl border border-indigo-200 bg-indigo-50/50 p-5">
      <h3 className="text-lg font-bold text-gray-900">Forecast Verification V2</h3>

      {/* ── Action Row ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={handleBackfill}
          disabled={backfilling}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {backfilling ? 'Running Backfill...' : 'Run V2 Backfill'}
        </button>
        <button
          onClick={refreshAll}
          disabled={statsLoading}
          className="rounded-lg bg-gray-600 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {statsLoading ? 'Refreshing...' : 'Refresh V2 Stats'}
        </button>

        {backfillResult && (
          <span className="text-xs text-green-600">
            Backfill: {backfillResult.scanned} scanned, {backfillResult.updated} updated, {backfillResult.skipped} skipped
            {backfillResult.errors.length > 0 && `, ${backfillResult.errors.length} error(s)`}
          </span>
        )}
        {backfillErr && <span className="text-xs text-red-600">Backfill error: {backfillErr}</span>}
      </div>

      {/* ── Overview Cards ──────────────────────────────────────────────── */}
      {overviewErr ? (
        <p className="text-xs text-red-600">Overview error: {overviewErr}</p>
      ) : overview ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Card label="Total Forecasts" value={String(overview.total)} />
          <Card label="Verified" value={String(overview.verified)} color="text-green-600" />
          <Card label="Pending" value={String(overview.pending)} color="text-blue-600" />
          <Card label="Avg Abs Error" value={fmt2(overview.avgAbsError)} />
          <Card label="Avg Adj Error" value={fmt2(overview.avgAdjustedError)} />
          <Card label="Avg Accuracy V2" value={fmtAcc(overview.avgAccuracyScoreV2)} color="text-indigo-600" />
        </div>
      ) : (
        <div className="flex justify-center py-4">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
        </div>
      )}

      {/* ── Source Leaderboard ───────────────────────────────────────────── */}
      <div>
        <h4 className="mb-2 text-sm font-semibold text-gray-900">Source Leaderboard</h4>
        {leaderboardErr ? (
          <p className="text-xs text-red-600">Leaderboard error: {leaderboardErr}</p>
        ) : leaderboard.length === 0 ? (
          <p className="text-xs text-gray-500">No verified forecasts yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className={thCls}>Rank</th>
                  <th className={thCls}>Source</th>
                  <th className={thCls + ' text-right'}>Verified</th>
                  <th className={thCls + ' text-right'}>Avg Accuracy V2</th>
                  <th className={thCls + ' text-right'}>Avg Abs Error</th>
                  <th className={thCls + ' text-right'}>Avg Adj Error</th>
                  <th className={thCls + ' text-right'}>Avg Signed Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {leaderboard.map(r => (
                  <tr key={r.source} className="hover:bg-gray-50">
                    <td className={tdCls + ' font-bold'}>{r.rank}</td>
                    <td className={tdCls + ' font-medium'}>{r.source}</td>
                    <td className={tdRight}>{r.verifiedCount}</td>
                    <td className={tdRight + ' font-bold text-indigo-600'}>{fmtAcc(r.avgAccuracyScoreV2)}</td>
                    <td className={tdRight}>{fmt2(r.avgAbsError)}</td>
                    <td className={tdRight}>{fmt2(r.avgAdjustedError)}</td>
                    <td className={tdRight}>{fmtSigned(r.avgSignedError)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Detail Tabs ─────────────────────────────────────────────────── */}
      <div>
        <div className="mb-2 flex gap-1 rounded-lg bg-gray-100 p-1 w-fit">
          {([
            { id: 'by-source' as DetailTab, label: 'By Source' },
            { id: 'by-metric' as DetailTab, label: 'By Metric' },
            { id: 'by-lead-bucket' as DetailTab, label: 'By Lead Bucket' },
          ]).map(tab => (
            <button
              key={tab.id}
              onClick={() => setDetailTab(tab.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                detailTab === tab.id
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {detailErr && <p className="text-xs text-red-600 mb-2">Detail error: {detailErr}</p>}

        {detailTab === 'by-source' && (
          <DetailTable
            columns={['Source', 'Count', 'Verified', 'Avg Abs Error', 'Avg Adj Error', 'Avg Accuracy V2', 'Avg Signed Error']}
            rows={bySource.map(r => [
              r.source, String(r.count), String(r.verifiedCount),
              fmt2(r.avgAbsError), fmt2(r.avgAdjustedError), fmtAcc(r.avgAccuracyScoreV2), fmtSigned(r.avgSignedError),
            ])}
          />
        )}

        {detailTab === 'by-metric' && (
          <DetailTable
            columns={['Metric', 'Group', 'Count', 'Verified', 'Avg Abs Error', 'Avg Adj Error', 'Avg Accuracy V2', 'Avg Signed Error']}
            rows={byMetric.map(r => [
              r.metric, r.metricGroup, String(r.count), String(r.verifiedCount),
              fmt2(r.avgAbsError), fmt2(r.avgAdjustedError), fmtAcc(r.avgAccuracyScoreV2), fmtSigned(r.avgSignedError),
            ])}
          />
        )}

        {detailTab === 'by-lead-bucket' && (
          <DetailTable
            columns={['Lead Bucket', 'Count', 'Verified', 'Avg Abs Error', 'Avg Adj Error', 'Avg Accuracy V2']}
            rows={byLeadBucket.map(r => [
              r.leadBucket, String(r.count), String(r.verifiedCount),
              fmt2(r.avgAbsError), fmt2(r.avgAdjustedError), fmtAcc(r.avgAccuracyScoreV2),
            ])}
          />
        )}
      </div>
    </div>
  );
}

// ── Subcomponents ───────────────────────────────────────────────────────────

function Card({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg bg-white p-3 text-center shadow-sm border border-gray-100">
      <div className={`text-2xl font-bold ${color || 'text-gray-900'}`}>{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

function DetailTable({ columns, rows }: { columns: string[]; rows: string[][] }) {
  if (rows.length === 0) {
    return <p className="text-xs text-gray-500">No data available.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            {columns.map((col, i) => (
              <th key={i} className={`px-3 py-2 text-xs font-medium uppercase text-gray-500 ${i === 0 ? 'text-left' : 'text-right'}`}>
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 bg-white">
          {rows.map((row, ri) => (
            <tr key={ri} className="hover:bg-gray-50">
              {row.map((cell, ci) => (
                <td key={ci} className={`px-3 py-2 text-sm ${ci === 0 ? 'text-left font-medium text-gray-900' : 'text-right font-mono text-gray-900'}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Step 177: Admin SEO health — GSC reconciliation panel ──────────────
//
// Two textareas + Analyze button. Posts the two CSVs to
// /api/admin/system/seo-gsc-import and renders summaries by route type,
// ZIP priority tier, sitemap shard, and the 10 recommendation queues.
//
// **Read-only.** **No persistence.** **No GSC API call.** Operators
// paste fresh CSVs each time they want a new snapshot.

import { useCallback, useMemo, useState } from 'react';
import { formatDMYTime } from '../../lib/date-format';

interface ReportTotals {
  indexingRowsParsed: number;
  performanceRowsParsed: number;
  reconciledUrls: number;
  indexed: number;
  notIndexed: number;
  impressions: number;
  clicks: number;
}

interface RouteTypeSummary {
  routeType: string;
  totalSeen: number;
  status: {
    indexed: number;
    discoveredNotIndexed: number;
    crawledNotIndexed: number;
    alternateCanonical: number;
    duplicateNoCanonical: number;
    excludedNoindex: number;
    redirect: number;
    blockedByRobots: number;
    serverError: number;
    soft404: number;
    other: number;
    total: number;
  };
  impressions: number;
  clicks: number;
}

interface TierSummary {
  tier: 1 | 2 | 3;
  totalSeen: number;
  indexed: number;
  notIndexed: number;
  impressions: number;
  clicks: number;
}

interface ShardSummary {
  sitemapUrl: string;
  label: string;
  urlsInShard: number;
  seenInGsc: number;
  indexed: number;
  notIndexed: number;
  impressions: number;
  clicks: number;
}

interface CanonicalIssues {
  wwwUrlsSeen: number;
  alternateCanonicalCount: number;
  nonCanonicalCount: number;
  unknownUrlSamples: string[];
}

interface ImportWarnings {
  parser: string[];
  unmatched: number;
  external: number;
  skipped: number;
}

interface QueueItem {
  canonicalUrl: string;
  pathname: string;
  routeType: string;
  zipPriorityTier?: 1 | 2 | 3;
  impressions?: number;
  clicks?: number;
  ctr?: number | null;
  averagePosition?: number | null;
  indexingStatus?: string;
  notIndexedReason?: string;
  reasons: string[];
}

interface Queue {
  id: string;
  title: string;
  description: string;
  recommendedActions: ReadonlyArray<string>;
  items: QueueItem[];
}

interface Report {
  generatedAt: string;
  totals: ReportTotals;
  warnings: ImportWarnings;
  byRouteType: RouteTypeSummary[];
  byTier: TierSummary[];
  byShard: ShardSummary[];
  canonicalIssues: CanonicalIssues;
  queues: Queue[];
}

const ROUTE_TYPE_LABEL: Record<string, string> = {
  homepage: 'Homepage',
  state_hub: 'State hub',
  city_hub: 'City hub',
  zip_page: 'ZIP page',
  venues_hub: 'Venues hub',
  league_page: 'League page',
  map: 'Map',
  historical: 'Historical',
  noindex_admin: 'Noindex · admin',
  noindex_auth: 'Noindex · auth',
  noindex_other: 'Noindex · other',
  unknown: 'Unknown',
};

function fmt(n: number | undefined | null): string {
  if (n === undefined || n === null) return '—';
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString();
}

function fmtPct(n: number | undefined | null): string {
  if (n === undefined || n === null) return '—';
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(2)}%`;
}

export default function SeoGscImportPanel() {
  const [indexingCsv, setIndexingCsv] = useState('');
  const [performanceCsv, setPerformanceCsv] = useState('');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onAnalyze = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const r = await fetch('/api/admin/system/seo-gsc-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ indexingCsv, performanceCsv }),
      });
      const body = await r.json();
      if (!r.ok || !body.ok) {
        setError(body.error ? `${body.error}${body.detail ? `: ${body.detail}` : ''}` : `request failed (${r.status})`);
      } else {
        setReport(body.report as Report);
      }
    } catch (err) {
      setError((err as Error)?.message ?? 'network_error');
    } finally {
      setLoading(false);
    }
  }, [indexingCsv, performanceCsv, loading]);

  const onLoadFile = useCallback(
    (setter: (s: string) => void) =>
      async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
          const text = await file.text();
          setter(text);
        } catch (err) {
          setError(`file read failed: ${(err as Error)?.message}`);
        }
      },
    [],
  );

  const hasData = !!report;
  const queueWithItems = useMemo(() => (report?.queues ?? []).filter((q) => q.items.length > 0), [report]);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Search Console reconciliation</h2>
        <span className="text-xs text-slate-500">No GSC API call · no persistence · admin-only</span>
      </div>

      <p className="mb-4 text-sm text-slate-600">
        Paste two Search Console exports below — the <strong>Pages</strong>
        report (URL status / coverage) and the <strong>Performance</strong>
        report's <strong>Pages</strong> tab — then press <em>Analyze</em>.
        The dashboard reconciles each URL to its route type, sitemap
        shard, and ZIP priority tier so you can prioritize internal-
        linking and content work.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <CsvInput
          label="Page indexing CSV"
          value={indexingCsv}
          onChange={setIndexingCsv}
          onFile={onLoadFile(setIndexingCsv)}
        />
        <CsvInput
          label="Performance CSV (Pages tab)"
          value={performanceCsv}
          onChange={setPerformanceCsv}
          onFile={onLoadFile(setPerformanceCsv)}
        />
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={onAnalyze}
          disabled={loading || (!indexingCsv && !performanceCsv)}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Analyzing…' : 'Analyze GSC exports'}
        </button>
        {error && <span className="text-sm text-red-600">{error}</span>}
        {report && (
          <span className="text-xs text-slate-500">
            generated {formatDMYTime(report.generatedAt)}
          </span>
        )}
      </div>

      {hasData && report && (
        <div className="mt-6 space-y-6">
          <Totals totals={report.totals} warnings={report.warnings} />
          <RouteTypeTable byRouteType={report.byRouteType} />
          <TierTable byTier={report.byTier} />
          <ShardTable byShard={report.byShard} />
          <CanonicalIssuesBlock issues={report.canonicalIssues} />
          <QueuesBlock queues={queueWithItems} />
        </div>
      )}
    </section>
  );
}

function CsvInput({
  label,
  value,
  onChange,
  onFile,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  onFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div>
      <label className="mb-1 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-500">
        <span>{label}</span>
        <input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" onChange={onFile} className="text-xs" />
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="block min-h-[140px] w-full rounded-md border border-slate-300 bg-slate-50 p-2 font-mono text-xs text-slate-900"
        placeholder="Paste CSV content here…"
      />
    </div>
  );
}

function Totals({ totals, warnings }: { totals: ReportTotals; warnings: ImportWarnings }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Stat label="Indexing rows" value={fmt(totals.indexingRowsParsed)} />
      <Stat label="Performance rows" value={fmt(totals.performanceRowsParsed)} />
      <Stat label="Reconciled URLs" value={fmt(totals.reconciledUrls)} />
      <Stat label="Indexed" value={fmt(totals.indexed)} tone="emerald" />
      <Stat label="Not indexed" value={fmt(totals.notIndexed)} tone="amber" />
      <Stat label="Impressions" value={fmt(totals.impressions)} />
      <Stat label="Clicks" value={fmt(totals.clicks)} />
      <Stat
        label="Warnings"
        value={`${warnings.unmatched + warnings.external + warnings.skipped}`}
        tone={warnings.unmatched + warnings.external + warnings.skipped > 0 ? 'amber' : undefined}
      />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'emerald' | 'amber' | 'sky' }) {
  const palette = tone === 'emerald'
    ? 'bg-emerald-50 text-emerald-900'
    : tone === 'amber'
      ? 'bg-amber-50 text-amber-900'
      : tone === 'sky'
        ? 'bg-sky-50 text-sky-900'
        : 'bg-slate-50 text-slate-900';
  return (
    <div className={`rounded-lg p-3 ${palette}`}>
      <div className="text-xs uppercase tracking-wider opacity-70">{label}</div>
      <div className="mt-1 text-xl font-bold">{value}</div>
    </div>
  );
}

function RouteTypeTable({ byRouteType }: { byRouteType: RouteTypeSummary[] }) {
  if (byRouteType.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-slate-900">By route type</h3>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-600">
              <th className="py-1 pr-3">Route</th>
              <th className="py-1 pr-3">Seen</th>
              <th className="py-1 pr-3">Indexed</th>
              <th className="py-1 pr-3">Discovered NI</th>
              <th className="py-1 pr-3">Crawled NI</th>
              <th className="py-1 pr-3">Alt canonical</th>
              <th className="py-1 pr-3">Noindex</th>
              <th className="py-1 pr-3">Impressions</th>
              <th className="py-1">Clicks</th>
            </tr>
          </thead>
          <tbody>
            {byRouteType.map((r) => (
              <tr key={r.routeType} className="border-b border-slate-100">
                <td className="py-1 pr-3 font-medium text-slate-900">{ROUTE_TYPE_LABEL[r.routeType] ?? r.routeType}</td>
                <td className="py-1 pr-3">{fmt(r.totalSeen)}</td>
                <td className="py-1 pr-3 text-emerald-700">{fmt(r.status.indexed)}</td>
                <td className="py-1 pr-3 text-amber-700">{fmt(r.status.discoveredNotIndexed)}</td>
                <td className="py-1 pr-3 text-amber-700">{fmt(r.status.crawledNotIndexed)}</td>
                <td className="py-1 pr-3 text-sky-700">{fmt(r.status.alternateCanonical)}</td>
                <td className="py-1 pr-3 text-slate-500">{fmt(r.status.excludedNoindex)}</td>
                <td className="py-1 pr-3">{fmt(r.impressions)}</td>
                <td className="py-1">{fmt(r.clicks)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TierTable({ byTier }: { byTier: TierSummary[] }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-slate-900">By ZIP priority tier</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {byTier.map((t) => (
          <div key={t.tier} className="rounded-lg border border-slate-200 p-3 text-sm">
            <div className="font-semibold text-slate-900">Tier {t.tier}</div>
            <div className="mt-1 text-xs text-slate-500">{fmt(t.totalSeen)} URLs seen</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div><div className="uppercase tracking-wider text-slate-500">Indexed</div><div className="font-mono text-emerald-700">{fmt(t.indexed)}</div></div>
              <div><div className="uppercase tracking-wider text-slate-500">Not indexed</div><div className="font-mono text-amber-700">{fmt(t.notIndexed)}</div></div>
              <div><div className="uppercase tracking-wider text-slate-500">Impressions</div><div className="font-mono">{fmt(t.impressions)}</div></div>
              <div><div className="uppercase tracking-wider text-slate-500">Clicks</div><div className="font-mono">{fmt(t.clicks)}</div></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShardTable({ byShard }: { byShard: ShardSummary[] }) {
  const visible = byShard.filter((s) => s.urlsInShard > 0 || s.seenInGsc > 0 || s.impressions > 0);
  if (visible.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-slate-900">By sitemap shard</h3>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-600">
              <th className="py-1 pr-3">Shard</th>
              <th className="py-1 pr-3">In sitemap</th>
              <th className="py-1 pr-3">Seen in GSC</th>
              <th className="py-1 pr-3">Indexed</th>
              <th className="py-1 pr-3">Not indexed</th>
              <th className="py-1 pr-3">Impressions</th>
              <th className="py-1">Clicks</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => (
              <tr key={s.sitemapUrl} className="border-b border-slate-100">
                <td className="py-1 pr-3 font-mono text-slate-900">{s.label}</td>
                <td className="py-1 pr-3">{fmt(s.urlsInShard)}</td>
                <td className="py-1 pr-3">{fmt(s.seenInGsc)}</td>
                <td className="py-1 pr-3 text-emerald-700">{fmt(s.indexed)}</td>
                <td className="py-1 pr-3 text-amber-700">{fmt(s.notIndexed)}</td>
                <td className="py-1 pr-3">{fmt(s.impressions)}</td>
                <td className="py-1">{fmt(s.clicks)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CanonicalIssuesBlock({ issues }: { issues: CanonicalIssues }) {
  const hasAny = issues.wwwUrlsSeen > 0 || issues.alternateCanonicalCount > 0 || issues.nonCanonicalCount > 0 || issues.unknownUrlSamples.length > 0;
  if (!hasAny) return null;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
      <h3 className="mb-2 text-sm font-semibold">Canonical / host issues</h3>
      <ul className="space-y-1">
        <li>www URLs in indexing CSV: <span className="font-mono">{fmt(issues.wwwUrlsSeen)}</span></li>
        <li>Alternate-canonical findings: <span className="font-mono">{fmt(issues.alternateCanonicalCount)}</span></li>
        <li>Pages whose Google-selected canonical differs from the URL: <span className="font-mono">{fmt(issues.nonCanonicalCount)}</span></li>
        {issues.unknownUrlSamples.length > 0 && (
          <li>
            Sample external / unknown URLs:
            <ul className="ml-4 mt-1 list-disc font-mono">
              {issues.unknownUrlSamples.slice(0, 10).map((u) => <li key={u}>{u}</li>)}
            </ul>
          </li>
        )}
      </ul>
    </div>
  );
}

function QueuesBlock({ queues }: { queues: Queue[] }) {
  if (queues.length === 0) return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
      No actionable queues fired on this import. Nothing urgent.
    </div>
  );
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-slate-900">Actionable queues</h3>
      <div className="space-y-3">
        {queues.map((q) => (
          <details key={q.id} className="rounded-lg border border-slate-200 bg-white p-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-900">
              {q.title}
              <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{q.items.length}</span>
            </summary>
            <p className="mt-2 text-xs text-slate-600">{q.description}</p>
            <ul className="mt-2 list-disc pl-5 text-xs text-slate-700">
              {q.recommendedActions.map((a) => <li key={a}>{a}</li>)}
            </ul>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-600">
                    <th className="py-1 pr-2">URL</th>
                    <th className="py-1 pr-2">Tier</th>
                    <th className="py-1 pr-2">Status</th>
                    <th className="py-1 pr-2">Impressions</th>
                    <th className="py-1 pr-2">Clicks</th>
                    <th className="py-1 pr-2">CTR</th>
                    <th className="py-1">Position</th>
                  </tr>
                </thead>
                <tbody>
                  {q.items.map((it) => (
                    <tr key={it.canonicalUrl} className="border-b border-slate-100">
                      <td className="py-1 pr-2 font-mono">
                        <a href={it.pathname} className="text-blue-600 hover:underline" target="_blank" rel="noreferrer">
                          {it.pathname}
                        </a>
                      </td>
                      <td className="py-1 pr-2">{it.zipPriorityTier ?? '—'}</td>
                      <td className="py-1 pr-2">{it.indexingStatus ?? '—'}</td>
                      <td className="py-1 pr-2">{fmt(it.impressions)}</td>
                      <td className="py-1 pr-2">{fmt(it.clicks)}</td>
                      <td className="py-1 pr-2">{fmtPct(it.ctr ?? null)}</td>
                      <td className="py-1">{it.averagePosition != null ? it.averagePosition.toFixed(1) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

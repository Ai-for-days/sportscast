// ── Step 114: Public wager discovery & market browsing ─────────────────────
// ── 2026-08-26: current/future only, organized as a sortable table ─────────
//
// Per Derek: expired markets are admin-only, and the public board needs to be
// organized "by date as well as what type of wager." So the status filter and
// the four status sections (open / locked / resolved / voided) are gone. This
// component can now only ever be handed current and future markets, because
// every path that feeds it runs through isPubliclyVisible() in
// public-wager-view.ts. What replaces those sections is a sortable table with
// independent date and wager-type filters, plus paging, so the board is no
// longer capped at whatever the first server render happened to fetch.
//
// Read-only. No admin API calls, no mutation surface, no internal fields.
// All records come from PublicWagerView (Step 113 strip).

import React, { useCallback, useMemo, useState } from 'react';
import type { PublicWagerView } from '../../lib/public-wager-view';
import type { WagerKind, WagerMetric } from '../../lib/wager-types';

type KindFilter = 'all' | WagerKind;
type MetricFilter = 'all' | WagerMetric;
type DateFilter = 'all' | 'today' | 'tomorrow' | 'next7';
type SortKey = 'date' | 'lock' | 'type' | 'market' | 'location';
type SortDir = 'asc' | 'desc';

interface Props {
  wagers: PublicWagerView[];
  /** How many records the server already requested, so paging resumes there. */
  initialCursor?: number;
  /** Size of the open book, used only to decide whether to offer more. */
  total?: number;
}

const PAGE_SIZE = 50;

const KIND_OPTIONS: { value: KindFilter; label: string }[] = [
  { value: 'all',         label: 'All wager types' },
  { value: 'pointspread', label: 'Pointspread' },
  { value: 'over-under',  label: 'Over / under' },
  { value: 'odds',        label: 'Range odds' },
];

const METRIC_OPTIONS: { value: MetricFilter; label: string }[] = [
  { value: 'all',         label: 'All weather metrics' },
  { value: 'high_temp',   label: 'Daily high' },
  { value: 'low_temp',    label: 'Daily low' },
  { value: 'actual_temp', label: 'Observed temperature' },
  { value: 'actual_wind', label: 'Wind speed' },
  { value: 'actual_gust', label: 'Wind gust' },
];

const DATE_OPTIONS: { value: DateFilter; label: string }[] = [
  { value: 'all',      label: 'Any date' },
  { value: 'today',    label: 'Today' },
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'next7',    label: 'Next 7 days' },
];

const KIND_LABEL: Record<WagerKind, string> = {
  'pointspread': 'Pointspread',
  'over-under': 'Over / under',
  'odds': 'Range odds',
};

const METRIC_LABEL: Record<WagerMetric, string> = {
  high_temp: 'Daily high',
  low_temp: 'Daily low',
  actual_temp: 'Observed temp',
  actual_wind: 'Wind speed',
  actual_gust: 'Wind gust',
};

/** The "what type of wager" column: kind plus the metric it resolves on. */
function typeLabel(w: PublicWagerView): string {
  const kind = KIND_LABEL[w.kind] ?? w.kind;
  // A cross-metric pointspread (high vs low, high vs high) reads better as the
  // pairing than as one shared metric, which is all `metric` alone would show.
  if (w.kind === 'pointspread' && w.metricA && w.metricB) {
    const a = METRIC_LABEL[w.metricA] ?? w.metricA;
    const b = METRIC_LABEL[w.metricB] ?? w.metricB;
    return `${kind}, ${a.toLowerCase()} vs ${b.toLowerCase()}`;
  }
  const metric = METRIC_LABEL[w.metric] ?? w.metric;
  return `${kind}, ${metric.toLowerCase()}`;
}

/** Line, spread, or odds, whichever this market actually carries. */
function priceLabel(w: PublicWagerView): string {
  const unit = w.unit ?? '';
  if (w.kind === 'over-under' && typeof w.line === 'number') return `Line ${w.line}${unit}`;
  if (w.kind === 'pointspread' && typeof w.spread === 'number') {
    return `Spread ${w.spread > 0 ? '+' : ''}${w.spread}${unit}`;
  }
  return w.displayedOdds || '';
}

/** Local YYYY-MM-DD, matching how targetDate is stored. */
function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatTargetDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const today = localDateKey(new Date());
  if (iso === today) return 'Today';
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  if (iso === localDateKey(tomorrowDate)) return 'Tomorrow';
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

/** "in 3h 20m" / "in 4d 2h". Markets on this page always lock in the future. */
function formatLockCountdown(lockIso: string): string {
  const ms = new Date(lockIso).getTime() - Date.now();
  if (Number.isNaN(ms)) return '';
  if (ms <= 0) return 'closing';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `in ${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `in ${days}d ${hours % 24}h`;
}

export default function PublicWagerList({ wagers: initialWagers, initialCursor = 0, total = 0 }: Props) {
  const [wagers, setWagers] = useState<PublicWagerView[]>(initialWagers);
  const [cursor, setCursor] = useState(initialCursor || initialWagers.length);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [exactDate, setExactDate] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [metric, setMetric] = useState<MetricFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('lock');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/wagers?limit=${PAGE_SIZE}&cursor=${cursor}`);
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = await res.json();
      const incoming: PublicWagerView[] = data.wagers ?? [];
      setWagers(prev => {
        const seen = new Set(prev.map(w => w.id));
        return [...prev, ...incoming.filter(w => !seen.has(w.id))];
      });
      // Advance by the page size, not by how many rows survived the public
      // visibility filter, or the cursor would walk back over the same slice.
      setCursor(c => c + PAGE_SIZE);
    } catch (err: any) {
      setLoadError(err?.message ?? 'Could not load more markets.');
    } finally {
      setLoadingMore(false);
    }
  }, [cursor]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const today = localDateKey(new Date());
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrow = localDateKey(tomorrowDate);
    const in7 = new Date();
    in7.setDate(in7.getDate() + 7);
    const next7End = localDateKey(in7);

    return wagers.filter(w => {
      if (kind !== 'all' && w.kind !== kind) return false;
      if (metric !== 'all' && w.metric !== metric) return false;
      if (exactDate && w.targetDate !== exactDate) return false;
      if (dateFilter === 'today' && w.targetDate !== today) return false;
      if (dateFilter === 'tomorrow' && w.targetDate !== tomorrow) return false;
      if (dateFilter === 'next7' && (w.targetDate < today || w.targetDate > next7End)) return false;
      if (q) {
        const hay = `${w.title} ${w.locationSummary} ${typeLabel(w)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [wagers, kind, metric, exactDate, dateFilter, searchQuery]);

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'date') {
        cmp = a.targetDate.localeCompare(b.targetDate);
      } else if (sortKey === 'lock') {
        cmp = new Date(a.lockTime).getTime() - new Date(b.lockTime).getTime();
      } else if (sortKey === 'type') {
        cmp = typeLabel(a).localeCompare(typeLabel(b));
      } else if (sortKey === 'market') {
        cmp = a.title.localeCompare(b.title);
      } else {
        cmp = a.locationSummary.localeCompare(b.locationSummary);
      }
      // Ties fall back to lock time so row order is never arbitrary.
      if (cmp === 0) return new Date(a.lockTime).getTime() - new Date(b.lockTime).getTime();
      return cmp * dir;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const filtersActive =
    dateFilter !== 'all' || !!exactDate || kind !== 'all' || metric !== 'all' || !!searchQuery;

  function resetFilters() {
    setDateFilter('all');
    setExactDate('');
    setKind('all');
    setMetric('all');
    setSearchQuery('');
  }

  const hasMore = total > wagers.length && cursor < total;

  const COLUMNS: { key: SortKey; label: string }[] = [
    { key: 'date',     label: 'Date' },
    { key: 'lock',     label: 'Closes' },
    { key: 'type',     label: 'Wager type' },
    { key: 'market',   label: 'Market' },
    { key: 'location', label: 'Location' },
  ];

  function SortHeader({ col }: { col: { key: SortKey; label: string } }) {
    const active = sortKey === col.key;
    return (
      <th
        scope="col"
        aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
        className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600"
      >
        <button
          type="button"
          onClick={() => toggleSort(col.key)}
          className={`inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-slate-100 ${active ? 'text-slate-900' : ''}`}
        >
          {col.label}
          <span aria-hidden="true" className={active ? 'text-blue-600' : 'text-slate-300'}>
            {active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
          </span>
        </button>
      </th>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold text-slate-900">Weather Markets</h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          Every market open right now and coming up, soonest to close first. Each one explains what
          is being measured, when it stops accepting action, and how it resolves. Sort any column, or
          filter by date and wager type. Tap a market for full details.
        </p>
      </header>

      {/* Filters */}
      <section
        aria-label="Filter markets"
        className="mb-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
      >
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
          <label className="flex flex-col text-xs font-medium text-slate-600">
            Date
            <select
              value={dateFilter}
              onChange={e => { setDateFilter(e.target.value as DateFilter); setExactDate(''); }}
              className="mt-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {DATE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>

          <label className="flex flex-col text-xs font-medium text-slate-600">
            Exact date
            <input
              type="date"
              value={exactDate}
              onChange={e => { setExactDate(e.target.value); setDateFilter('all'); }}
              className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </label>

          <label className="flex flex-col text-xs font-medium text-slate-600">
            Wager type
            <select
              value={kind}
              onChange={e => setKind(e.target.value as KindFilter)}
              className="mt-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {KIND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>

          <label className="flex flex-col text-xs font-medium text-slate-600">
            Weather metric
            <select
              value={metric}
              onChange={e => setMetric(e.target.value as MetricFilter)}
              className="mt-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {METRIC_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>

          <label className="flex flex-col text-xs font-medium text-slate-600">
            Search
            <input
              type="search"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Team, venue, city"
              className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
          <span>
            Showing {sorted.length} of the {wagers.length} soonest {wagers.length === 1 ? 'market' : 'markets'} loaded
            {total > wagers.length ? ` (${total} open in total, load more below)` : ''}
          </span>
          {filtersActive && (
            <button
              type="button"
              onClick={resetFilters}
              className="rounded border border-slate-200 px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50"
            >
              Clear filters
            </button>
          )}
        </div>
      </section>

      {/* Empty states */}
      {wagers.length === 0 && (
        <div className="rounded-lg border border-slate-200 bg-white px-6 py-12 text-center">
          <h2 className="text-xl font-semibold text-slate-900">No open markets right now</h2>
          <p className="mt-2 text-slate-600">
            New weather-based markets are posted regularly. Check back soon.
          </p>
        </div>
      )}

      {wagers.length > 0 && sorted.length === 0 && (
        <div className="rounded-lg border border-slate-200 bg-white px-6 py-12 text-center">
          <h2 className="text-xl font-semibold text-slate-900">No markets match your filters</h2>
          <p className="mt-2 text-slate-600">Try clearing some filters to see more markets.</p>
          <button
            type="button"
            onClick={resetFilters}
            className="mt-4 inline-flex items-center rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Wide content scrolls inside its own container so the page body never does. */}
      {sorted.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                {COLUMNS.map(col => <SortHeader key={col.key} col={col} />)}
                <th scope="col" className="whitespace-nowrap px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Line / odds
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map(w => (
                <tr key={w.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-3 py-2.5 font-medium text-slate-900">
                    {formatTargetDate(w.targetDate)}
                    {/* When the wager is TALLIED, which is not when it closes.
                        A day-temp market is tallied at the end of the day at the
                        venue whose day ends last; an at-game-start market at
                        kickoff. See wager-tally-time.ts. */}
                    {w.tallyTime && (
                      <div className="text-xs font-normal text-slate-500">{w.tallyTime}</div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">
                    {formatLockCountdown(w.lockTime)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-slate-700">{typeLabel(w)}</td>
                  <td className="px-3 py-2.5">
                    <a
                      href={`/wagers/${w.id}`}
                      className="font-medium text-blue-700 underline-offset-2 hover:underline"
                    >
                      {w.title}
                    </a>
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">{w.locationSummary}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium text-slate-900">
                    {priceLabel(w)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Paging */}
      {(hasMore || loadError) && (
        <div className="mt-4 flex flex-col items-center gap-2">
          {loadError && <p className="text-xs text-red-600">{loadError}</p>}
          {hasMore && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {loadingMore ? 'Loading...' : 'Load more markets'}
            </button>
          )}
        </div>
      )}

      {/* Responsible play note */}
      <aside className="mt-10 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
        <strong className="font-semibold">Play responsibly.</strong>{' '}
        Wagering on weather outcomes carries real risk. Wager only what you can afford to lose,
        set personal limits, and seek help at 1-800-GAMBLER if play is causing harm.
      </aside>
    </div>
  );
}

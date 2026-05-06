// ── Step 114: Public wager discovery & market browsing ─────────────────────
//
// Client-side filter / search / sort over a server-rendered list of public
// wager views. Read-only — no admin API calls, no mutation surface, no
// internal fields. All records come from PublicWagerView (Step 113 strip).

import React, { useMemo, useState } from 'react';
import type { PublicWagerView } from '../../lib/public-wager-view';
import type { WagerKind, WagerMetric } from '../../lib/wager-types';
import WagerCard from './WagerCard';

type StatusFilter = 'all' | 'open' | 'locked' | 'graded' | 'void';
type KindFilter = 'all' | WagerKind;
type MetricFilter = 'all' | WagerMetric;
type SortKey = 'lock_soonest' | 'target_date' | 'newest';

interface Props {
  wagers: PublicWagerView[];
  initialStatus?: StatusFilter;
}

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all',    label: 'All' },
  { value: 'open',   label: 'Open' },
  { value: 'locked', label: 'Locked' },
  { value: 'graded', label: 'Resolved' },
  { value: 'void',   label: 'Voided / Cancelled' },
];

const KIND_OPTIONS: { value: KindFilter; label: string }[] = [
  { value: 'all',          label: 'All kinds' },
  { value: 'odds',         label: 'Range odds' },
  { value: 'over-under',   label: 'Over / under' },
  { value: 'pointspread',  label: 'Pointspread' },
];

const METRIC_OPTIONS: { value: MetricFilter; label: string }[] = [
  { value: 'all',          label: 'All metrics' },
  { value: 'actual_temp',  label: 'Observed temperature' },
  { value: 'high_temp',    label: 'Daily high' },
  { value: 'low_temp',     label: 'Daily low' },
  { value: 'actual_wind',  label: 'Wind speed' },
  { value: 'actual_gust',  label: 'Wind gust' },
];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'lock_soonest', label: 'Locks soonest' },
  { value: 'target_date',  label: 'Target date' },
  { value: 'newest',       label: 'Newest' },
];

export default function PublicWagerList({ wagers, initialStatus = 'all' }: Props) {
  const [status, setStatus] = useState<StatusFilter>(initialStatus);
  const [kind, setKind] = useState<KindFilter>('all');
  const [metric, setMetric] = useState<MetricFilter>('all');
  const [locationQuery, setLocationQuery] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [sort, setSort] = useState<SortKey>('lock_soonest');

  const filtered = useMemo(() => {
    const loc = locationQuery.trim().toLowerCase();
    const q = searchQuery.trim().toLowerCase();
    return wagers.filter(w => {
      if (status !== 'all' && w.status !== status) return false;
      if (kind !== 'all' && w.kind !== kind) return false;
      if (metric !== 'all' && w.metric !== metric) return false;
      if (loc && !w.locationSummary.toLowerCase().includes(loc)) return false;
      if (targetDate && w.targetDate !== targetDate) return false;
      if (q) {
        const hay = `${w.title} ${w.locationSummary}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [wagers, status, kind, metric, locationQuery, searchQuery, targetDate]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sort === 'lock_soonest') {
      arr.sort((a, b) => new Date(a.lockTime).getTime() - new Date(b.lockTime).getTime());
    } else if (sort === 'target_date') {
      arr.sort((a, b) => a.targetDate.localeCompare(b.targetDate));
    } else {
      arr.sort((a, b) => new Date(b.lastUpdatedAt).getTime() - new Date(a.lastUpdatedAt).getTime());
    }
    return arr;
  }, [filtered, sort]);

  // Group into sections: open → locked → resolved → voided/cancelled.
  const sections = useMemo(() => {
    const buckets: Record<'open' | 'locked' | 'graded' | 'void', PublicWagerView[]> = {
      open: [], locked: [], graded: [], void: [],
    };
    for (const w of sorted) {
      if (w.status === 'open' || w.status === 'locked' || w.status === 'graded' || w.status === 'void') {
        buckets[w.status].push(w);
      }
    }
    return [
      { key: 'open',   title: 'Open markets',         subtitle: 'Accepting interest now',     items: buckets.open },
      { key: 'locked', title: 'Locked markets',       subtitle: 'Awaiting target date',       items: buckets.locked },
      { key: 'graded', title: 'Resolved markets',     subtitle: 'Settled outcomes',           items: buckets.graded },
      { key: 'void',   title: 'Voided / Cancelled',   subtitle: 'Cancelled before resolution', items: buckets.void },
    ] as const;
  }, [sorted]);

  const totalAfterFilter = sorted.length;
  const filtersActive =
    status !== initialStatus ||
    kind !== 'all' ||
    metric !== 'all' ||
    !!locationQuery ||
    !!searchQuery ||
    !!targetDate;

  const noWagersAtAll = wagers.length === 0;

  function resetFilters() {
    setStatus(initialStatus);
    setKind('all');
    setMetric('all');
    setLocationQuery('');
    setSearchQuery('');
    setTargetDate('');
    setSort('lock_soonest');
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold text-slate-900">Weather Markets</h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          Browse weather-based markets. Each market explains what is being measured, when it locks,
          and how it resolves. Tap a market to see full details.
        </p>
      </header>

      {/* Search + filters */}
      <section
        aria-label="Filter markets"
        className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
      >
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <label className="flex flex-col text-xs font-medium text-slate-600">
            Search title or location
            <input
              type="search"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="e.g. Columbia, gust, high temp"
              className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </label>

          <label className="flex flex-col text-xs font-medium text-slate-600">
            Location contains
            <input
              type="text"
              value={locationQuery}
              onChange={e => setLocationQuery(e.target.value)}
              placeholder="e.g. Columbia, KCAE"
              className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </label>

          <label className="flex flex-col text-xs font-medium text-slate-600">
            Target date
            <input
              type="date"
              value={targetDate}
              onChange={e => setTargetDate(e.target.value)}
              className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </label>

          <label className="flex flex-col text-xs font-medium text-slate-600">
            Status
            <select
              value={status}
              onChange={e => setStatus(e.target.value as StatusFilter)}
              className="mt-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {STATUS_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col text-xs font-medium text-slate-600">
            Kind
            <select
              value={kind}
              onChange={e => setKind(e.target.value as KindFilter)}
              className="mt-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {KIND_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col text-xs font-medium text-slate-600">
            Metric
            <select
              value={metric}
              onChange={e => setMetric(e.target.value as MetricFilter)}
              className="mt-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {METRIC_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
            Sort by
            <select
              value={sort}
              onChange={e => setSort(e.target.value as SortKey)}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {SORT_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>

          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span>{totalAfterFilter} {totalAfterFilter === 1 ? 'market' : 'markets'} shown</span>
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
        </div>
      </section>

      {/* Empty states */}
      {noWagersAtAll && (
        <div className="rounded-lg border border-slate-200 bg-white px-6 py-12 text-center">
          <h2 className="text-xl font-semibold text-slate-900">No open markets right now</h2>
          <p className="mt-2 text-slate-600">
            New weather-based markets are posted regularly. Check back soon.
          </p>
        </div>
      )}

      {!noWagersAtAll && totalAfterFilter === 0 && status === 'void' && (
        <div className="rounded-lg border border-slate-200 bg-white px-6 py-12 text-center">
          <h2 className="text-xl font-semibold text-slate-900">
            No voided or cancelled markets right now.
          </h2>
          <p className="mt-2 text-slate-600">
            Voided markets appear here for transparency when a market is cancelled before it can resolve.
          </p>
          <button
            type="button"
            onClick={resetFilters}
            className="mt-4 inline-flex items-center rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Clear filters
          </button>
        </div>
      )}

      {!noWagersAtAll && totalAfterFilter === 0 && status !== 'void' && (
        <div className="rounded-lg border border-slate-200 bg-white px-6 py-12 text-center">
          <h2 className="text-xl font-semibold text-slate-900">No markets match your filters</h2>
          <p className="mt-2 text-slate-600">
            Try clearing some filters to see more markets.
          </p>
          <button
            type="button"
            onClick={resetFilters}
            className="mt-4 inline-flex items-center rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Sections: Open → Locked → Resolved */}
      {!noWagersAtAll && totalAfterFilter > 0 && sections.map(section => (
        section.items.length === 0 ? null : (
          <section key={section.key} className="mb-8">
            <div className="mb-3 flex items-baseline justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{section.title}</h2>
                <p className="text-xs text-slate-500">{section.subtitle}</p>
              </div>
              <span className="text-xs font-semibold text-slate-500">
                {section.items.length} {section.items.length === 1 ? 'market' : 'markets'}
              </span>
            </div>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {section.items.map(w => (
                <li key={w.id}>
                  <WagerCard wager={w} />
                </li>
              ))}
            </ul>
          </section>
        )
      ))}

      {/* Responsible play note */}
      <aside className="mt-10 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
        <strong className="font-semibold">Play responsibly.</strong>{' '}
        Wagering on weather outcomes carries real risk. Wager only what you can afford to lose,
        set personal limits, and seek help at 1-800-GAMBLER if play is causing harm.
      </aside>
    </div>
  );
}

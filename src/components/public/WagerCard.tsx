// ── Step 114: Public wager card ─────────────────────────────────────────────
//
// Single-card renderer used by PublicWagerList. Public, read-only — every
// field comes from PublicWagerView (Step 113 strip), never from a raw Wager.

import React from 'react';
import type { PublicWagerView } from '../../lib/public-wager-view';

interface Props {
  wager: PublicWagerView;
}

const STATUS_BADGE: Record<string, string> = {
  open:   'bg-emerald-100 text-emerald-800 ring-emerald-200',
  locked: 'bg-amber-100 text-amber-800 ring-amber-200',
  graded: 'bg-blue-100 text-blue-800 ring-blue-200',
  void:   'bg-slate-200 text-slate-700 ring-slate-300',
};

const STATUS_LABEL: Record<string, string> = {
  open:   'Open',
  locked: 'Locked',
  graded: 'Resolved',
  void:   'Void',
};

const KIND_LABEL: Record<string, string> = {
  odds:          'Range odds',
  'over-under':  'Over / under',
  pointspread:   'Pointspread',
};

const METRIC_LABEL: Record<string, string> = {
  actual_temp: 'Observed temp',
  high_temp:   'Daily high',
  low_temp:    'Daily low',
  actual_wind: 'Wind speed',
  actual_gust: 'Wind gust',
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatTargetDate(date: string, time?: string): string {
  // targetDate is a YYYY-MM-DD; format it without timezone shenanigans
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return time ? `${date} ${time}` : date;
  const local = new Date(y, m - 1, d);
  const datePart = local.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return time ? `${datePart} · ${time}` : datePart;
}

export default function WagerCard({ wager }: Props) {
  const statusClass = STATUS_BADGE[wager.status] ?? 'bg-slate-100 text-slate-700 ring-slate-200';
  const statusLabel = STATUS_LABEL[wager.status] ?? wager.status;
  const kindLabel = KIND_LABEL[wager.kind] ?? wager.kind;
  const metricLabel = METRIC_LABEL[wager.metric] ?? wager.metric;

  return (
    <a
      href={`/wagers/${wager.id}`}
      className="flex h-full flex-col rounded-lg border border-slate-200 bg-white p-4 transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-slate-500">{wager.ticketNumber}</span>
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${statusClass}`}>
          {statusLabel}
        </span>
      </div>

      <h3 className="text-base font-semibold text-slate-900 line-clamp-2">{wager.title}</h3>

      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-500">
        <div>
          <dt className="font-medium uppercase tracking-wide">Kind</dt>
          <dd className="text-slate-700">{kindLabel}</dd>
        </div>
        <div>
          <dt className="font-medium uppercase tracking-wide">Metric</dt>
          <dd className="text-slate-700">{metricLabel}</dd>
        </div>
        <div className="col-span-2">
          <dt className="font-medium uppercase tracking-wide">Location</dt>
          <dd className="text-slate-700 line-clamp-1">{wager.locationSummary}</dd>
        </div>
        <div>
          <dt className="font-medium uppercase tracking-wide">Target</dt>
          <dd className="text-slate-700">{formatTargetDate(wager.targetDate, wager.targetTime)}</dd>
        </div>
        <div>
          <dt className="font-medium uppercase tracking-wide">{wager.status === 'open' ? 'Locks' : 'Locked'}</dt>
          <dd className="text-slate-700">{formatDateTime(wager.lockTime)}</dd>
        </div>
      </dl>

      <p className="mt-3 line-clamp-2 text-sm text-slate-600">{wager.termsSummary}</p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {wager.outcomes.slice(0, 4).map((o, i) => (
          <span
            key={i}
            className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-mono ${
              o.isWinner
                ? 'border-blue-400 bg-blue-50 text-blue-800'
                : 'border-slate-200 bg-slate-50 text-slate-700'
            }`}
          >
            {o.label}
            {typeof o.displayedOdds === 'number' ? ` · ${formatAmericanOdds(o.displayedOdds)}` : ''}
          </span>
        ))}
      </div>

      {wager.status === 'graded' && wager.winningOutcome && (
        <p className="mt-3 text-xs font-semibold text-blue-700">
          Resolved: {wager.winningOutcome}
          {typeof wager.observedValue === 'number' ? ` (observed ${wager.observedValue})` : ''}
        </p>
      )}
      {wager.status === 'void' && (
        <p className="mt-3 text-xs text-slate-500">
          This market was cancelled before resolution.
        </p>
      )}
    </a>
  );
}

function formatAmericanOdds(odds: number): string {
  if (!Number.isFinite(odds)) return '—';
  return odds > 0 ? `+${odds}` : String(odds);
}

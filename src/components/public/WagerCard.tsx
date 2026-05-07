// ── Step 119C Part B: Public wager card (mobile-first redesign) ─────────────
//
// Single-card renderer used by PublicWagerList. Public, read-only — every
// field comes from PublicWagerView (Step 113 strip), never from a raw Wager.
// Step 119C: reduced visual density, bigger odds, prominent lock countdown,
// cleaner status chip.

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
  void:   'Cancelled',
};

const METRIC_ICON: Record<string, string> = {
  actual_temp: '🌡',
  high_temp:   '☀',
  low_temp:    '❄',
  actual_wind: '💨',
  actual_gust: '💨',
};

const METRIC_LABEL: Record<string, string> = {
  actual_temp: 'Temperature',
  high_temp:   'High temp',
  low_temp:    'Low temp',
  actual_wind: 'Wind',
  actual_gust: 'Wind gust',
};

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'locking now';
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days >= 2) return `${days} days`;
  if (days === 1) return `1 day ${hours % 24}h`;
  if (hours >= 1) return `${hours}h ${minutes % 60}m`;
  return `${Math.max(minutes, 1)}m`;
}

function formatTargetDate(date: string, time?: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return time ? `${date} ${time}` : date;
  const local = new Date(y, m - 1, d);
  const datePart = local.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return time ? `${datePart} · ${time}` : datePart;
}

function formatAmericanOdds(odds: number | undefined): string {
  if (odds == null || !Number.isFinite(odds)) return '—';
  return odds > 0 ? `+${odds}` : String(odds);
}

export default function WagerCard({ wager }: Props) {
  const statusClass = STATUS_BADGE[wager.status] ?? 'bg-slate-100 text-slate-700 ring-slate-200';
  const statusLabel = STATUS_LABEL[wager.status] ?? wager.status;
  const icon = METRIC_ICON[wager.metric] ?? '🌦';
  const metricLabel = METRIC_LABEL[wager.metric] ?? wager.metric;
  const lockMs = new Date(wager.lockTime).getTime() - Date.now();
  const showCountdown = wager.status === 'open' && lockMs > 0;

  return (
    <a
      href={`/wagers/${wager.id}`}
      className="flex h-full flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 sm:p-5"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span aria-hidden className="text-xl leading-none">{icon}</span>
          <span className="text-xs font-medium text-slate-500">{metricLabel}</span>
        </div>
        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${statusClass}`}>
          {statusLabel}
        </span>
      </div>

      <h3 className="text-base font-semibold text-slate-900 line-clamp-2 sm:text-lg">{wager.title}</h3>

      <div className="text-xs text-slate-500 line-clamp-1">{wager.locationSummary} · {formatTargetDate(wager.targetDate, wager.targetTime)}</div>

      {wager.outcomes.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {wager.outcomes.slice(0, 3).map((o, i) => (
            <div
              key={i}
              className={`flex flex-col items-center justify-center rounded-lg border px-2 py-2 text-center ${
                o.isWinner
                  ? 'border-blue-400 bg-blue-50'
                  : 'border-slate-200 bg-slate-50'
              }`}
            >
              <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500 line-clamp-1">{o.label}</span>
              <span className={`mt-0.5 font-mono text-base font-bold ${o.isWinner ? 'text-blue-700' : 'text-slate-900'}`}>
                {formatAmericanOdds(o.displayedOdds)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-3 text-xs">
        {showCountdown ? (
          <span className="font-semibold text-emerald-700">Locks in {formatCountdown(lockMs)}</span>
        ) : wager.status === 'locked' ? (
          <span className="font-semibold text-amber-700">Awaiting resolution</span>
        ) : wager.status === 'graded' && wager.winningOutcome ? (
          <span className="font-semibold text-blue-700">Won: {wager.winningOutcome}</span>
        ) : wager.status === 'void' ? (
          <span className="text-slate-500">Cancelled before resolution</span>
        ) : (
          <span className="text-slate-500">Status: {statusLabel}</span>
        )}
        <span className="font-mono text-[11px] text-slate-400">{wager.ticketNumber}</span>
      </div>
    </a>
  );
}

// Public, read-only list of markets. Server-rendered from
// listPublicWagers — no admin API calls, no mutation surface.

import React from 'react';
import type { PublicWagerView } from '../../lib/public-wager-view';

interface Props {
  wagers: PublicWagerView[];
  total: number;
}

const STATUS_BADGE: Record<string, string> = {
  open: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  locked: 'bg-amber-100 text-amber-800 ring-amber-200',
  graded: 'bg-blue-100 text-blue-800 ring-blue-200',
  void: 'bg-slate-200 text-slate-700 ring-slate-300',
};

const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  locked: 'Locked',
  graded: 'Resolved',
  void: 'Void',
};

const KIND_LABEL: Record<string, string> = {
  odds: 'Range odds',
  'over-under': 'Over / under',
  pointspread: 'Pointspread',
};

export default function PublicWagerList({ wagers, total }: Props) {
  if (wagers.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-3xl font-bold text-slate-900">No markets available</h1>
        <p className="mt-3 text-slate-600">
          There are no published markets right now. Check back soon — new weather-based markets are posted regularly.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-900">Markets</h1>
        <p className="mt-2 text-slate-600">
          Browse the {total} most recent weather markets on Wager on Weather. Markets are read-only previews — outcomes resolve from documented weather observations.
        </p>
      </div>

      <ul className="grid gap-4 sm:grid-cols-2">
        {wagers.map((w) => (
          <li key={w.id}>
            <a
              href={`/wagers/${w.id}`}
              className="block rounded-lg border border-slate-200 bg-white p-4 transition-shadow hover:shadow-md"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-slate-500">{w.ticketNumber}</span>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${STATUS_BADGE[w.status] ?? 'bg-slate-100 text-slate-700 ring-slate-200'}`}>
                  {STATUS_LABEL[w.status] ?? w.status}
                </span>
              </div>
              <div className="text-base font-semibold text-slate-900">{w.title}</div>
              <div className="mt-1 text-xs text-slate-500">
                {KIND_LABEL[w.kind] ?? w.kind} · {w.targetDate}
              </div>
              <div className="mt-2 text-sm text-slate-600 line-clamp-2">{w.termsSummary}</div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {w.outcomes.slice(0, 4).map((o, i) => (
                  <span
                    key={i}
                    className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-mono ${o.isWinner ? 'border-blue-400 bg-blue-50 text-blue-800' : 'border-slate-200 bg-slate-50 text-slate-700'}`}
                  >
                    {o.label}{typeof o.displayedOdds === 'number' ? ` ${formatAmericanOdds(o.displayedOdds)}` : ''}
                  </span>
                ))}
              </div>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatAmericanOdds(odds: number): string {
  if (!Number.isFinite(odds)) return '—';
  return odds > 0 ? `+${odds}` : String(odds);
}

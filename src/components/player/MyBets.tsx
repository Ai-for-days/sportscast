// ── Step 121 Part B: My Bets — customer-safe, mobile-first ─────────────────
//
// Standalone client component. Fetches the sanitized customer bet API and
// groups bets by underlying wager status. Reads only SafeCustomerBetView
// fields. No raw Wager. No admin/Kalshi/internal data.

import React, { useEffect, useMemo, useState } from 'react';
import CustomerActivityTimeline from './CustomerActivityTimeline';
import { formatDMY, formatDMYTime } from '../../lib/date-format';

type BetStatus = 'pending' | 'won' | 'lost' | 'push' | 'void';
type WagerStatus = 'open' | 'locked' | 'graded' | 'void';

interface PublicOutcome {
  label: string;
  displayedOdds?: number;
  isWinner?: boolean;
}

interface PublicWagerView {
  id: string;
  ticketNumber: string;
  title: string;
  description?: string;
  kind: 'odds' | 'over-under' | 'pointspread';
  status: WagerStatus;
  metric: string;
  targetDate: string;
  targetTime?: string;
  lockTime: string;
  locationSummary: string;
  termsSummary: string;
  outcomes: PublicOutcome[];
  displayedOdds: string;
  winningOutcome?: string;
  observedValue?: number;
  observedValueA?: number;
  observedValueB?: number;
  unit?: string;
  line?: number;
  spread?: number;
  locationAName?: string;
  locationBName?: string;
}

interface SafeBet {
  id: string;
  ticketNumber?: string;
  wagerId: string;
  wagerTitle: string;
  wagerStatus: WagerStatus;
  outcomeLabel: string;
  odds: number;
  stakeCents: number;
  potentialPayoutCents: number;
  placedAt: string;
  settledAt?: string;
  status: BetStatus;
  publicWagerView?: PublicWagerView;
  resolvedOutcome?: string;
  userVisibleResult?: string;
}

const GROUPS: { key: WagerStatus; label: string; chip: string }[] = [
  { key: 'open', label: 'Open', chip: 'bg-emerald-100 text-emerald-800 ring-emerald-200' },
  { key: 'locked', label: 'Locked', chip: 'bg-amber-100 text-amber-800 ring-amber-200' },
  { key: 'graded', label: 'Resolved', chip: 'bg-blue-100 text-blue-800 ring-blue-200' },
  { key: 'void', label: 'Cancelled', chip: 'bg-slate-200 text-slate-700 ring-slate-300' },
];

const RESULT_BADGE: Record<BetStatus, { bg: string; text: string; label: string }> = {
  pending: { bg: 'bg-amber-50 ring-amber-200', text: 'text-amber-700', label: 'Pending' },
  won: { bg: 'bg-emerald-50 ring-emerald-300', text: 'text-emerald-700', label: 'Won' },
  lost: { bg: 'bg-red-50 ring-red-200', text: 'text-red-700', label: 'Lost' },
  push: { bg: 'bg-slate-50 ring-slate-200', text: 'text-slate-600', label: 'Push' },
  void: { bg: 'bg-slate-50 ring-slate-200', text: 'text-slate-500', label: 'Cancelled' },
};

function dollars(cents: number): string {
  return (Math.abs(cents) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatOdds(odds: number): string {
  if (!Number.isFinite(odds)) return '—';
  return odds > 0 ? `+${odds}` : String(odds);
}

function pickName(bet: SafeBet): string {
  const pwv = bet.publicWagerView;
  const matched = pwv?.outcomes.find((o) => o.label === bet.outcomeLabel);
  if (matched) return matched.label;
  if (pwv?.kind === 'pointspread') {
    if (bet.outcomeLabel === 'locationA' && pwv.locationAName) return pwv.locationAName;
    if (bet.outcomeLabel === 'locationB' && pwv.locationBName) return pwv.locationBName;
  }
  if (pwv?.kind === 'over-under' && pwv.line != null) {
    if (bet.outcomeLabel.toLowerCase().startsWith('over')) return `Over ${pwv.line}${pwv.unit ?? ''}`;
    if (bet.outcomeLabel.toLowerCase().startsWith('under')) return `Under ${pwv.line}${pwv.unit ?? ''}`;
  }
  return bet.outcomeLabel;
}

function awaitingResolutionMessage(pwv?: PublicWagerView): string {
  if (!pwv) return 'Awaiting weather resolution.';
  if (pwv.status === 'locked') {
    return 'Market is locked. Awaiting authoritative weather observations for the target date — your bet will resolve automatically once the result is recorded.';
  }
  if (pwv.status === 'open') {
    return `Market is open. Wagering closes at ${formatDMYTime(pwv.lockTime)}; after that the market awaits weather resolution.`;
  }
  return 'Awaiting weather resolution.';
}

export default function MyBets() {
  const [bets, setBets] = useState<SafeBet[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    let cancelled = false;
    fetch('/api/bets?limit=200')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Failed to load bets'))))
      .then((j) => {
        if (cancelled) return;
        setBets(Array.isArray(j?.bets) ? (j.bets as SafeBet[]) : []);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? 'Failed to load.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const grouped = useMemo(() => {
    const out: Record<WagerStatus, SafeBet[]> = { open: [], locked: [], graded: [], void: [] };
    if (!bets) return out;
    for (const b of bets) (out[b.wagerStatus] ?? out.open).push(b);
    return out;
  }, [bets]);

  if (error) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Couldn&apos;t load your bets. {error}
      </div>
    );
  }
  if (bets === null) {
    return (
      <div className="grid gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg border border-slate-200 bg-slate-50" />
        ))}
      </div>
    );
  }
  if (bets.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
        No bets yet.{' '}
        <a href="/wagers" className="font-semibold text-blue-600 hover:underline">
          Browse open markets
        </a>{' '}
        to place your first one.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {GROUPS.map((g) => {
        const list = grouped[g.key];
        if (!list || list.length === 0) return null;
        return (
          <section key={g.key}>
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-base font-semibold text-slate-900">{g.label}</h2>
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${g.chip}`}>
                {list.length}
              </span>
            </div>
            <div className="grid gap-3">
              {list.map((bet) => {
                const pwv = bet.publicWagerView;
                const profit = bet.potentialPayoutCents - bet.stakeCents;
                const result = RESULT_BADGE[bet.status];
                const isOpen = expanded.has(bet.id);
                return (
                  <div
                    key={bet.id}
                    className="rounded-xl border border-slate-200 bg-white p-4 transition-shadow hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold text-slate-900 line-clamp-2 sm:text-base">
                          {bet.wagerTitle}
                        </h3>
                        {pwv && (
                          <p className="mt-0.5 text-xs text-slate-500 line-clamp-1">
                            {pwv.locationSummary} ·{' '}
                            {formatDMY(pwv.targetDate + 'T12:00:00')}
                          </p>
                        )}
                      </div>
                      <span
                        className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${result.bg} ${result.text}`}
                      >
                        {result.label}
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Pick</div>
                        <div className="font-semibold text-slate-900">{pickName(bet)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Odds</div>
                        <div
                          className={`font-mono font-bold ${
                            bet.odds > 0 ? 'text-emerald-600' : 'text-slate-900'
                          }`}
                        >
                          {formatOdds(bet.odds)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Stake</div>
                        <div className="font-mono font-semibold text-slate-800">${dollars(bet.stakeCents)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                          {bet.status === 'won' ? 'Profit' : bet.status === 'lost' ? 'Lost' : 'Potential'}
                        </div>
                        <div
                          className={`font-mono font-semibold ${
                            bet.status === 'won'
                              ? 'text-emerald-600'
                              : bet.status === 'lost'
                                ? 'text-red-500'
                                : 'text-slate-800'
                          }`}
                        >
                          {bet.status === 'won'
                            ? `+$${dollars(profit)}`
                            : bet.status === 'lost'
                              ? `-$${dollars(bet.stakeCents)}`
                              : bet.status === 'push' || bet.status === 'void'
                                ? '$0.00'
                                : `$${dollars(bet.potentialPayoutCents)}`}
                        </div>
                      </div>
                    </div>

                    {(g.key === 'open' || g.key === 'locked') && (
                      <p className="mt-3 text-xs text-slate-500">{awaitingResolutionMessage(pwv)}</p>
                    )}
                    {g.key === 'graded' && pwv?.winningOutcome && (
                      <p className="mt-3 text-xs text-slate-500">
                        Resolved: <strong>{pwv.winningOutcome}</strong>
                        {typeof pwv.observedValue === 'number'
                          ? ` (observed ${pwv.observedValue}${pwv.unit ?? ''})`
                          : ''}
                      </p>
                    )}
                    {g.key === 'void' && (
                      <p className="mt-3 text-xs text-slate-500">
                        This market was cancelled before resolution. Your stake is returned per platform terms.
                      </p>
                    )}

                    <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
                      <button
                        type="button"
                        onClick={() => toggle(bet.id)}
                        className="text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500"
                        aria-expanded={isOpen}
                      >
                        {isOpen ? 'Hide activity' : 'Show activity'}
                      </button>
                      <a
                        href={`/wagers/${bet.wagerId}`}
                        className="text-xs font-semibold text-slate-500 hover:text-slate-700 hover:underline"
                      >
                        View market →
                      </a>
                    </div>
                    {isOpen && (
                      <div className="mt-3">
                        <CustomerActivityTimeline bet={bet} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

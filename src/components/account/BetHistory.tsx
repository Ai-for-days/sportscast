import { useState, useEffect } from 'react';
import type { EnrichedBet, BetStatus } from '../../lib/bet-types';
import type { Wager, OddsWager, OverUnderWager, PointspreadWager } from '../../lib/wager-types';

const STATUS_STYLES: Record<BetStatus, { bg: string; text: string; border: string; label: string }> = {
  pending: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', label: 'Pending' },
  won: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-300', label: 'Won' },
  lost: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', label: 'Lost' },
  push: { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200', label: 'Push' },
  void: { bg: 'bg-slate-50', text: 'text-slate-500', border: 'border-slate-200', label: 'Void' },
};

const KIND_LABELS: Record<string, string> = {
  'over-under': 'Over/Under',
  odds: 'Odds',
  pointspread: 'Pointspread',
};

const METRIC_LABELS: Record<string, string> = {
  actual_temp: 'Temp at Time',
  high_temp: 'High Temp',
  low_temp: 'Low Temp',
  actual_wind: 'Wind Speed',
  actual_gust: 'Wind Gusts',
};

const METRIC_UNITS: Record<string, string> = {
  actual_temp: '°F',
  high_temp: '°F',
  low_temp: '°F',
  actual_wind: 'mph',
  actual_gust: 'mph',
};

function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function fmtUSD(cents: number): string {
  return (Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function getLocationName(wager: Wager): string {
  if (wager.kind === 'pointspread') return `${wager.locationA.name} vs ${wager.locationB.name}`;
  return wager.location.name;
}

/** Get the human-readable pick name (resolves locationA/B to city names) */
function getPickName(bet: EnrichedBet): string {
  const w = bet.wager;
  if (!w) return bet.outcomeLabel;
  if (w.kind === 'pointspread') {
    const ps = w as PointspreadWager;
    if (bet.outcomeLabel === 'locationA') return ps.locationA.name;
    if (bet.outcomeLabel === 'locationB') return ps.locationB.name;
  }
  return bet.outcomeLabel;
}

/** Get detailed pick description with ranges/lines/spreads */
function getPickDescription(bet: EnrichedBet): string | null {
  const w = bet.wager;
  if (!w) return null;
  const unit = METRIC_UNITS[w.metric] || '';

  if (w.kind === 'odds') {
    const ow = w as OddsWager;
    const outcome = ow.outcomes.find(o => o.label === bet.outcomeLabel);
    if (outcome) {
      return `Range: ${outcome.minValue}${unit} – ${outcome.maxValue}${unit}`;
    }
  }
  if (w.kind === 'over-under') {
    const ou = w as OverUnderWager;
    return `${bet.outcomeLabel === 'over' ? 'Over' : 'Under'} ${ou.line}${unit}`;
  }
  if (w.kind === 'pointspread') {
    const ps = w as PointspreadWager;
    const spread = bet.outcomeLabel === 'locationA'
      ? (ps.spread >= 0 ? `-${ps.spread}` : `+${Math.abs(ps.spread)}`)
      : (ps.spread >= 0 ? `+${ps.spread}` : `-${Math.abs(ps.spread)}`);
    const cityName = bet.outcomeLabel === 'locationA' ? ps.locationA.name : ps.locationB.name;
    return `${cityName} ${spread} (spread)`;
  }
  return null;
}

function getWagerSpecs(wager: Wager): string {
  const unit = METRIC_UNITS[wager.metric] || '';
  if (wager.kind === 'over-under') {
    const ou = wager as OverUnderWager;
    return `Line ${ou.line}${unit} · Over ${formatOdds(ou.over.odds)} / Under ${formatOdds(ou.under.odds)}`;
  }
  if (wager.kind === 'odds') {
    const ow = wager as OddsWager;
    return ow.outcomes.map(o => `${o.label} [${o.minValue}–${o.maxValue}${unit}] (${formatOdds(o.odds)})`).join(' · ');
  }
  if (wager.kind === 'pointspread') {
    const ps = wager as PointspreadWager;
    const spread = ps.spread > 0 ? `+${ps.spread}` : `${ps.spread}`;
    return `Spread ${spread} · ${ps.locationA.name} ${formatOdds(ps.locationAOdds)} / ${ps.locationB.name} ${formatOdds(ps.locationBOdds)}`;
  }
  return '';
}

function BetCard({ bet }: { bet: EnrichedBet }) {
  const style = STATUS_STYLES[bet.status];
  const w = bet.wager;
  const profit = bet.potentialPayoutCents - bet.amountCents;
  const pickName = getPickName(bet);
  const pickDesc = getPickDescription(bet);

  return (
    <div className={`rounded-xl border ${style.border} ${style.bg} p-4 transition-shadow hover:shadow-md`}>
      {/* Header: title + status + ticket */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <h4 className="font-bold text-gray-900 text-base leading-tight">
            {w?.title || 'Wager'}
          </h4>
          {w && (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500">
              <span className="inline-flex items-center gap-1">
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                {getLocationName(w)}
              </span>
              <span className="text-gray-300">|</span>
              <span>{METRIC_LABELS[w.metric] || w.metric}</span>
              <span className="text-gray-300">|</span>
              <span>{formatDate(w.targetDate + 'T12:00:00')}</span>
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${
            bet.status === 'won' ? 'ring-emerald-300' :
            bet.status === 'lost' ? 'ring-red-200' :
            bet.status === 'pending' ? 'ring-amber-200' :
            'ring-slate-200'
          } ${style.bg} ${style.text}`}>
            {style.label}
          </span>
          <span className="font-mono text-[10px] text-gray-400">
            #{bet.ticketNumber || bet.id.slice(-8).toUpperCase()}
          </span>
        </div>
      </div>

      {/* Two-column: Your Pick + Wager Details */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Your Pick */}
        <div className="rounded-lg bg-white/70 border border-gray-200/60 p-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Your Pick</div>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-lg font-bold text-gray-900">{pickName}</span>
            <span className={`font-mono text-sm font-bold ${bet.odds > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              {formatOdds(bet.odds)}
            </span>
          </div>
          {pickDesc && (
            <div className="text-xs text-gray-500 mb-2">{pickDesc}</div>
          )}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm mt-2">
            <div>
              <span className="text-gray-400 text-xs">Stake</span>
              <div className="font-mono font-semibold text-gray-800">${fmtUSD(bet.amountCents)}</div>
            </div>
            <div>
              <span className="text-gray-400 text-xs">
                {bet.status === 'won' ? 'Profit' : bet.status === 'lost' ? 'Lost' : 'To Win'}
              </span>
              <div className={`font-mono font-semibold ${
                bet.status === 'won' ? 'text-emerald-600' :
                bet.status === 'lost' ? 'text-red-500' :
                'text-gray-800'
              }`}>
                {bet.status === 'lost' ? `-$${fmtUSD(bet.amountCents)}`
                  : bet.status === 'push' || bet.status === 'void' ? '$0.00'
                  : `$${fmtUSD(profit)}`}
              </div>
            </div>
            {(bet.status === 'won' || bet.status === 'pending') && (
              <div className="col-span-2 mt-1 pt-1 border-t border-gray-100">
                <span className="text-gray-400 text-xs">Total Return</span>
                <div className="font-mono font-bold text-emerald-600">
                  ${fmtUSD(bet.potentialPayoutCents)}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Wager Details */}
        {w && (
          <div className="rounded-lg bg-white/70 border border-gray-200/60 p-3">
            <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">
              Wager Details
            </div>
            <div className="flex items-center gap-2 mb-1">
              <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                w.kind === 'over-under' ? 'bg-blue-100 text-blue-700' :
                w.kind === 'odds' ? 'bg-purple-100 text-purple-700' :
                'bg-orange-100 text-orange-700'
              }`}>
                {KIND_LABELS[w.kind] || w.kind}
              </span>
              {w.ticketNumber && (
                <span className="font-mono text-[10px] text-gray-400">#{w.ticketNumber}</span>
              )}
            </div>
            <div className="text-sm text-gray-600 leading-relaxed mt-1">
              {getWagerSpecs(w)}
            </div>
            {w.description && (
              <p className="text-xs text-gray-400 mt-2 italic">{w.description}</p>
            )}
          </div>
        )}
      </div>

      {/* Graded result */}
      {w?.status === 'graded' && w.observedValue != null && (
        <div className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
          bet.status === 'won' ? 'border-emerald-300 bg-emerald-50' :
          bet.status === 'lost' ? 'border-red-200 bg-red-50' :
          'border-slate-200 bg-slate-50'
        }`}>
          <span className="text-gray-500 text-xs">NWS Observed: </span>
          <span className="font-mono font-bold text-gray-800">{w.observedValue}{METRIC_UNITS[w.metric] || ''}</span>
          {w.winningOutcome && (
            <>
              <span className="mx-2 text-gray-300">&rarr;</span>
              <span className={`font-semibold ${
                w.winningOutcome === bet.outcomeLabel ? 'text-emerald-600' :
                w.winningOutcome === 'no_match' || w.winningOutcome === 'none' ? 'text-slate-500' :
                'text-red-500'
              }`}>
                {w.winningOutcome === 'no_match' || w.winningOutcome === 'none'
                  ? 'No match — all bets lose'
                  : w.kind === 'pointspread'
                    ? `${w.winningOutcome === 'locationA' ? (w as PointspreadWager).locationA.name : (w as PointspreadWager).locationB.name} wins`
                    : `${w.winningOutcome} wins`}
              </span>
            </>
          )}
        </div>
      )}

      {/* Footer: placed date + ticket */}
      <div className="mt-3 text-xs text-gray-400">
        Placed {formatDateTime(bet.createdAt)}
        {bet.settledAt && ` · Settled ${formatDateTime(bet.settledAt)}`}
      </div>
    </div>
  );
}

export default function BetHistory() {
  const [bets, setBets] = useState<EnrichedBet[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/bets?limit=50')
      .then(r => r.json())
      .then(data => setBets(data.bets || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-field/20 border-t-field" />
      </div>
    );
  }

  if (bets.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 px-6 py-8 text-center text-sm text-gray-500">
        No bets yet. Visit the <a href="/bettheforecast" className="text-field hover:underline">wagers page</a> to place your first bet!
      </div>
    );
  }

  const activeBets = bets.filter(b => b.status === 'pending');
  const settledBets = bets.filter(b => b.status !== 'pending');

  return (
    <div className="space-y-6">
      {activeBets.length > 0 && (
        <div>
          <h4 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-amber-600">
            <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
            Active ({activeBets.length})
          </h4>
          <div className="grid gap-3">
            {activeBets.map(bet => <BetCard key={bet.id} bet={bet} />)}
          </div>
        </div>
      )}
      {settledBets.length > 0 && (
        <div>
          <h4 className="mb-3 text-sm font-bold uppercase tracking-wider text-gray-400">
            Settled ({settledBets.length})
          </h4>
          <div className="grid gap-3">
            {settledBets.map(bet => <BetCard key={bet.id} bet={bet} />)}
          </div>
        </div>
      )}
    </div>
  );
}

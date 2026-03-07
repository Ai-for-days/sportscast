import { useState, useEffect } from 'react';
import type { Wager, WagerStatus, OddsWager, OverUnderWager, PointspreadWager } from '../../lib/wager-types';
import type { Bet, BetStatus, EnrichedBet } from '../../lib/bet-types';
import type { Transaction } from '../../lib/wallet-types';
import WagerCard from '../wagers/WagerCard';
import BetSlip from '../wagers/BetSlip';
import DepositModal from '../account/DepositModal';

interface UserInfo {
  id: string;
  playerNumber: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
}

interface BetSelection {
  wagerId: string;
  wagerTitle: string;
  outcomeLabel: string;
  odds: number;
}

const BET_STATUS_STYLES: Record<BetStatus, { bg: string; text: string; border: string; label: string }> = {
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

const METRIC_LABELS_BET: Record<string, string> = {
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

/** Format cents as USD with commas: 2500000 → "25,000.00" */
function fmtUSD(cents: number): string {
  return (Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatOddsBet(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function formatDateBet(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTimeBet(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function getLocationNameBet(wager: Wager): string {
  if (wager.kind === 'pointspread') return `${wager.locationA.name} vs ${wager.locationB.name}`;
  return wager.location.name;
}

function getPickNameBet(bet: EnrichedBet): string {
  const w = bet.wager;
  if (!w) return bet.outcomeLabel;
  if (w.kind === 'pointspread') {
    const ps = w as PointspreadWager;
    if (bet.outcomeLabel === 'locationA') return ps.locationA.name;
    if (bet.outcomeLabel === 'locationB') return ps.locationB.name;
  }
  return bet.outcomeLabel;
}

function getPickDescriptionBet(bet: EnrichedBet): string | null {
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

function getWagerSpecsBet(wager: Wager): string {
  const unit = METRIC_UNITS[wager.metric] || '';
  if (wager.kind === 'over-under') {
    const ou = wager as OverUnderWager;
    return `Line ${ou.line}${unit} · Over ${formatOddsBet(ou.over.odds)} / Under ${formatOddsBet(ou.under.odds)}`;
  }
  if (wager.kind === 'odds') {
    const ow = wager as OddsWager;
    return ow.outcomes.map(o => `${o.label} [${o.minValue}–${o.maxValue}${unit}] (${formatOddsBet(o.odds)})`).join(' · ');
  }
  if (wager.kind === 'pointspread') {
    const ps = wager as PointspreadWager;
    const spread = ps.spread > 0 ? `+${ps.spread}` : `${ps.spread}`;
    return `Spread ${spread} · ${ps.locationA.name} ${formatOddsBet(ps.locationAOdds)} / ${ps.locationB.name} ${formatOddsBet(ps.locationBOdds)}`;
  }
  return '';
}

type Tab = 'wagers' | 'live' | 'previous' | 'history';

function BetCardSettled({ bet }: { bet: EnrichedBet }) {
  const style = BET_STATUS_STYLES[bet.status];
  const w = bet.wager;
  const profit = bet.potentialPayoutCents - bet.amountCents;
  const pickName = getPickNameBet(bet);
  const pickDesc = getPickDescriptionBet(bet);
  return (
    <div className={`rounded-xl border ${style.border} ${style.bg} p-4 transition-shadow hover:shadow-md`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <h4 className="font-bold text-gray-900 text-base leading-tight">{w?.title || 'Wager'}</h4>
          {w && (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500">
              <span className="inline-flex items-center gap-1">
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                {getLocationNameBet(w)}
              </span>
              <span className="text-gray-300">|</span>
              <span>{METRIC_LABELS_BET[w.metric] || w.metric}</span>
              <span className="text-gray-300">|</span>
              <span>{formatDateBet(w.targetDate + 'T12:00:00')}</span>
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${
            bet.status === 'won' ? 'ring-emerald-300' : bet.status === 'lost' ? 'ring-red-200' : 'ring-slate-200'
          } ${style.bg} ${style.text}`}>
            {style.label}
          </span>
          <span className="font-mono text-[10px] text-gray-400">
            #{bet.ticketNumber || bet.id.slice(-8).toUpperCase()}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-lg bg-white/70 border border-gray-200/60 p-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Your Pick</div>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-lg font-bold text-gray-900">{pickName}</span>
            <span className={`font-mono text-sm font-bold ${bet.odds > 0 ? 'text-emerald-600' : 'text-red-500'}`}>{formatOddsBet(bet.odds)}</span>
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
              <span className="text-gray-400 text-xs">{bet.status === 'won' ? 'Profit' : bet.status === 'lost' ? 'Lost' : 'Result'}</span>
              <div className={`font-mono font-semibold ${
                bet.status === 'won' ? 'text-emerald-600' : bet.status === 'lost' ? 'text-red-500' : 'text-gray-800'
              }`}>
                {bet.status === 'lost' ? `-$${fmtUSD(bet.amountCents)}`
                  : bet.status === 'push' || bet.status === 'void' ? '$0.00'
                  : `$${fmtUSD(profit)}`}
              </div>
            </div>
            {bet.status === 'won' && (
              <div className="col-span-2 mt-1 pt-1 border-t border-gray-100">
                <span className="text-gray-400 text-xs">Total Return</span>
                <div className="font-mono font-bold text-emerald-600">${fmtUSD(bet.potentialPayoutCents)}</div>
              </div>
            )}
          </div>
        </div>
        {w && (
          <div className="rounded-lg bg-white/70 border border-gray-200/60 p-3">
            <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Wager Details</div>
            <div className="flex items-center gap-2 mb-1">
              <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                w.kind === 'over-under' ? 'bg-blue-100 text-blue-700' :
                w.kind === 'odds' ? 'bg-purple-100 text-purple-700' :
                'bg-orange-100 text-orange-700'
              }`}>{KIND_LABELS[w.kind] || w.kind}</span>
              {w.ticketNumber && (
                <span className="font-mono text-[10px] text-gray-400">#{w.ticketNumber}</span>
              )}
            </div>
            <div className="text-sm text-gray-600 leading-relaxed mt-1">{getWagerSpecsBet(w)}</div>
            {w.description && (
              <p className="text-xs text-gray-400 mt-2 italic">{w.description}</p>
            )}
          </div>
        )}
      </div>
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
      <div className="mt-3 text-xs text-gray-400">
        Placed {formatDateTimeBet(bet.createdAt)}
        {bet.settledAt && ` · Settled ${formatDateTimeBet(bet.settledAt)}`}
      </div>
    </div>
  );
}

function PreviousWagersTab({ bets }: { bets: EnrichedBet[] }) {
  const settledBets = bets.filter(b => b.status !== 'pending');
  const [search, setSearch] = useState('');
  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({});

  if (settledBets.length === 0) {
    return (
      <div className="rounded-xl bg-slate-50 px-6 py-14 text-center">
        <p className="text-sm text-slate-500">No previous wagers yet. Your completed wagers will appear here.</p>
      </div>
    );
  }

  // Filter by search
  const filtered = search.trim()
    ? settledBets.filter(b => {
        const q = search.toLowerCase();
        const w = b.wager;
        return (
          (w?.title || '').toLowerCase().includes(q) ||
          (b.ticketNumber || '').toLowerCase().includes(q) ||
          (w?.ticketNumber || '').toLowerCase().includes(q) ||
          b.outcomeLabel.toLowerCase().includes(q) ||
          b.status.includes(q) ||
          (w && getLocationNameBet(w).toLowerCase().includes(q))
        );
      })
    : settledBets;

  // Group by month
  const grouped: Record<string, EnrichedBet[]> = {};
  for (const bet of filtered) {
    const d = new Date(bet.settledAt || bet.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(bet);
  }
  const monthKeys = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  // Current month expanded by default
  const currentMonthKey = (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  })();

  const isOpen = (key: string) => expandedMonths[key] ?? (key === currentMonthKey || key === monthKeys[0]);
  const toggleMonth = (key: string) =>
    setExpandedMonths(prev => ({ ...prev, [key]: !isOpen(key) }));

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by wager, ticket #, location, status..."
          className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-10 pr-4 py-2.5 text-sm text-gray-900 outline-none focus:border-emerald-400 focus:bg-white"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-sm">&times;</button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl bg-slate-50 px-6 py-8 text-center text-sm text-gray-500">
          No wagers match "{search}"
        </div>
      ) : (
        <div className="space-y-3">
          {monthKeys.map(key => {
            const monthBets = grouped[key];
            const open = isOpen(key);
            const wonCount = monthBets.filter(b => b.status === 'won').length;
            const lostCount = monthBets.filter(b => b.status === 'lost').length;

            return (
              <div key={key} className="rounded-xl border border-slate-200 overflow-hidden">
                <button
                  onClick={() => toggleMonth(key)}
                  className="flex w-full items-center justify-between bg-slate-800 px-4 py-3 text-left transition-colors hover:bg-slate-700"
                >
                  <div className="flex items-center gap-3">
                    <svg className={`h-4 w-4 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="text-sm font-semibold text-white">{formatMonthLabel(key)}</span>
                    <span className="text-xs text-slate-400">({monthBets.length} wager{monthBets.length !== 1 ? 's' : ''})</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-emerald-400 font-bold">{wonCount}W</span>
                    <span className="text-red-400 font-bold">{lostCount}L</span>
                  </div>
                </button>

                {open && (
                  <div className="bg-white p-4 grid gap-3">
                    {monthBets.map(bet => <BetCardSettled key={bet.id} bet={bet} />)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatMonthLabel(key: string): string {
  const [year, month] = key.split('-');
  const d = new Date(Number(year), Number(month) - 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/** Detect effective transaction type — handles old losses recorded as 'bet_placed' */
function getTxDisplay(tx: Transaction, txLabels: Record<string, string>): { label: string; isPositive: boolean } {
  // Old loss settlements were recorded with type 'bet_placed' and description starting with "Lost"
  if (tx.type === 'bet_placed' && tx.description.startsWith('Lost')) {
    return { label: 'Loss', isPositive: false };
  }
  if (tx.type === 'bet_lost') {
    return { label: 'Loss', isPositive: false };
  }
  return { label: txLabels[tx.type] || tx.type, isPositive: tx.amountCents >= 0 };
}

function TransactionGroups({
  grouped, monthKeys, currentMonthKey, txLabels,
}: {
  grouped: Record<string, Transaction[]>;
  monthKeys: string[];
  currentMonthKey: string;
  txLabels: Record<string, string>;
}) {
  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const k of monthKeys) init[k] = k === currentMonthKey || k === monthKeys[0];
    return init;
  });
  const [expandedTx, setExpandedTx] = useState<Record<string, boolean>>({});

  const toggleMonth = (key: string) =>
    setExpandedMonths(prev => ({ ...prev, [key]: !prev[key] }));
  const toggleTx = (id: string) =>
    setExpandedTx(prev => ({ ...prev, [id]: !prev[id] }));

  return (
    <div className="space-y-3">
      {monthKeys.map(key => {
        const txs = grouped[key];
        const isOpen = expandedMonths[key];
        const monthNet = txs.reduce((s, t) => s + t.amountCents, 0);

        return (
          <div key={key} className="rounded-xl border border-slate-200 overflow-hidden">
            <button
              onClick={() => toggleMonth(key)}
              className="flex w-full items-center justify-between bg-slate-800 px-4 py-3 text-left transition-colors hover:bg-slate-700"
            >
              <div className="flex items-center gap-3">
                <svg className={`h-4 w-4 text-slate-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                <span className="text-sm font-semibold text-white">{formatMonthLabel(key)}</span>
                <span className="text-xs text-slate-400">({txs.length} transaction{txs.length !== 1 ? 's' : ''})</span>
              </div>
              <span className={`font-mono text-sm font-bold ${monthNet >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {monthNet >= 0 ? '+' : '-'}${fmtUSD(monthNet)}
              </span>
            </button>

            {isOpen && (
              <div className="divide-y divide-slate-100 bg-white">
                {txs.map(tx => {
                  const isExpanded = expandedTx[tx.id];
                  const display = getTxDisplay(tx, txLabels);
                  return (
                    <div key={tx.id}>
                      <button
                        onClick={() => toggleTx(tx.id)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
                      >
                        <svg className={`h-3.5 w-3.5 text-slate-300 transition-transform shrink-0 ${isExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                        <span className={`text-xs font-bold w-16 shrink-0 ${display.isPositive ? 'text-emerald-600' : 'text-red-500'}`}>
                          {display.label}
                        </span>
                        <span className="flex-1 truncate text-sm text-slate-600">{tx.description}</span>
                        <span className={`font-mono text-sm font-semibold shrink-0 ${display.isPositive ? 'text-emerald-600' : 'text-red-500'}`}>
                          {display.isPositive ? '+' : tx.amountCents === 0 ? '-' : ''}${display.isPositive ? fmtUSD(tx.amountCents) : tx.amountCents === 0 ? '0.00' : fmtUSD(tx.amountCents)}
                        </span>
                      </button>
                      {isExpanded && (
                        <div className="bg-slate-50 px-4 py-3 ml-8 mr-4 mb-2 rounded-lg border border-slate-200 text-sm space-y-2">
                          <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                            <div>
                              <span className="text-xs text-gray-400">Type</span>
                              <div className={`font-medium ${display.isPositive ? 'text-gray-700' : 'text-red-600'}`}>{display.label}</div>
                            </div>
                            <div>
                              <span className="text-xs text-gray-400">Date & Time</span>
                              <div className="font-medium text-gray-700">{formatDateTimeBet(tx.createdAt)}</div>
                            </div>
                            <div>
                              <span className="text-xs text-gray-400">Amount</span>
                              <div className={`font-mono font-semibold ${display.isPositive ? 'text-emerald-600' : 'text-red-500'}`}>
                                {display.isPositive ? '+' : '-'}${fmtUSD(tx.amountCents)}
                              </div>
                            </div>
                            <div>
                              <span className="text-xs text-gray-400">Balance After</span>
                              <div className="font-mono font-semibold text-gray-700">${fmtUSD(tx.balanceAfterCents)}</div>
                            </div>
                          </div>
                          <div>
                            <span className="text-xs text-gray-400">Description</span>
                            <div className="text-gray-700">{tx.description}</div>
                          </div>
                          {tx.referenceId && (
                            <div>
                              <span className="text-xs text-gray-400">Reference</span>
                              <div className="font-mono text-xs text-gray-500">{tx.referenceId}</div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function PlayerDashboard() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [balanceCents, setBalanceCents] = useState(0);
  const [wagers, setWagers] = useState<Wager[]>([]);
  const [bets, setBets] = useState<EnrichedBet[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('wagers');
  const [betSelection, setBetSelection] = useState<BetSelection | null>(null);
  const [showDeposit, setShowDeposit] = useState(false);
  const [showAuth, setShowAuth] = useState<'login' | 'signup' | null>(null);

  // Auth form state
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authDisplayName, setAuthDisplayName] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [meRes, wagerRes] = await Promise.all([
        fetch('/api/auth/me'),
        fetch('/api/wagers?status=open&limit=50'),
      ]);
      const meData = await meRes.json();
      const wagerData = await wagerRes.json();
      setWagers(wagerData.wagers || []);

      if (meData.user) {
        setUser(meData.user);
        // Fetch user-specific data
        const [balRes, betRes, txRes] = await Promise.all([
          fetch('/api/payments/balance'),
          fetch('/api/bets?limit=200'),
          fetch('/api/payments/transactions?limit=200'),
        ]);
        const balData = await balRes.json();
        setBalanceCents(balData.balanceCents || 0);
        const betData = await betRes.json();
        setBets(betData.bets || []);
        const txData = await txRes.json();
        setTransactions(txData.transactions || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.reload();
  };

  const handleOutcomeClick = (wagerId: string, wagerTitle: string, outcomeLabel: string, odds: number) => {
    if (!user) {
      setShowAuth('login');
      return;
    }
    setBetSelection({ wagerId, wagerTitle, outcomeLabel, odds });
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authEmail, password: authPassword }),
      });
      const data = await res.json();
      if (!res.ok) { setAuthError(data.error || 'Login failed'); return; }
      window.location.reload();
    } catch {
      setAuthError('Network error. Please try again.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authEmail, password: authPassword, displayName: authDisplayName }),
      });
      const data = await res.json();
      if (!res.ok) { setAuthError(data.error || 'Registration failed'); return; }
      window.location.reload();
    } catch {
      setAuthError('Network error. Please try again.');
    } finally {
      setAuthLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-10 w-10 animate-spin rounded-full border-3 border-emerald-200 border-t-emerald-500" />
      </div>
    );
  }

  const pendingBets = bets.filter(b => b.status === 'pending');
  const totalWon = bets.filter(b => b.status === 'won').reduce((s, b) => s + (b.potentialPayoutCents - b.amountCents), 0);
  const totalLost = bets.filter(b => b.status === 'lost').reduce((s, b) => s + b.amountCents, 0);

  const TX_LABELS: Record<string, string> = {
    deposit: 'Deposit', bet_placed: 'Bet Placed', bet_won: 'Win', bet_lost: 'Loss',
    bet_refund: 'Refund', withdrawal: 'Withdraw', correction: 'Credit',
  };

  // --- Auth modal overlay ---
  const authModal = showAuth && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowAuth(null)}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">
            {showAuth === 'login' ? 'Log In' : 'Create Account'}
          </h2>
          <button onClick={() => setShowAuth(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        {/* Google OAuth */}
        <a
          href="/api/auth/google"
          className="mb-4 flex w-full items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Continue with Google
        </a>

        <div className="relative mb-4">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200" /></div>
          <div className="relative flex justify-center text-sm"><span className="bg-white px-2 text-gray-400">or</span></div>
        </div>

        <form onSubmit={showAuth === 'login' ? handleLogin : handleSignup} className="space-y-3">
          {authError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">{authError}</div>
          )}

          {showAuth === 'signup' && (
            <input
              type="text"
              value={authDisplayName}
              onChange={e => setAuthDisplayName(e.target.value)}
              required
              minLength={2}
              maxLength={50}
              placeholder="Display name"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-emerald-500"
            />
          )}
          <input
            type="email"
            value={authEmail}
            onChange={e => setAuthEmail(e.target.value)}
            required
            placeholder="Email"
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-emerald-500"
          />
          <input
            type="password"
            value={authPassword}
            onChange={e => setAuthPassword(e.target.value)}
            required
            minLength={showAuth === 'signup' ? 8 : undefined}
            placeholder={showAuth === 'signup' ? 'Password (8+ chars)' : 'Password'}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-emerald-500"
          />
          <button
            type="submit"
            disabled={authLoading}
            className="w-full rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-400 disabled:opacity-50"
          >
            {authLoading ? (showAuth === 'login' ? 'Logging in...' : 'Creating account...') : (showAuth === 'login' ? 'Log In' : 'Create Account')}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-gray-500">
          {showAuth === 'login' ? (
            <>Don't have an account?{' '}<button onClick={() => { setShowAuth('signup'); setAuthError(null); }} className="font-medium text-emerald-600 hover:underline">Sign up</button></>
          ) : (
            <>Already have an account?{' '}<button onClick={() => { setShowAuth('login'); setAuthError(null); }} className="font-medium text-emerald-600 hover:underline">Log in</button></>
          )}
        </p>
      </div>
    </div>
  );

  // --- GUEST VIEW (not logged in) ---
  if (!user) {
    return (
      <div className="space-y-0">
        {/* Guest header */}
        <div className="rounded-t-2xl bg-gradient-to-r from-slate-900 to-slate-800 px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">Bet the Forecast</h1>
              <p className="mt-1 text-sm text-slate-400">Wager on real weather outcomes. Sign in to place bets.</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowAuth('login')}
                className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-300 hover:text-white hover:border-slate-400 transition-colors"
              >
                Log In
              </button>
              <button
                onClick={() => setShowAuth('signup')}
                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-400 transition-colors"
              >
                Sign Up
              </button>
            </div>
          </div>
        </div>

        {/* Open wagers */}
        <div className="rounded-b-2xl border border-t-0 border-slate-200 bg-white p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Available Wagers</h2>
            <span className="text-sm text-slate-500">{wagers.length} open</span>
          </div>

          {wagers.length === 0 ? (
            <div className="rounded-xl bg-slate-50 px-6 py-14 text-center">
              <div className="text-4xl">&#x1F3B2;</div>
              <h3 className="mt-3 text-lg font-semibold text-slate-800">No wagers available</h3>
              <p className="mt-1 text-sm text-slate-500">Check back soon for weather wagers!</p>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {wagers.map(w => (
                <WagerCard key={w.id} wager={w} onOutcomeClick={handleOutcomeClick} />
              ))}
            </div>
          )}
        </div>

        {authModal}
      </div>
    );
  }

  // --- LOGGED-IN VIEW ---
  return (
    <div className="space-y-0">
      {/* Top bar: dark header with user info + balance */}
      <div className="rounded-t-2xl bg-gradient-to-r from-slate-900 to-slate-800 px-6 py-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="h-11 w-11 rounded-full ring-2 ring-emerald-400" referrerPolicy="no-referrer" />
            ) : (
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500 text-sm font-bold text-white ring-2 ring-emerald-300">
                {user.displayName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
              </div>
            )}
            <div>
              <div className="text-base font-semibold text-white">{user.displayName}</div>
              <div className="text-xs text-slate-400">{user.email} · Player #{user.playerNumber}</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider text-slate-400">Balance</div>
              <div className="font-mono text-2xl font-bold text-emerald-400">
                ${fmtUSD(balanceCents)}
              </div>
            </div>
            <button
              onClick={() => setShowDeposit(true)}
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-400 transition-colors"
            >
              Deposit
            </button>
            <button
              onClick={handleLogout}
              className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-400 hover:text-white hover:border-slate-400 transition-colors"
            >
              Log out
            </button>
          </div>
        </div>

        {/* Quick stats row */}
        <div className="mt-4 flex gap-6 border-t border-slate-700 pt-4">
          <div>
            <div className="text-xs text-slate-500 uppercase tracking-wider">Live Wagers</div>
            <div className="text-lg font-bold text-amber-400">{pendingBets.length}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 uppercase tracking-wider">Total Won</div>
            <div className="text-lg font-bold text-emerald-400">+${fmtUSD(totalWon)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 uppercase tracking-wider">Total Lost</div>
            <div className="text-lg font-bold text-red-400">-${fmtUSD(totalLost)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 uppercase tracking-wider">Record</div>
            <div className="text-lg font-bold text-white">
              {bets.filter(b => b.status === 'won').length}W - {bets.filter(b => b.status === 'lost').length}L
            </div>
          </div>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="flex border-b border-slate-200 bg-slate-50 px-2">
        {([
          { key: 'wagers' as Tab, label: 'Available Wagers', count: wagers.length },
          { key: 'live' as Tab, label: 'Live Wagers', count: bets.filter(b => b.status === 'pending').length },
          { key: 'previous' as Tab, label: 'Previous Wagers', count: bets.filter(b => b.status !== 'pending').length },
          { key: 'history' as Tab, label: 'Transactions', count: transactions.length },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`relative px-5 py-3 text-sm font-semibold transition-colors ${
              tab === t.key
                ? 'text-emerald-600'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            {t.label}
            <span className={`ml-1.5 text-xs ${tab === t.key ? 'text-emerald-500' : 'text-slate-400'}`}>
              ({t.count})
            </span>
            {tab === t.key && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="rounded-b-2xl border border-t-0 border-slate-200 bg-white p-6">
        {/* AVAILABLE WAGERS TAB */}
        {tab === 'wagers' && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Open Wagers</h2>
              <div className="text-sm text-slate-500">
                {wagers.length} wager{wagers.length !== 1 ? 's' : ''}
              </div>
            </div>

            {wagers.length === 0 ? (
              <div className="rounded-xl bg-slate-50 px-6 py-14 text-center">
                <div className="text-4xl">&#x1F3B2;</div>
                <h3 className="mt-3 text-lg font-semibold text-slate-800">No wagers available</h3>
                <p className="mt-1 text-sm text-slate-500">Check back soon for weather wagers!</p>
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {wagers.map(w => (
                  <WagerCard key={w.id} wager={w} user={user} onOutcomeClick={handleOutcomeClick} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* LIVE WAGERS TAB */}
        {tab === 'live' && (() => {
          const liveBets = bets.filter(b => b.status === 'pending');

          if (liveBets.length === 0) {
            return (
              <div className="rounded-xl bg-slate-50 px-6 py-14 text-center">
                <p className="text-sm text-slate-500">No live wagers. Place a bet on the Available Wagers tab!</p>
              </div>
            );
          }

          return (
            <div className="space-y-4">
              <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-amber-600">
                <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                Live ({liveBets.length})
              </h3>
              <div className="grid gap-3">
                {liveBets.map(bet => {
                  const style = BET_STATUS_STYLES[bet.status];
                  const w = bet.wager;
                  const profit = bet.potentialPayoutCents - bet.amountCents;
                  const pickName = getPickNameBet(bet);
                  const pickDesc = getPickDescriptionBet(bet);
                  return (
                    <div key={bet.id} className={`rounded-xl border ${style.border} ${style.bg} p-4 transition-shadow hover:shadow-md`}>
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="min-w-0 flex-1">
                          <h4 className="font-bold text-gray-900 text-base leading-tight">{w?.title || 'Wager'}</h4>
                          {w && (
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500">
                              <span className="inline-flex items-center gap-1">
                                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                {getLocationNameBet(w)}
                              </span>
                              <span className="text-gray-300">|</span>
                              <span>{METRIC_LABELS_BET[w.metric] || w.metric}</span>
                              <span className="text-gray-300">|</span>
                              <span>{formatDateBet(w.targetDate + 'T12:00:00')}</span>
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ring-amber-200 ${style.bg} ${style.text}`}>
                            {style.label}
                          </span>
                          <span className="font-mono text-[10px] text-gray-400">
                            #{bet.ticketNumber || bet.id.slice(-8).toUpperCase()}
                          </span>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="rounded-lg bg-white/70 border border-gray-200/60 p-3">
                          <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Your Pick</div>
                          <div className="flex items-baseline gap-2 mb-1">
                            <span className="text-lg font-bold text-gray-900">{pickName}</span>
                            <span className={`font-mono text-sm font-bold ${bet.odds > 0 ? 'text-emerald-600' : 'text-red-500'}`}>{formatOddsBet(bet.odds)}</span>
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
                              <span className="text-gray-400 text-xs">To Win</span>
                              <div className="font-mono font-semibold text-emerald-600">${fmtUSD(profit)}</div>
                            </div>
                            <div className="col-span-2 mt-1 pt-1 border-t border-gray-100">
                              <span className="text-gray-400 text-xs">Total Return</span>
                              <div className="font-mono font-bold text-emerald-600">${fmtUSD(bet.potentialPayoutCents)}</div>
                            </div>
                          </div>
                        </div>
                        {w && (
                          <div className="rounded-lg bg-white/70 border border-gray-200/60 p-3">
                            <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Wager Details</div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                                w.kind === 'over-under' ? 'bg-blue-100 text-blue-700' :
                                w.kind === 'odds' ? 'bg-purple-100 text-purple-700' :
                                'bg-orange-100 text-orange-700'
                              }`}>{KIND_LABELS[w.kind] || w.kind}</span>
                              {w.ticketNumber && (
                                <span className="font-mono text-[10px] text-gray-400">#{w.ticketNumber}</span>
                              )}
                            </div>
                            <div className="text-sm text-gray-600 leading-relaxed mt-1">{getWagerSpecsBet(w)}</div>
                            {w.description && (
                              <p className="text-xs text-gray-400 mt-2 italic">{w.description}</p>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="mt-3 text-xs text-gray-400">Placed {formatDateTimeBet(bet.createdAt)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* PREVIOUS WAGERS TAB */}
        {tab === 'previous' && <PreviousWagersTab bets={bets} />}

        {/* TRANSACTIONS TAB */}
        {tab === 'history' && (() => {
          if (transactions.length === 0) {
            return (
              <div className="rounded-xl bg-slate-50 px-6 py-14 text-center">
                <p className="text-sm text-slate-500">No transactions yet. Deposit to get started!</p>
              </div>
            );
          }

          // Group transactions by month
          const grouped: Record<string, Transaction[]> = {};
          for (const tx of transactions) {
            const d = new Date(tx.createdAt);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(tx);
          }
          const monthKeys = Object.keys(grouped).sort((a, b) => b.localeCompare(a));
          const currentMonthKey = (() => {
            const now = new Date();
            return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
          })();

          return <TransactionGroups grouped={grouped} monthKeys={monthKeys} currentMonthKey={currentMonthKey} txLabels={TX_LABELS} />;
        })()}
      </div>

      {/* Bet slip modal */}
      {betSelection && (
        <BetSlip
          wagerId={betSelection.wagerId}
          wagerTitle={betSelection.wagerTitle}
          outcomeLabel={betSelection.outcomeLabel}
          odds={betSelection.odds}
          onClose={() => setBetSelection(null)}
          onBetPlaced={() => { setBetSelection(null); fetchAll(); }}
        />
      )}

      {/* Deposit modal */}
      {showDeposit && (
        <DepositModal
          onClose={() => setShowDeposit(false)}
          onDeposited={() => { setShowDeposit(false); fetchAll(); }}
        />
      )}
    </div>
  );
}

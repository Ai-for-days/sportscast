import React, { useState, useEffect } from 'react';
import type { Wager, WagerStatus, OddsWager, OverUnderWager, PointspreadWager, PricingSnapshot } from '../../lib/wager-types';
import WagerFormModal from './WagerFormModal';
import type { PricingPrefill } from './WagerFormModal';
import ConfirmDialog from './ConfirmDialog';
import SystemNav from './SystemNav';

/** Format an ISO timestamp to Eastern US time: "M/D h:mm AM ET" */
function formatET(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }) + ' ET';
  } catch {
    return iso;
  }
}

const METRIC_UNITS: Record<string, string> = {
  actual_temp: '°F',
  high_temp: '°F',
  low_temp: '°F',
  actual_wind: 'mph',
  actual_gust: 'mph',
};

const STATUS_COLORS: Record<WagerStatus, string> = {
  open: 'bg-blue-100 text-blue-700',
  locked: 'bg-orange-100 text-orange-700',
  graded: 'bg-sky-100 text-sky-700',
  void: 'bg-gray-100 text-gray-500',
};

interface ExposureInfo {
  totalBets: number;
  totalStakedCents: number;
  maxLiabilityCents: number;
}

interface BetDetail {
  id: string;
  userId: string;
  userEmail: string;
  userDisplayName: string;
  outcomeLabel: string;
  odds: number;
  amountCents: number;
  potentialPayoutCents: number;
  status: string;
  createdAt: string;
}

interface BetDetailData {
  bets: BetDetail[];
  exposure: {
    totalBets: number;
    totalStakedCents: number;
    maxLiabilityCents: number;
    byOutcome: Record<string, { betCount: number; stakedCents: number; maxPayoutCents: number }>;
  };
}

function getOutcomeOptions(wager: Wager): string[] {
  if (wager.kind === 'odds') {
    return (wager as OddsWager).outcomes.map(o => o.label);
  }
  if (wager.kind === 'over-under') {
    return ['over', 'under'];
  }
  if (wager.kind === 'pointspread') {
    const ps = wager as PointspreadWager;
    return [`locationA (${ps.locationA.name})`, `locationB (${ps.locationB.name})`];
  }
  return [];
}

interface PlayerInfo {
  id: string;
  email: string;
  displayName: string;
  googleId?: string;
  hasPassword: boolean;
  avatarUrl?: string;
  createdAt: string;
  emailVerified: boolean;
  frozen?: boolean;
  balanceCents: number;
  betCount: number;
}

interface PlayerBet {
  id: string;
  wagerId: string;
  outcomeLabel: string;
  odds: number;
  amountCents: number;
  potentialPayoutCents: number;
  status: string;
  createdAt: string;
}

interface PlayerTransaction {
  id: string;
  type: string;
  amountCents: number;
  balanceAfterCents: number;
  description: string;
  createdAt: string;
}

interface PlayerDetailData {
  user: PlayerInfo;
  balanceCents: number;
  bets: PlayerBet[];
  transactions: PlayerTransaction[];
}

function getOutcomeValue(display: string): string {
  // Strip display names back to raw values for pointspread
  if (display.startsWith('locationA')) return 'locationA';
  if (display.startsWith('locationB')) return 'locationB';
  return display;
}

type WagerFilter = 'all' | 'needs_grading' | 'open' | 'locked' | 'graded' | 'void';

const METRIC_LABELS: Record<string, string> = {
  actual_temp: 'Temp at Time (°F)',
  high_temp: 'High Temp (°F)',
  low_temp: 'Low Temp (°F)',
  actual_wind: 'Wind (mph)',
  actual_gust: 'Gusts (mph)',
};

function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

/** Format cents as USD with commas */
function fmtUSD(cents: number): string {
  return (Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getWagerSummary(w: Wager): string {
  const metric = METRIC_LABELS[w.metric] || w.metric;
  if (w.kind === 'over-under') {
    const ou = w as OverUnderWager;
    return `${ou.location.name} · ${metric} · O/U ${ou.line} (Over ${formatOdds(ou.over.odds)} / Under ${formatOdds(ou.under.odds)})`;
  }
  if (w.kind === 'odds') {
    const ow = w as OddsWager;
    const ranges = ow.outcomes.map(o => `${o.label} ${formatOdds(o.odds)}`).join(', ');
    return `${ow.location.name} · ${metric} · ${ranges}`;
  }
  if (w.kind === 'pointspread') {
    const ps = w as PointspreadWager;
    return `${ps.locationA.name} vs ${ps.locationB.name} · ${metric} · Spread ${ps.spread > 0 ? '+' : ''}${ps.spread} (${ps.locationA.name} ${formatOdds(ps.locationAOdds)} / ${ps.locationB.name} ${formatOdds(ps.locationBOdds)})`;
  }
  return '';
}

function isExpired(w: Wager): boolean {
  return new Date(w.lockTime).getTime() <= Date.now();
}

function needsGrading(w: Wager): boolean {
  return (w.status === 'open' || w.status === 'locked') && isExpired(w);
}

function autoDetectOutcome(wager: Wager, observedValue: number): string | null {
  if (wager.kind === 'over-under') {
    const ou = wager as OverUnderWager;
    if (observedValue > ou.line) return 'over';
    if (observedValue < ou.line) return 'under';
    return 'push';
  }
  if (wager.kind === 'odds') {
    const ow = wager as OddsWager;
    for (const o of ow.outcomes) {
      if (observedValue >= o.minValue && observedValue <= o.maxValue) return o.label;
    }
    return null;
  }
  return null;
}

export default function AdminDashboard() {
  const [wagers, setWagers] = useState<Wager[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editWager, setEditWager] = useState<Wager | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Wager | null>(null);
  const [voidTarget, setVoidTarget] = useState<Wager | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [exposures, setExposures] = useState<Record<string, ExposureInfo>>({});
  const [filter, setFilter] = useState<WagerFilter>('all');

  // Bankroll state
  const [bankrollCents, setBankrollCents] = useState<number | null>(null);

  // Bet detail panel state
  const [detailWager, setDetailWager] = useState<Wager | null>(null);
  const [detailData, setDetailData] = useState<BetDetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Auto-grade state
  const [autoGrading, setAutoGrading] = useState(false);
  const [autoGradeMsg, setAutoGradeMsg] = useState<string | null>(null);

  // Manual grading state
  const [gradeTarget, setGradeTarget] = useState<Wager | null>(null);
  const [gradeOutcome, setGradeOutcome] = useState('');
  const [gradeObserved, setGradeObserved] = useState('');
  const [gradeLoading, setGradeLoading] = useState(false);
  const [gradeMsg, setGradeMsg] = useState<string | null>(null);

  // Credit balance state
  const [creditEmail, setCreditEmail] = useState('');
  const [creditAmount, setCreditAmount] = useState('100');
  const [creditMsg, setCreditMsg] = useState<string | null>(null);
  const [creditLoading, setCreditLoading] = useState(false);

  // Reset bets state
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  // Bulk delete state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  // Pricing Lab prefill state
  const [pricingPrefill, setPricingPrefill] = useState<PricingPrefill | null>(null);

  // Hedging risk badges
  const [hedgingMap, setHedgingMap] = useState<Record<string, { riskLevel: string; action: string }>>({});

  // View mode: list or grouped by wager kind
  const [viewMode, setViewMode] = useState<'list' | 'grouped'>('list');

  // Player management state
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [playersLoading, setPlayersLoading] = useState(false);
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null);
  const [playerDetail, setPlayerDetail] = useState<PlayerDetailData | null>(null);
  const [playerDetailLoading, setPlayerDetailLoading] = useState(false);
  const [confirmDeletePlayer, setConfirmDeletePlayer] = useState<PlayerInfo | null>(null);

  // Redirect to login on 401
  const checkAuth = (res: Response) => {
    if (res.status === 401) {
      window.location.href = '/admin';
      return false;
    }
    return true;
  };

  const fetchBankroll = async () => {
    try {
      const res = await fetch('/api/admin/bankroll');
      if (!checkAuth(res)) return;
      if (res.ok) {
        const data = await res.json();
        setBankrollCents(data.bankrollCents);
      }
    } catch { /* ignore */ }
  };

  const fetchWagers = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/wagers');
      if (!checkAuth(res)) return;
      if (res.ok) {
        const data = await res.json();
        const wagerList: Wager[] = data.wagers || [];
        setWagers(wagerList);

        // Fetch exposure for all wagers
        const exposureMap: Record<string, ExposureInfo> = {};
        await Promise.all(
          wagerList.map(async (w) => {
            try {
              const res = await fetch(`/api/admin/bets?wagerId=${w.id}`);
              if (res.ok) {
                const data = await res.json();
                exposureMap[w.id] = {
                  totalBets: data.exposure?.totalBets || 0,
                  totalStakedCents: data.exposure?.totalStakedCents || 0,
                  maxLiabilityCents: data.exposure?.maxLiabilityCents || 0,
                };
              }
            } catch { /* ignore */ }
          })
        );
        setExposures(exposureMap);

        // Fetch hedging recommendations for risk badges
        try {
          const hedgeRes = await fetch('/api/admin/hedging/recommendations');
          if (hedgeRes.ok) {
            const hd = await hedgeRes.json();
            const hMap: Record<string, { riskLevel: string; action: string }> = {};
            for (const r of (hd.recommendations || [])) {
              hMap[r.wagerId] = { riskLevel: r.riskLevel, action: r.recommendedAction };
            }
            setHedgingMap(hMap);
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  const fetchPlayers = async () => {
    setPlayersLoading(true);
    try {
      const res = await fetch('/api/admin/users');
      if (!checkAuth(res)) return;
      if (res.ok) {
        const data = await res.json();
        setPlayers(data.users || []);
      }
    } catch { /* ignore */ }
    setPlayersLoading(false);
  };

  const fetchPlayerDetail = async (userId: string) => {
    if (expandedPlayer === userId) {
      setExpandedPlayer(null);
      setPlayerDetail(null);
      return;
    }
    setExpandedPlayer(userId);
    setPlayerDetail(null);
    setPlayerDetailLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}`);
      if (!checkAuth(res)) return;
      if (res.ok) {
        const data = await res.json();
        setPlayerDetail(data);
      }
    } catch { /* ignore */ }
    setPlayerDetailLoading(false);
  };

  useEffect(() => {
    fetchWagers();
    fetchBankroll();
    fetchPlayers();

    // Check for Pricing Lab prefill params
    const params = new URLSearchParams(window.location.search);
    const prefillKind = params.get('prefillKind');
    if (prefillKind) {
      const pp: PricingPrefill = {
        kind: prefillKind as any,
        metric: params.get('prefillMetric') || undefined,
        targetDate: params.get('prefillDate') || undefined,
        targetTime: params.get('prefillTime') || undefined,
        locationName: params.get('prefillLocation') || undefined,
        locationAName: params.get('prefillLocationA') || undefined,
        locationBName: params.get('prefillLocationB') || undefined,
        line: params.has('prefillLine') ? Number(params.get('prefillLine')) : undefined,
        overOdds: params.has('prefillOverOdds') ? Number(params.get('prefillOverOdds')) : undefined,
        underOdds: params.has('prefillUnderOdds') ? Number(params.get('prefillUnderOdds')) : undefined,
        spread: params.has('prefillSpread') ? Number(params.get('prefillSpread')) : undefined,
        locationAOdds: params.has('prefillLocationAOdds') ? Number(params.get('prefillLocationAOdds')) : undefined,
        locationBOdds: params.has('prefillLocationBOdds') ? Number(params.get('prefillLocationBOdds')) : undefined,
      };
      try {
        const bandsJson = params.get('prefillBandsJson');
        if (bandsJson) pp.bands = JSON.parse(bandsJson);
        const modelJson = params.get('prefillModelJson');
        if (modelJson) pp.modelJson = JSON.parse(modelJson);
      } catch { /* ignore parse errors */ }
      setPricingPrefill(pp);
      setEditWager(null);
      setShowForm(true);
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const [detailError, setDetailError] = useState<string | null>(null);

  const openBetDetail = async (wager: Wager) => {
    setDetailWager(wager);
    setDetailData(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/admin/bets?wagerId=${wager.id}`);
      if (!checkAuth(res)) return;
      if (res.ok) {
        const data = await res.json();
        setDetailData(data);
      } else {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        setDetailError(err.error || `Error ${res.status}`);
      }
    } catch (err: any) {
      setDetailError(err.message || 'Network error');
    } finally {
      setDetailLoading(false);
    }
  };

  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/wagers/${confirmDelete.id}`, { method: 'DELETE' });
      if (!checkAuth(res)) return;
      if (!res.ok) {
        const data = await res.json();
        setDeleteError(data.error || 'Failed to delete wager');
        return;
      }
      setConfirmDelete(null);
      fetchWagers();
    } catch {
      setDeleteError('Network error — could not delete wager');
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === wagers.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(wagers.map(w => w.id)));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setBulkDeleting(true);
    try {
      const res = await fetch('/api/admin/wagers/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      if (!checkAuth(res)) return;
      if (res.ok) {
        setSelectedIds(new Set());
        setConfirmBulkDelete(false);
        fetchWagers();
      }
    } catch { /* ignore */ }
    setBulkDeleting(false);
  };

  const handleVoid = async () => {
    if (!voidTarget || !voidReason.trim()) return;
    await fetch(`/api/admin/wagers/${voidTarget.id}/void`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: voidReason }),
    });
    setVoidTarget(null);
    setVoidReason('');
    fetchWagers();
    fetchBankroll();
  };

  const handleGrade = async () => {
    if (!gradeTarget || !gradeOutcome || gradeObserved === '') return;
    setGradeLoading(true);
    setGradeMsg(null);
    try {
      const res = await fetch(`/api/admin/wagers/${gradeTarget.id}/grade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          observedValue: parseFloat(gradeObserved),
          winningOutcome: getOutcomeValue(gradeOutcome),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        const s = data.settlement;
        setGradeMsg(`Graded! ${s.won} won, ${s.lost} lost, ${s.pushed} pushed`);
        fetchWagers();
        fetchBankroll();
        setTimeout(() => {
          setGradeTarget(null);
          setGradeMsg(null);
        }, 2000);
      } else {
        setGradeMsg(`Error: ${data.error}`);
      }
    } catch {
      setGradeMsg('Network error');
    }
    setGradeLoading(false);
  };

  const handleResetBets = async () => {
    setResetLoading(true);
    setResetMsg(null);
    try {
      const res = await fetch('/api/admin/reset-bets', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setResetMsg(`Reset complete: ${data.keysDeleted} keys deleted. ${data.playersReset} players reset to $${(data.playerBalanceCents / 100).toLocaleString()}. Bankroll: $${(data.bankrollCents / 100).toLocaleString()}`);
        fetchWagers();
        fetchBankroll();
      } else {
        setResetMsg(`Error: ${data.error}`);
      }
    } catch {
      setResetMsg('Network error');
    }
    setResetLoading(false);
    setConfirmReset(false);
  };

  const handleObservedChange = (val: string) => {
    setGradeObserved(val);
    if (gradeTarget && val !== '') {
      const detected = autoDetectOutcome(gradeTarget, parseFloat(val));
      if (detected) setGradeOutcome(detected);
    }
  };

  const handleAutoGrade = async () => {
    setAutoGrading(true);
    setAutoGradeMsg(null);
    try {
      const res = await fetch('/api/admin/wagers/auto-grade', { method: 'POST' });
      if (!checkAuth(res)) return;
      let data: any;
      try {
        data = await res.json();
      } catch {
        setAutoGradeMsg('Error: Server returned invalid response');
        return;
      }
      if (res.ok) {
        const parts: string[] = [];
        const graded = data.graded || [];
        const settled = data.settled || 0;
        const skipped = data.skipped || 0;
        const locked = data.locked || 0;
        const errors = data.errors || [];
        if (locked > 0) parts.push(`Locked ${locked} expired wager${locked > 1 ? 's' : ''}`);
        if (graded.length > 0) {
          parts.push(`Graded ${graded.length} wager${graded.length > 1 ? 's' : ''}`);
          for (const g of graded) {
            parts.push(`  "${g.title}": observed ${g.observedValue}, winner: ${g.winningOutcome} (${g.settlement.won}W/${g.settlement.lost}L/${g.settlement.pushed}P)`);
          }
        }
        if (settled > 0) parts.push(`Re-settled ${settled} pending bet${settled > 1 ? 's' : ''} on previously graded wagers`);
        if (skipped > 0) parts.push(`Skipped ${skipped} (NWS data not yet available — try again after midnight ET + 15 min)`);
        if (errors.length > 0) parts.push(`Errors: ${errors.join(', ')}`);
        setAutoGradeMsg(parts.length > 0 ? parts.join('\n') : 'No wagers needed grading.');
        // Always refresh — locking changes status even without grading
        fetchWagers();
        fetchBankroll();
      } else {
        setAutoGradeMsg(`Error: ${data.error || res.statusText}`);
      }
    } catch (err: any) {
      setAutoGradeMsg(`Error: ${err.message || 'Network error'}`);
    } finally {
      setAutoGrading(false);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    window.location.href = '/admin';
  };

  const handleAdjustBalance = async (sign: 1 | -1) => {
    if (!creditEmail.trim() || !creditAmount) return;
    setCreditLoading(true);
    setCreditMsg(null);
    const cents = Math.round(parseFloat(creditAmount) * 100) * sign;
    try {
      const res = await fetch('/api/admin/credit-balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: creditEmail.trim(), amountCents: cents }),
      });
      const data = await res.json();
      if (res.ok) {
        const verb = sign > 0 ? 'Added' : 'Subtracted';
        setCreditMsg(`${verb} $${creditAmount} ${sign > 0 ? 'to' : 'from'} ${data.email}. New balance: $${fmtUSD(data.newBalanceCents)}`);
        setCreditEmail('');
        setCreditAmount('100');
        if (players.length > 0) fetchPlayers();
      } else {
        setCreditMsg(`Error: ${data.error}`);
      }
    } catch {
      setCreditMsg('Network error');
    }
    setCreditLoading(false);
  };

  const handleFreezePlayer = async (player: PlayerInfo) => {
    const newFrozen = !player.frozen;
    try {
      const res = await fetch(`/api/admin/users/${player.id}/freeze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frozen: newFrozen }),
      });
      if (!checkAuth(res)) return;
      if (res.ok) {
        setPlayers(prev => prev.map(p => p.id === player.id ? { ...p, frozen: newFrozen } : p));
      }
    } catch { /* ignore */ }
  };

  const handleDeletePlayer = async () => {
    if (!confirmDeletePlayer) return;
    try {
      const res = await fetch(`/api/admin/users/${confirmDeletePlayer.id}/delete`, { method: 'DELETE' });
      if (!checkAuth(res)) return;
      if (res.ok) {
        setPlayers(prev => prev.filter(p => p.id !== confirmDeletePlayer.id));
        setConfirmDeletePlayer(null);
        if (expandedPlayer === confirmDeletePlayer.id) {
          setExpandedPlayer(null);
          setPlayerDetail(null);
        }
      }
    } catch { /* ignore */ }
  };

  return (
    <div className="space-y-6">
      <SystemNav />
      {/* Admin nav tabs */}
      <div className="flex items-center justify-between">
        <nav className="flex gap-1 rounded-lg bg-gray-100 p-1">
          <a
            href="/admin/wagers"
            className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm"
          >
            Wagers
          </a>
          <a
            href="/admin/forecasts"
            className="rounded-md px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-900"
          >
            Forecasts
          </a>
        </nav>
        <div className="flex gap-3">
          {selectedIds.size > 0 && (
            <button
              onClick={() => setConfirmBulkDelete(true)}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
            >
              Delete Selected ({selectedIds.size})
            </button>
          )}
          <button
            onClick={() => { setEditWager(null); setShowForm(true); }}
            className="rounded-lg bg-field px-4 py-2 text-sm font-semibold text-white hover:bg-field-light"
          >
            + Create Wager
          </button>
          <button
            onClick={handleLogout}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-500 hover:bg-gray-50"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Bookmaker Bankroll Card */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Bookmaker Bankroll</h3>
            <div className="mt-1 text-3xl font-bold text-gray-900">
              {bankrollCents !== null ? `$${(bankrollCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '...'}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAutoGrade}
              disabled={autoGrading}
              className="rounded-lg bg-green-600 px-3 py-2 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
            >
              {autoGrading ? 'Fetching NWS...' : 'Auto-Grade from NWS'}
            </button>
            <button
              onClick={() => setConfirmReset(true)}
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-100"
            >
              Reset Everything
            </button>
          </div>
        </div>
        {resetMsg && (
          <p className={`mt-2 text-xs ${resetMsg.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>
            {resetMsg}
          </p>
        )}
      </div>

      {/* Auto-grade results */}
      {autoGradeMsg && (
        <div className={`rounded-xl border p-4 text-sm whitespace-pre-line ${
          autoGradeMsg.startsWith('Error') ? 'border-red-200 bg-red-50 text-red-700' : 'border-green-200 bg-green-50 text-green-700'
        }`}>
          <div className="flex items-start justify-between">
            <div>{autoGradeMsg}</div>
            <button onClick={() => setAutoGradeMsg(null)} className="ml-3 text-xs opacity-60 hover:opacity-100">dismiss</button>
          </div>
        </div>
      )}

      {/* Wager status filter tabs */}
      {(() => {
        const needsGradingCount = wagers.filter(needsGrading).length;
        const filters: { key: WagerFilter; label: string; count?: number }[] = [
          { key: 'all', label: 'All', count: wagers.length },
          { key: 'needs_grading', label: 'Needs Grading', count: needsGradingCount },
          { key: 'open', label: 'Open', count: wagers.filter(w => w.status === 'open' && !isExpired(w)).length },
          { key: 'locked', label: 'Locked', count: wagers.filter(w => w.status === 'locked' && !isExpired(w)).length },
          { key: 'graded', label: 'Graded', count: wagers.filter(w => w.status === 'graded').length },
          { key: 'void', label: 'Void', count: wagers.filter(w => w.status === 'void').length },
        ];
        return (
          <div className="flex flex-wrap gap-2">
            {filters.map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  filter === f.key
                    ? f.key === 'needs_grading' && (f.count || 0) > 0
                      ? 'bg-red-600 text-white'
                      : 'bg-gray-900 text-white'
                    : f.key === 'needs_grading' && (f.count || 0) > 0
                    ? 'bg-red-100 text-red-700 hover:bg-red-200'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {f.label} {f.count != null && <span className="ml-1 opacity-70">({f.count})</span>}
              </button>
            ))}
          </div>
        );
      })()}

      {/* View mode toggle */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-gray-500">View:</span>
        {(['list', 'grouped'] as const).map(m => (
          <button
            key={m}
            onClick={() => setViewMode(m)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              viewMode === m ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {m === 'list' ? 'List' : 'Grouped'}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-field/20 border-t-field" />
        </div>
      )}

      {/* Wager table */}
      {!loading && (() => {
        const filtered = wagers.filter(w => {
          if (filter === 'all') return true;
          if (filter === 'needs_grading') return needsGrading(w);
          if (filter === 'open') return w.status === 'open' && !isExpired(w);
          if (filter === 'locked') return w.status === 'locked' && !isExpired(w);
          return w.status === filter;
        });

        // Sort: needs grading first (by date asc), then by date desc
        const sorted = [...filtered].sort((a, b) => {
          const aNg = needsGrading(a) ? 0 : 1;
          const bNg = needsGrading(b) ? 0 : 1;
          if (aNg !== bNg) return aNg - bNg;
          return new Date(b.targetDate).getTime() - new Date(a.targetDate).getTime();
        });

        // Build row order — in grouped mode, insert group header rows
        const KIND_LABELS: Record<string, string> = { 'over-under': 'Over/Under', odds: 'Odds', pointspread: 'Pointspread' };
        type RowItem = { type: 'header'; label: string; count: number } | { type: 'wager'; wager: Wager };
        let rows: RowItem[];
        if (viewMode === 'grouped') {
          const groups: Record<string, Wager[]> = {};
          for (const w of sorted) {
            (groups[w.kind] ??= []).push(w);
          }
          rows = [];
          for (const kind of ['over-under', 'odds', 'pointspread'] as const) {
            const g = groups[kind];
            if (g && g.length > 0) {
              rows.push({ type: 'header', label: KIND_LABELS[kind] || kind, count: g.length });
              for (const w of g) rows.push({ type: 'wager', wager: w });
            }
          }
        } else {
          rows = sorted.map(w => ({ type: 'wager' as const, wager: w }));
        }

        if (sorted.length === 0) {
          return (
            <div className="rounded-xl border border-gray-200 bg-white px-6 py-12 text-center text-gray-500">
              {filter === 'all' ? 'No wagers yet. Create your first one!' : `No ${filter.replace('_', ' ')} wagers.`}
            </div>
          );
        }

        // Select-all bar
        const selectBar = (
          <div className="flex items-center gap-3 rounded-lg bg-gray-50 border border-gray-200 px-4 py-2 mb-3">
            <label className="flex items-center gap-2 text-xs font-medium text-gray-500 cursor-pointer">
              <input
                type="checkbox"
                checked={sorted.length > 0 && selectedIds.size === sorted.length}
                onChange={toggleSelectAll}
                className="h-4 w-4 rounded border-gray-300"
              />
              Select all ({sorted.length})
            </label>
          </div>
        );

        return (
          <div>
            {selectBar}
            <div className="space-y-3">
              {rows.map((row, ri) => {
                if (row.type === 'header') {
                  return (
                    <div key={`hdr-${row.label}`} className="flex items-center gap-2 pt-3 pb-1">
                      <span className="text-xs font-bold uppercase tracking-wider text-gray-500">{row.label}</span>
                      <span className="text-xs text-gray-400">({row.count})</span>
                      <div className="flex-1 border-t border-gray-200 ml-2" />
                    </div>
                  );
                }
                const w = row.wager;
                const exp = exposures[w.id];
                const ng = needsGrading(w);
                const kindLabel = KIND_LABELS[w.kind] || w.kind;
                const locationName = w.kind === 'pointspread'
                  ? `${(w as PointspreadWager).locationA.name} vs ${(w as PointspreadWager).locationB.name}`
                  : (w as OddsWager | OverUnderWager).location.name;

                return (
                  <div
                    key={w.id}
                    className={`rounded-xl border p-4 transition-shadow hover:shadow-md ${
                      ng ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white'
                    }`}
                  >
                    {/* Top row: checkbox + title + kind + status */}
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(w.id)}
                        onChange={() => toggleSelect(w.id)}
                        className="mt-1 h-4 w-4 shrink-0 rounded border-gray-300"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            onClick={() => openBetDetail(w)}
                            className="text-base font-bold text-gray-900 hover:text-blue-600 text-left truncate"
                          >
                            {w.title}
                          </button>
                          <span className={`shrink-0 inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                            w.kind === 'over-under' ? 'bg-blue-100 text-blue-700' :
                            w.kind === 'odds' ? 'bg-purple-100 text-purple-700' :
                            'bg-orange-100 text-orange-700'
                          }`}>{kindLabel}</span>
                          {ng ? (
                            <span className="shrink-0 inline-flex rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-700 animate-pulse">
                              GRADE NOW
                            </span>
                          ) : (
                            <span className={`shrink-0 inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLORS[w.status]}`}>
                              {w.status}
                            </span>
                          )}
                          {hedgingMap[w.id] && hedgingMap[w.id].riskLevel !== 'low' && (
                            <span className={`shrink-0 inline-flex rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                              hedgingMap[w.id].riskLevel === 'critical' ? 'bg-red-100 text-red-700' :
                              hedgingMap[w.id].riskLevel === 'high' ? 'bg-orange-100 text-orange-700' :
                              'bg-yellow-100 text-yellow-700'
                            }`} title={hedgingMap[w.id].action.replace('_', ' ')}>
                              {hedgingMap[w.id].riskLevel}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500">
                          <span className="inline-flex items-center gap-1">
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                            {locationName}
                          </span>
                          <span>{METRIC_LABELS[w.metric] || w.metric}</span>
                          <span>{w.targetDate}{w.targetTime ? ` at ${w.targetTime}` : ''}</span>
                          <span className="text-gray-400">Created {formatET(w.createdAt)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Wager specs */}
                    <div className="mt-3 rounded-lg bg-gray-50 border border-gray-100 p-3">
                      {w.kind === 'over-under' && (() => {
                        const ou = w as OverUnderWager;
                        return (
                          <div className="flex items-center gap-6">
                            <div>
                              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Line</span>
                              <div className="font-mono text-xl font-bold text-gray-900">{ou.line}</div>
                            </div>
                            <div className="flex gap-3">
                              <div className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-center">
                                <div className="text-[10px] font-bold uppercase text-gray-400">Over</div>
                                <div className={`font-mono text-base font-bold ${ou.over.odds > 0 ? 'text-green-600' : 'text-red-600'}`}>{formatOdds(ou.over.odds)}</div>
                              </div>
                              <div className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-center">
                                <div className="text-[10px] font-bold uppercase text-gray-400">Under</div>
                                <div className={`font-mono text-base font-bold ${ou.under.odds > 0 ? 'text-green-600' : 'text-red-600'}`}>{formatOdds(ou.under.odds)}</div>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                      {w.kind === 'odds' && (() => {
                        const ow = w as OddsWager;
                        return (
                          <div className="flex flex-wrap gap-2">
                            {ow.outcomes.map((o, i) => (
                              <div key={i} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-center">
                                <div className="text-[10px] font-medium text-gray-500">{o.label}</div>
                                <div className={`font-mono text-base font-bold ${o.odds > 0 ? 'text-green-600' : 'text-red-600'}`}>{formatOdds(o.odds)}</div>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                      {w.kind === 'pointspread' && (() => {
                        const ps = w as PointspreadWager;
                        const spreadLabel = ps.spread === 0 ? 'Even' : ps.spread > 0 ? `+${ps.spread}` : `${ps.spread}`;
                        return (
                          <div className="flex gap-3">
                            <div className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-center">
                              <div className="text-[10px] font-medium text-gray-500 truncate max-w-[140px]">{ps.locationA.name}</div>
                              <div className={`font-mono text-base font-bold ${ps.locationAOdds > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {formatOdds(ps.locationAOdds)} <span className="text-gray-500 text-sm">({spreadLabel})</span>
                              </div>
                              {ps.observedValueA != null && <div className="text-xs text-gray-500 mt-0.5">Actual: {Math.round(ps.observedValueA)}</div>}
                            </div>
                            <div className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-center">
                              <div className="text-[10px] font-medium text-gray-500 truncate max-w-[140px]">{ps.locationB.name}</div>
                              <div className={`font-mono text-base font-bold ${ps.locationBOdds > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {formatOdds(ps.locationBOdds)} <span className="text-gray-500 text-sm">({ps.spread === 0 ? 'Even' : ps.spread > 0 ? `${-ps.spread}` : `+${-ps.spread}`})</span>
                              </div>
                              {ps.observedValueB != null && <div className="text-xs text-gray-500 mt-0.5">Actual: {Math.round(ps.observedValueB)}</div>}
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Pricing snapshot (compact) */}
                    {(w as any).pricingSnapshot && (() => {
                      const ps = (w as any).pricingSnapshot as PricingSnapshot;
                      if (ps.overUnder) {
                        return (
                          <div className="mt-2 rounded border border-blue-100 bg-blue-50/50 px-3 py-1.5 text-xs text-gray-600">
                            <span className="font-semibold text-blue-700">Model:</span>{' '}
                            {ps.overUnder.suggestedLine} / O {formatOdds(ps.overUnder.suggestedOverOdds)} U {formatOdds(ps.overUnder.suggestedUnderOdds)}
                            {' · '}
                            <span className="font-semibold text-gray-700">Posted:</span>{' '}
                            {ps.overUnder.postedLine} / O {formatOdds(ps.overUnder.postedOverOdds)} U {formatOdds(ps.overUnder.postedUnderOdds)}
                          </div>
                        );
                      }
                      if (ps.pointspread) {
                        const locAName = (w as PointspreadWager).locationA?.name?.split(',')[0] || 'A';
                        return (
                          <div className="mt-2 rounded border border-blue-100 bg-blue-50/50 px-3 py-1.5 text-xs text-gray-600">
                            <span className="font-semibold text-blue-700">Model:</span>{' '}
                            {locAName} {ps.pointspread.suggestedSpread >= 0 ? '-' : '+'}{Math.abs(ps.pointspread.suggestedSpread)} ({formatOdds(ps.pointspread.suggestedLocationAOdds)} / {formatOdds(ps.pointspread.suggestedLocationBOdds)})
                            {' · '}
                            <span className="font-semibold text-gray-700">Posted:</span>{' '}
                            {locAName} {ps.pointspread.postedSpread >= 0 ? '-' : '+'}{Math.abs(ps.pointspread.postedSpread)} ({formatOdds(ps.pointspread.postedLocationAOdds)} / {formatOdds(ps.pointspread.postedLocationBOdds)})
                          </div>
                        );
                      }
                      if (ps.rangeOdds) {
                        return (
                          <div className="mt-2 rounded border border-blue-100 bg-blue-50/50 px-3 py-1.5 text-xs text-gray-600">
                            <span className="font-semibold text-blue-700">Model snapshot saved</span> ({ps.rangeOdds.bands.length} bands)
                          </div>
                        );
                      }
                      return null;
                    })()}

                    {/* Line movement / snapshot summary */}
                    {((w as any).lineHistory?.length > 0 || (w as any).openingLineSnapshot || (w as any).closingLineSnapshot) && (
                      <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-500">
                        {(w as any).lineHistory?.length > 0 && (
                          <span className="inline-flex items-center gap-1 rounded bg-amber-50 border border-amber-100 px-2 py-0.5">
                            <span className="font-semibold text-amber-700">{(w as any).lineHistory.length}</span> line move{(w as any).lineHistory.length !== 1 ? 's' : ''}
                          </span>
                        )}
                        {(w as any).openingLineSnapshot && (
                          <span className="inline-flex items-center gap-1 rounded bg-blue-50 border border-blue-100 px-2 py-0.5">
                            <span className="font-semibold text-blue-600">Opening:</span>
                            {(w as any).openingLineSnapshot.overUnder ? `Line ${(w as any).openingLineSnapshot.overUnder.line}` :
                             (w as any).openingLineSnapshot.pointspread ? `Spread ${(w as any).openingLineSnapshot.pointspread.spread}` :
                             (w as any).openingLineSnapshot.rangeOdds ? `${(w as any).openingLineSnapshot.rangeOdds.bands.length} bands` : '—'}
                          </span>
                        )}
                        {(w as any).closingLineSnapshot && (
                          <span className="inline-flex items-center gap-1 rounded bg-purple-50 border border-purple-100 px-2 py-0.5">
                            <span className="font-semibold text-purple-600">Closing:</span>
                            {(w as any).closingLineSnapshot.overUnder ? `Line ${(w as any).closingLineSnapshot.overUnder.line}` :
                             (w as any).closingLineSnapshot.pointspread ? `Spread ${(w as any).closingLineSnapshot.pointspread.spread}` :
                             (w as any).closingLineSnapshot.rangeOdds ? `${(w as any).closingLineSnapshot.rangeOdds.bands.length} bands` : '—'}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Exposure metrics + result + actions */}
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-4 text-sm">
                        <div>
                          <span className="text-xs text-gray-400">Bets</span>
                          <div className="font-mono font-bold text-gray-900">{exp ? exp.totalBets : 0}</div>
                        </div>
                        <div>
                          <span className="text-xs text-gray-400">Staked</span>
                          <div className="font-mono font-bold text-green-600">{exp ? `$${fmtUSD(exp.totalStakedCents)}` : '$0.00'}</div>
                        </div>
                        <div>
                          <span className="text-xs text-gray-400">Liability</span>
                          <div className={`font-mono font-bold ${exp && exp.maxLiabilityCents > 50000 ? 'text-red-600' : 'text-orange-500'}`}>
                            {exp ? `$${fmtUSD(exp.maxLiabilityCents)}` : '$0.00'}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openBetDetail(w)}
                          className="rounded-md bg-gray-100 px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-200"
                        >
                          View Bets
                        </button>
                        {(w.status === 'open' || w.status === 'locked') && (
                          <button
                            onClick={() => {
                              setGradeTarget(w);
                              setGradeOutcome('');
                              setGradeObserved('');
                              setGradeMsg(null);
                            }}
                            className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${
                              ng ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-green-600 text-white hover:bg-green-700'
                            }`}
                          >
                            Grade
                          </button>
                        )}
                        {w.status === 'open' && !isExpired(w) && (
                          <button
                            onClick={() => { setEditWager(w); setShowForm(true); }}
                            className="rounded-md bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                          >
                            Edit
                          </button>
                        )}
                        {w.status !== 'void' && (
                          <button
                            onClick={() => { setVoidTarget(w); setVoidReason(''); }}
                            className="rounded-md bg-orange-50 px-2.5 py-1.5 text-xs font-semibold text-orange-600 hover:bg-orange-100"
                          >
                            Void
                          </button>
                        )}
                        <button
                          onClick={() => setConfirmDelete(w)}
                          className="rounded-md bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100"
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    {/* Graded result */}
                    {w.status === 'graded' && w.observedValue != null && (() => {
                      const unit = METRIC_UNITS[w.metric] || '';
                      if (w.kind === 'pointspread') {
                        const ps = w as PointspreadWager;
                        const winnerName = w.winningOutcome === 'locationA' ? ps.locationA?.name
                          : w.winningOutcome === 'locationB' ? ps.locationB?.name
                          : w.winningOutcome === 'push' ? 'Push' : w.winningOutcome;
                        return (
                          <div className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
                            w.winningOutcome === 'push' ? 'border-yellow-200 bg-yellow-50' : 'border-green-200 bg-green-50'
                          }`}>
                            <div className="flex items-center gap-3 flex-wrap">
                              <span className="text-gray-500 text-xs">Final:</span>
                              <span className="font-mono font-bold text-gray-800">
                                {ps.locationA?.name}: {ps.observedValueA != null ? `${Math.round(ps.observedValueA)}${unit}` : '?'}
                              </span>
                              <span className="text-gray-400">vs</span>
                              <span className="font-mono font-bold text-gray-800">
                                {ps.locationB?.name}: {ps.observedValueB != null ? `${Math.round(ps.observedValueB)}${unit}` : '?'}
                              </span>
                              <span className="mx-1 text-gray-300">&rarr;</span>
                              <span className={`font-semibold ${w.winningOutcome === 'push' ? 'text-yellow-600' : 'text-green-600'}`}>
                                {w.winningOutcome === 'push' ? 'Push' : `Winner: ${winnerName}`}
                              </span>
                            </div>
                          </div>
                        );
                      }
                      // odds / over-under
                      let winnerDisplay = w.winningOutcome || '';
                      const isNoMatch = w.winningOutcome === 'no_match';
                      if (isNoMatch) {
                        winnerDisplay = `${w.observedValue}${unit} — outside all ranges`;
                      }
                      return (
                        <div className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
                          isNoMatch ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'
                        }`}>
                          <span className="text-gray-500 text-xs">NWS Observed: </span>
                          <span className="font-mono font-bold text-gray-800">{Math.round(w.observedValue as number)}{unit}</span>
                          {w.winningOutcome && (
                            <>
                              <span className="mx-2 text-gray-300">&rarr;</span>
                              <span className={`font-semibold ${isNoMatch ? 'text-red-500' : 'text-green-600'}`}>
                                {isNoMatch ? winnerDisplay : `Winner: ${winnerDisplay}`}
                              </span>
                            </>
                          )}
                        </div>
                      );
                    })()}

                    {/* Void reason */}
                    {w.status === 'void' && w.voidReason && (
                      <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
                        Void reason: {w.voidReason}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Manual Grade Panel */}
      {gradeTarget && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-gray-900">
                Grade: {gradeTarget.title}
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                {gradeTarget.kind === 'over-under' && `Over/Under line: ${(gradeTarget as OverUnderWager).line} — `}
                {gradeTarget.kind === 'odds' && `Odds wager — `}
                {gradeTarget.kind === 'pointspread' && `Pointspread — `}
                Date: {gradeTarget.targetDate}{gradeTarget.targetTime ? ` ${gradeTarget.targetTime}` : ''}
              </p>
            </div>
            <button
              onClick={() => setGradeTarget(null)}
              className="text-sm text-gray-500 hover:text-gray-900"
            >
              Cancel
            </button>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs text-gray-500">Observed Value (enter first — auto-detects winner)</label>
              <input
                type="number"
                step="0.1"
                value={gradeObserved}
                onChange={e => handleObservedChange(e.target.value)}
                placeholder="e.g. 72.5"
                className="w-32 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-field"
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">
                Winning Outcome
                {gradeOutcome && gradeObserved && (
                  <span className="ml-2 text-green-600 font-semibold">(auto-detected)</span>
                )}
              </label>
              <select
                value={gradeOutcome}
                onChange={e => setGradeOutcome(e.target.value)}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-field"
              >
                <option value="">Select outcome...</option>
                {getOutcomeOptions(gradeTarget).map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
                <option value="push">Push (refund all bets)</option>
              </select>
            </div>
            <button
              onClick={handleGrade}
              disabled={gradeLoading || !gradeOutcome || gradeObserved === ''}
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
            >
              {gradeLoading ? 'Grading...' : 'Grade & Settle'}
            </button>
          </div>

          {gradeOutcome && gradeObserved && (
            <p className="mt-2 text-sm font-medium text-gray-700">
              Observed <span className="font-mono font-bold">{gradeObserved}</span>
              {' '}&rarr;{' '}
              {gradeOutcome === 'push' ? (
                <span className="text-gray-500">All bets will be refunded (push)</span>
              ) : (
                <span className="text-green-600">
                  Winner: <span className="font-bold">{gradeOutcome}</span> — losers forfeit stake, winners get paid
                </span>
              )}
            </p>
          )}

          {gradeMsg && (
            <p className={`mt-2 text-xs ${gradeMsg.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>
              {gradeMsg}
            </p>
          )}
        </div>
      )}

      {/* Bet detail panel */}
      {detailWager && (
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold text-gray-900">
              Bets on: {detailWager.title}
            </h3>
            <button
              onClick={() => setDetailWager(null)}
              className="text-sm text-gray-500 hover:text-gray-900"
            >
              Close
            </button>
          </div>

          {detailLoading && (
            <div className="flex justify-center py-6">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-field/20 border-t-field" />
            </div>
          )}

          {detailError && !detailLoading && (
            <p className="py-4 text-center text-sm text-red-600">{detailError}</p>
          )}

          {detailData && !detailLoading && (
            <>
              {/* Summary */}
              <div className="mb-4 grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-gray-100 p-3 text-center">
                  <div className="text-2xl font-bold text-gray-900">{detailData.bets.length}</div>
                  <div className="text-xs text-gray-500">Total Bets</div>
                </div>
                <div className="rounded-lg bg-gray-100 p-3 text-center">
                  <div className="text-2xl font-bold text-green-600">
                    ${fmtUSD(detailData.bets.reduce((s: number, b: BetDetail) => s + b.amountCents, 0))}
                  </div>
                  <div className="text-xs text-gray-500">Total Staked</div>
                </div>
                <div className="rounded-lg bg-gray-100 p-3 text-center">
                  <div className={`text-2xl font-bold ${detailData.exposure.maxLiabilityCents > 50000 ? 'text-red-600' : 'text-orange-500'}`}>
                    ${fmtUSD(detailData.exposure.maxLiabilityCents)}
                  </div>
                  <div className="text-xs text-gray-500">Open Liability</div>
                </div>
              </div>

              {/* By outcome breakdown */}
              {Object.keys(detailData.exposure.byOutcome).length > 0 && (
                <div className="mb-4">
                  <h4 className="mb-2 text-xs font-semibold uppercase text-gray-500">By Outcome</h4>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {Object.entries(detailData.exposure.byOutcome).map(([label, info]) => (
                      <div key={label} className="flex items-center justify-between rounded-lg bg-gray-100 px-3 py-2">
                        <span className="text-sm font-medium text-gray-900">{label}</span>
                        <span className="text-xs text-gray-500">
                          {info.betCount} bet{info.betCount !== 1 ? 's' : ''} &middot; ${fmtUSD(info.stakedCents)} staked &middot; +${fmtUSD(info.maxPayoutCents - info.stakedCents)} payout
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Individual bets table */}
              {detailData.bets.length === 0 ? (
                <p className="py-4 text-center text-sm text-gray-500">No bets placed on this wager yet.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="w-full text-sm text-gray-900">
                    <thead className="bg-gray-100 text-xs uppercase text-gray-500">
                      <tr>
                        <th className="px-3 py-2 text-left">User</th>
                        <th className="px-3 py-2 text-left">Outcome</th>
                        <th className="px-3 py-2 text-right">Odds</th>
                        <th className="px-3 py-2 text-right">Stake</th>
                        <th className="px-3 py-2 text-right">Payout</th>
                        <th className="px-3 py-2 text-left">Status</th>
                        <th className="px-3 py-2 text-left">Placed</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {detailData.bets.map(bet => (
                        <tr key={bet.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2">
                            <div className="font-medium">{bet.userDisplayName}</div>
                            <div className="text-xs text-gray-500">{bet.userEmail}</div>
                          </td>
                          <td className="px-3 py-2 font-medium">{bet.outcomeLabel}</td>
                          <td className="px-3 py-2 text-right font-mono">
                            {bet.odds > 0 ? `+${bet.odds}` : bet.odds}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            ${fmtUSD(bet.amountCents)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-green-600">
                            +${fmtUSD(bet.potentialPayoutCents - bet.amountCents)}
                          </td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                              bet.status === 'won' ? 'bg-green-100 text-green-700' :
                              bet.status === 'lost' ? 'bg-red-100 text-red-700' :
                              bet.status === 'pending' ? 'bg-blue-100 text-blue-700' :
                              'bg-gray-100 text-gray-500'
                            }`}>
                              {bet.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">
                            {formatET(bet.createdAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Adjust player balance */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="mb-3 text-sm font-semibold text-gray-900">Adjust Player Balance</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs text-gray-500">Player email</label>
            <input
              type="email"
              value={creditEmail}
              onChange={e => setCreditEmail(e.target.value)}
              placeholder="user@example.com"
              className="w-56 rounded-lg border border-gray-200 bg-gray-100 px-3 py-2 text-sm text-gray-900 outline-none focus:border-field"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">Amount ($)</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={creditAmount}
              onChange={e => setCreditAmount(e.target.value)}
              className="w-24 rounded-lg border border-gray-200 bg-gray-100 px-3 py-2 text-sm text-gray-900 outline-none focus:border-field"
            />
          </div>
          <button
            onClick={() => handleAdjustBalance(1)}
            disabled={creditLoading || !creditEmail.trim() || !creditAmount}
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
          >
            {creditLoading ? '...' : '+ Add Funds'}
          </button>
          <button
            onClick={() => handleAdjustBalance(-1)}
            disabled={creditLoading || !creditEmail.trim() || !creditAmount}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {creditLoading ? '...' : '- Subtract Funds'}
          </button>
        </div>
        {creditMsg && (
          <p className={`mt-2 text-xs ${creditMsg.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>
            {creditMsg}
          </p>
        )}
      </div>

      {/* Player Management */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Players</h3>
          <button
            onClick={fetchPlayers}
            disabled={playersLoading}
            className="text-xs text-blue-600 hover:underline disabled:opacity-50"
          >
            {playersLoading ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {/* Summary cards */}
        {players.length > 0 && (
          <div className="mb-4 grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-gray-100 p-3 text-center">
              <div className="text-2xl font-bold text-gray-900">{players.length}</div>
              <div className="text-xs text-gray-500">Total Players</div>
            </div>
            <div className="rounded-lg bg-gray-100 p-3 text-center">
              <div className="text-2xl font-bold text-green-600">
                ${(players.reduce((sum, p) => sum + p.balanceCents, 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
              <div className="text-xs text-gray-500">Total Deposited</div>
            </div>
            <div className="rounded-lg bg-gray-100 p-3 text-center">
              <div className="text-2xl font-bold text-blue-600">
                {players.filter(p => p.betCount > 0).length}
              </div>
              <div className="text-xs text-gray-500">Active Bettors</div>
            </div>
          </div>
        )}

        {playersLoading && players.length === 0 && (
          <div className="flex justify-center py-6">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-field/20 border-t-field" />
          </div>
        )}

        {!playersLoading && players.length === 0 && (
          <p className="py-4 text-center text-sm text-gray-500">No registered players yet.</p>
        )}

        {players.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-sm text-gray-900">
              <thead className="bg-gray-100 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left">Name</th>
                  <th className="px-4 py-3 text-left">Email</th>
                  <th className="px-4 py-3 text-left">Login</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                  <th className="px-4 py-3 text-right">Bets</th>
                  <th className="px-4 py-3 text-left">Joined</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {players.map(p => {
                  const loginType = p.hasPassword && p.googleId ? 'Both' : p.googleId ? 'Google' : 'Email';
                  return (
                    <React.Fragment key={p.id}>
                      <tr
                        className="cursor-pointer bg-white hover:bg-gray-50"
                        onClick={() => fetchPlayerDetail(p.id)}
                      >
                        <td className="px-4 py-3 font-medium">
                          {p.displayName}
                          {p.frozen && (
                            <span className="ml-2 inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                              FROZEN
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-500">{p.email}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                            loginType === 'Google' ? 'bg-blue-100 text-blue-700' :
                            loginType === 'Both' ? 'bg-purple-100 text-purple-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>
                            {loginType}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          ${fmtUSD(p.balanceCents)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">{p.betCount}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {formatET(p.createdAt)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2" onClick={e => e.stopPropagation()}>
                            <button
                              onClick={() => handleFreezePlayer(p)}
                              className={`rounded px-2 py-1 text-xs font-semibold ${
                                p.frozen
                                  ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                  : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                              }`}
                            >
                              {p.frozen ? 'Unfreeze' : 'Freeze'}
                            </button>
                            <button
                              onClick={() => setConfirmDeletePlayer(p)}
                              className="rounded bg-red-100 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-200"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expanded detail */}
                      {expandedPlayer === p.id && (
                        <tr>
                          <td colSpan={7} className="bg-gray-50 px-4 py-4">
                            {playerDetailLoading && (
                              <div className="flex justify-center py-4">
                                <div className="h-5 w-5 animate-spin rounded-full border-2 border-field/20 border-t-field" />
                              </div>
                            )}
                            {playerDetail && !playerDetailLoading && (
                              <div className="space-y-4">
                                {/* Bet history */}
                                <div>
                                  <h4 className="mb-2 text-xs font-semibold uppercase text-gray-500">Bet History</h4>
                                  {playerDetail.bets.length === 0 ? (
                                    <p className="text-xs text-gray-400">No bets placed.</p>
                                  ) : (
                                    <div className="overflow-x-auto rounded-lg border border-gray-200">
                                      <table className="w-full text-xs text-gray-900">
                                        <thead className="bg-gray-100 text-xs uppercase text-gray-500">
                                          <tr>
                                            <th className="px-3 py-2 text-left">Outcome</th>
                                            <th className="px-3 py-2 text-right">Odds</th>
                                            <th className="px-3 py-2 text-right">Stake</th>
                                            <th className="px-3 py-2 text-right">Payout</th>
                                            <th className="px-3 py-2 text-left">Status</th>
                                            <th className="px-3 py-2 text-left">Date</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-200">
                                          {playerDetail.bets.map(bet => (
                                            <tr key={bet.id} className="hover:bg-white">
                                              <td className="px-3 py-2 font-medium">{bet.outcomeLabel}</td>
                                              <td className="px-3 py-2 text-right font-mono">
                                                {bet.odds > 0 ? `+${bet.odds}` : bet.odds}
                                              </td>
                                              <td className="px-3 py-2 text-right font-mono">
                                                ${fmtUSD(bet.amountCents)}
                                              </td>
                                              <td className="px-3 py-2 text-right font-mono text-green-600">
                                                +${fmtUSD(bet.potentialPayoutCents - bet.amountCents)}
                                              </td>
                                              <td className="px-3 py-2">
                                                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                                                  bet.status === 'won' ? 'bg-green-100 text-green-700' :
                                                  bet.status === 'lost' ? 'bg-red-100 text-red-700' :
                                                  bet.status === 'pending' ? 'bg-blue-100 text-blue-700' :
                                                  'bg-gray-100 text-gray-500'
                                                }`}>
                                                  {bet.status}
                                                </span>
                                              </td>
                                              <td className="px-3 py-2 text-gray-500">
                                                {formatET(bet.createdAt)}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>

                                {/* Transaction history */}
                                <div>
                                  <h4 className="mb-2 text-xs font-semibold uppercase text-gray-500">Transaction History</h4>
                                  {playerDetail.transactions.length === 0 ? (
                                    <p className="text-xs text-gray-400">No transactions.</p>
                                  ) : (
                                    <div className="overflow-x-auto rounded-lg border border-gray-200">
                                      <table className="w-full text-xs text-gray-900">
                                        <thead className="bg-gray-100 text-xs uppercase text-gray-500">
                                          <tr>
                                            <th className="px-3 py-2 text-left">Type</th>
                                            <th className="px-3 py-2 text-right">Amount</th>
                                            <th className="px-3 py-2 text-right">Balance After</th>
                                            <th className="px-3 py-2 text-left">Description</th>
                                            <th className="px-3 py-2 text-left">Date</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-200">
                                          {playerDetail.transactions.map(tx => (
                                            <tr key={tx.id} className="hover:bg-white">
                                              <td className="px-3 py-2">
                                                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                                                  tx.type === 'deposit' ? 'bg-green-100 text-green-700' :
                                                  tx.type === 'payout' || tx.type === 'bet_won' ? 'bg-green-100 text-green-700' :
                                                  tx.type === 'bet_placed' ? 'bg-orange-100 text-orange-700' :
                                                  tx.type === 'bet_lost' ? 'bg-red-100 text-red-700' :
                                                  'bg-gray-100 text-gray-500'
                                                }`}>
                                                  {tx.type}
                                                </span>
                                              </td>
                                              <td className={`px-3 py-2 text-right font-mono ${tx.amountCents >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                {tx.amountCents >= 0 ? '+' : '-'}${fmtUSD(tx.amountCents)}
                                              </td>
                                              <td className="px-3 py-2 text-right font-mono">
                                                ${fmtUSD(tx.balanceAfterCents)}
                                              </td>
                                              <td className="max-w-[200px] truncate px-3 py-2 text-gray-500">
                                                {tx.description}
                                              </td>
                                              <td className="px-3 py-2 text-gray-500">
                                                {formatET(tx.createdAt)}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Form modal */}
      {showForm && (
        <WagerFormModal
          editWager={editWager}
          pricingPrefill={pricingPrefill || undefined}
          onClose={() => { setShowForm(false); setPricingPrefill(null); }}
          onSaved={() => { setShowForm(false); setPricingPrefill(null); fetchWagers(); }}
        />
      )}

      {/* Bulk delete confirm */}
      {confirmBulkDelete && (
        <ConfirmDialog
          title="Delete Selected Wagers"
          message={`Permanently delete ${selectedIds.size} wager${selectedIds.size === 1 ? '' : 's'}? This cannot be undone.`}
          confirmLabel={bulkDeleting ? 'Deleting...' : `Delete ${selectedIds.size}`}
          confirmColor="red"
          onConfirm={handleBulkDelete}
          onCancel={() => setConfirmBulkDelete(false)}
        />
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete Wager"
          message={`Permanently delete "${confirmDelete.title}"? This cannot be undone.`}
          confirmLabel="Delete"
          confirmColor="red"
          onConfirm={handleDelete}
          onCancel={() => { setConfirmDelete(null); setDeleteError(null); }}
        >
          {deleteError && (
            <p className="mt-2 text-xs text-red-600">{deleteError}</p>
          )}
        </ConfirmDialog>
      )}

      {/* Void confirm */}
      {voidTarget && (
        <ConfirmDialog
          title="Void Wager"
          message={`Void "${voidTarget.title}"? Provide a reason:`}
          confirmLabel="Void Wager"
          confirmColor="red"
          onConfirm={handleVoid}
          onCancel={() => setVoidTarget(null)}
        >
          <input
            type="text"
            value={voidReason}
            onChange={e => setVoidReason(e.target.value)}
            placeholder="Reason for voiding..."
            className="mt-3 w-full rounded-lg border border-gray-200 bg-gray-100 px-3 py-2 text-sm text-gray-900 outline-none focus:border-field"
            autoFocus
          />
        </ConfirmDialog>
      )}

      {/* Reset bets confirm */}
      {confirmReset && (
        <ConfirmDialog
          title="Reset Everything"
          message="This will delete ALL wagers, bets, and transactions. Player balances reset to $250,000 and bookmaker bankroll to $1,000,000. This cannot be undone."
          confirmLabel="Reset Everything"
          confirmColor="red"
          onConfirm={handleResetBets}
          onCancel={() => setConfirmReset(false)}
        />
      )}

      {/* Delete player confirm */}
      {confirmDeletePlayer && (
        <ConfirmDialog
          title="Delete Player"
          message={`Permanently delete "${confirmDeletePlayer.displayName}" (${confirmDeletePlayer.email})? This removes their account, balance, and transaction history. This cannot be undone.`}
          confirmLabel="Delete Player"
          confirmColor="red"
          onConfirm={handleDeletePlayer}
          onCancel={() => setConfirmDeletePlayer(null)}
        />
      )}
    </div>
  );
}

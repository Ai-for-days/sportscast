import React, { useState, useEffect } from 'react';
import type { Wager, WagerStatus, WagerMetric, OddsWager, OverUnderWager, PointspreadWager } from '../../lib/wager-types';
import WagerFormModal from './WagerFormModal';
import ConfirmDialog from './ConfirmDialog';
import ForecastTracker from './ForecastTracker';

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

export default function AdminDashboard() {
  const [wagers, setWagers] = useState<Wager[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editWager, setEditWager] = useState<Wager | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Wager | null>(null);
  const [voidTarget, setVoidTarget] = useState<Wager | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [exposures, setExposures] = useState<Record<string, ExposureInfo>>({});

  // Bankroll state
  const [bankrollCents, setBankrollCents] = useState<number | null>(null);

  // Bet detail panel state
  const [detailWager, setDetailWager] = useState<Wager | null>(null);
  const [detailData, setDetailData] = useState<BetDetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

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

  // Prefill data for wager form (from forecast import)
  const [prefillData, setPrefillData] = useState<{
    locationName: string;
    lat: number;
    lon: number;
    metric: WagerMetric;
    targetDate: string;
    targetTime?: string;
    forecastValue: number;
  } | null>(null);

  // Player management state
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [playersLoading, setPlayersLoading] = useState(false);
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null);
  const [playerDetail, setPlayerDetail] = useState<PlayerDetailData | null>(null);
  const [playerDetailLoading, setPlayerDetailLoading] = useState(false);

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
  }, []);

  const openBetDetail = async (wager: Wager) => {
    setDetailWager(wager);
    setDetailData(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/admin/bets?wagerId=${wager.id}`);
      if (res.ok) {
        const data = await res.json();
        setDetailData(data);
      }
    } catch { /* ignore */ }
    setDetailLoading(false);
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
        setResetMsg(`Reset complete: ${data.keysDeleted} keys deleted. Bankroll: $${(data.bankrollCents / 100).toLocaleString()}`);
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

  // Map forecast metric names to wager metric names
  const forecastToWagerMetric = (m: string): WagerMetric => {
    const map: Record<string, WagerMetric> = {
      actual_temp: 'actual_temp',
      high_temp: 'high_temp',
      low_temp: 'low_temp',
      wind_speed: 'actual_wind',
      wind_gust: 'actual_gust',
    };
    return map[m] || 'high_temp';
  };

  const handleImportForecast = (data: {
    locationName: string;
    lat: number;
    lon: number;
    metric: string;
    targetDate: string;
    targetTime?: string;
    forecastValue: number;
  }) => {
    setPrefillData({
      ...data,
      metric: forecastToWagerMetric(data.metric),
    });
    setEditWager(null);
    setShowForm(true);
  };

  const handleLogout = async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    window.location.href = '/admin';
  };

  const handleCreditBalance = async () => {
    if (!creditEmail.trim() || !creditAmount) return;
    setCreditLoading(true);
    setCreditMsg(null);
    try {
      const res = await fetch('/api/admin/credit-balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: creditEmail.trim(), amountCents: Math.round(parseFloat(creditAmount) * 100) }),
      });
      const data = await res.json();
      if (res.ok) {
        setCreditMsg(`Credited $${creditAmount} to ${data.email}. New balance: $${(data.newBalanceCents / 100).toFixed(2)}`);
        setCreditEmail('');
        setCreditAmount('100');
      } else {
        setCreditMsg(`Error: ${data.error}`);
      }
    } catch {
      setCreditMsg('Network error');
    }
    setCreditLoading(false);
  };

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Wager Dashboard</h2>
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
              onClick={() => setConfirmReset(true)}
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-100"
            >
              Reset All Bets & Bankroll
            </button>
          </div>
        </div>
        {resetMsg && (
          <p className={`mt-2 text-xs ${resetMsg.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>
            {resetMsg}
          </p>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-field/20 border-t-field" />
        </div>
      )}

      {/* Wager table */}
      {!loading && (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-sm text-gray-900">
            <thead className="bg-gray-100 text-xs uppercase text-gray-500">
              <tr>
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={wagers.length > 0 && selectedIds.size === wagers.length}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                </th>
                <th className="px-4 py-3 text-left">Title</th>
                <th className="px-4 py-3 text-left">Kind</th>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-right">Bets</th>
                <th className="px-4 py-3 text-right">Staked</th>
                <th className="px-4 py-3 text-right">Liability</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {wagers.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                    No wagers yet. Create your first one!
                  </td>
                </tr>
              )}
              {wagers.map(w => {
                const exp = exposures[w.id];
                return (
                  <tr key={w.id} className="bg-white hover:bg-gray-50">
                    <td className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(w.id)}
                        onChange={() => toggleSelect(w.id)}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                    </td>
                    <td className="max-w-[200px] truncate px-4 py-3 font-medium">
                      <button onClick={() => openBetDetail(w)} className="text-left text-blue-600 hover:underline">{w.title}</button>
                    </td>
                    <td className="px-4 py-3 capitalize">{w.kind}</td>
                    <td className="px-4 py-3">{w.targetDate}{w.targetTime ? ` ${w.targetTime}` : ''}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLORS[w.status]}`}>
                        {w.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {exp ? exp.totalBets : '-'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {exp ? `$${(exp.totalStakedCents / 100).toFixed(2)}` : '-'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {exp ? (
                        <span className={exp.maxLiabilityCents > 50000 ? 'text-red-600' : ''}>
                          ${(exp.maxLiabilityCents / 100).toFixed(2)}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {(w.status === 'open' || w.status === 'locked') && (
                          <button
                            onClick={() => {
                              setGradeTarget(w);
                              setGradeOutcome('');
                              setGradeObserved('');
                              setGradeMsg(null);
                            }}
                            className="text-xs text-green-600 hover:underline"
                          >
                            Grade
                          </button>
                        )}
                        {w.status === 'open' && (
                          <button
                            onClick={() => { setEditWager(w); setShowForm(true); }}
                            className="text-xs text-blue-600 hover:underline"
                          >
                            Edit
                          </button>
                        )}
                        {w.status !== 'void' && (
                          <button
                            onClick={() => { setVoidTarget(w); setVoidReason(''); }}
                            className="text-xs text-orange-500 hover:underline"
                          >
                            Void
                          </button>
                        )}
                        <button
                          onClick={() => setConfirmDelete(w)}
                          className="text-xs text-red-600 hover:underline"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Manual Grade Panel */}
      {gradeTarget && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold text-gray-900">
              Grade: {gradeTarget.title}
            </h3>
            <button
              onClick={() => setGradeTarget(null)}
              className="text-sm text-gray-500 hover:text-gray-900"
            >
              Cancel
            </button>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs text-gray-500">Winning Outcome</label>
              <select
                value={gradeOutcome}
                onChange={e => setGradeOutcome(e.target.value)}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-field"
              >
                <option value="">Select outcome...</option>
                {getOutcomeOptions(gradeTarget).map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
                <option value="push">Push (refund all)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">Observed Value</label>
              <input
                type="number"
                step="0.1"
                value={gradeObserved}
                onChange={e => setGradeObserved(e.target.value)}
                placeholder="e.g. 72.5"
                className="w-28 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-field"
              />
            </div>
            <button
              onClick={handleGrade}
              disabled={gradeLoading || !gradeOutcome || gradeObserved === ''}
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
            >
              {gradeLoading ? 'Grading...' : 'Grade & Settle'}
            </button>
          </div>

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

          {detailData && !detailLoading && (
            <>
              {/* Exposure summary */}
              <div className="mb-4 grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-gray-100 p-3 text-center">
                  <div className="text-2xl font-bold text-gray-900">{detailData.exposure.totalBets}</div>
                  <div className="text-xs text-gray-500">Total Bets</div>
                </div>
                <div className="rounded-lg bg-gray-100 p-3 text-center">
                  <div className="text-2xl font-bold text-green-600">${(detailData.exposure.totalStakedCents / 100).toFixed(2)}</div>
                  <div className="text-xs text-gray-500">Total Staked</div>
                </div>
                <div className="rounded-lg bg-gray-100 p-3 text-center">
                  <div className={`text-2xl font-bold ${detailData.exposure.maxLiabilityCents > 50000 ? 'text-red-600' : 'text-orange-500'}`}>
                    ${(detailData.exposure.maxLiabilityCents / 100).toFixed(2)}
                  </div>
                  <div className="text-xs text-gray-500">Max Liability</div>
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
                          {info.betCount} bet{info.betCount !== 1 ? 's' : ''} &middot; ${(info.stakedCents / 100).toFixed(2)} staked &middot; +${((info.maxPayoutCents - info.stakedCents) / 100).toFixed(2)} payout
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
                            ${(bet.amountCents / 100).toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-green-600">
                            +${((bet.potentialPayoutCents - bet.amountCents) / 100).toFixed(2)}
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
                            {new Date(bet.createdAt).toLocaleString()}
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

      {/* Credit user balance (testing tool) */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="mb-3 text-sm font-semibold text-gray-900">Credit User Balance</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs text-gray-500">User email</label>
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
              min="1"
              value={creditAmount}
              onChange={e => setCreditAmount(e.target.value)}
              className="w-24 rounded-lg border border-gray-200 bg-gray-100 px-3 py-2 text-sm text-gray-900 outline-none focus:border-field"
            />
          </div>
          <button
            onClick={handleCreditBalance}
            disabled={creditLoading || !creditEmail.trim()}
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
          >
            {creditLoading ? 'Crediting...' : 'Credit'}
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
                        <td className="px-4 py-3 font-medium">{p.displayName}</td>
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
                          ${(p.balanceCents / 100).toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">{p.betCount}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {new Date(p.createdAt).toLocaleDateString()}
                        </td>
                      </tr>

                      {/* Expanded detail */}
                      {expandedPlayer === p.id && (
                        <tr>
                          <td colSpan={6} className="bg-gray-50 px-4 py-4">
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
                                                ${(bet.amountCents / 100).toFixed(2)}
                                              </td>
                                              <td className="px-3 py-2 text-right font-mono text-green-600">
                                                +${((bet.potentialPayoutCents - bet.amountCents) / 100).toFixed(2)}
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
                                                {new Date(bet.createdAt).toLocaleString()}
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
                                                  tx.type === 'payout' ? 'bg-green-100 text-green-700' :
                                                  tx.type === 'bet_placed' ? 'bg-orange-100 text-orange-700' :
                                                  'bg-gray-100 text-gray-500'
                                                }`}>
                                                  {tx.type}
                                                </span>
                                              </td>
                                              <td className={`px-3 py-2 text-right font-mono ${tx.amountCents >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                {tx.amountCents >= 0 ? '+' : ''}${(tx.amountCents / 100).toFixed(2)}
                                              </td>
                                              <td className="px-3 py-2 text-right font-mono">
                                                ${(tx.balanceAfterCents / 100).toFixed(2)}
                                              </td>
                                              <td className="max-w-[200px] truncate px-3 py-2 text-gray-500">
                                                {tx.description}
                                              </td>
                                              <td className="px-3 py-2 text-gray-500">
                                                {new Date(tx.createdAt).toLocaleString()}
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

      {/* Forecast Accuracy Tracker */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <ForecastTracker onImportToWager={handleImportForecast} />
      </div>

      {/* Form modal */}
      {showForm && (
        <WagerFormModal
          editWager={editWager}
          prefill={prefillData || undefined}
          onClose={() => { setShowForm(false); setPrefillData(null); }}
          onSaved={() => { setShowForm(false); setPrefillData(null); fetchWagers(); }}
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
          title="Reset All Bets"
          message="This will delete ALL bet history and reset the bookmaker bankroll to $1,000,000. This cannot be undone."
          confirmLabel="Reset Everything"
          confirmColor="red"
          onConfirm={handleResetBets}
          onCancel={() => setConfirmReset(false)}
        />
      )}
    </div>
  );
}

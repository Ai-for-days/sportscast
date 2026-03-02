import { useState, useEffect } from 'react';
import type { Wager, WagerStatus } from '../../lib/wager-types';
import WagerFormModal from './WagerFormModal';
import ConfirmDialog from './ConfirmDialog';

const STATUS_COLORS: Record<WagerStatus, string> = {
  open: 'bg-field/20 text-field-light',
  locked: 'bg-heat/20 text-heat-light',
  graded: 'bg-sky/20 text-sky-light',
  void: 'bg-storm/20 text-storm-light',
};

interface ExposureInfo {
  totalBets: number;
  totalStakedCents: number;
  maxLiabilityCents: number;
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

  // Credit balance state
  const [creditEmail, setCreditEmail] = useState('');
  const [creditAmount, setCreditAmount] = useState('100');
  const [creditMsg, setCreditMsg] = useState<string | null>(null);
  const [creditLoading, setCreditLoading] = useState(false);

  const fetchWagers = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/wagers?limit=50');
      if (res.ok) {
        const data = await res.json();
        const wagerList: Wager[] = data.wagers || [];
        setWagers(wagerList);

        // Fetch exposure for open/locked wagers
        const activeWagers = wagerList.filter(w => w.status === 'open' || w.status === 'locked');
        const exposureMap: Record<string, ExposureInfo> = {};
        await Promise.all(
          activeWagers.map(async (w) => {
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

  useEffect(() => { fetchWagers(); }, []);

  const handleDelete = async () => {
    if (!confirmDelete) return;
    await fetch(`/api/admin/wagers/${confirmDelete.id}`, { method: 'DELETE' });
    setConfirmDelete(null);
    fetchWagers();
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
        <h2 className="text-xl font-bold text-text-dark">Wager Dashboard</h2>
        <div className="flex gap-3">
          <button
            onClick={() => { setEditWager(null); setShowForm(true); }}
            className="rounded-lg bg-field px-4 py-2 text-sm font-semibold text-white hover:bg-field-light"
          >
            + Create Wager
          </button>
          <button
            onClick={handleLogout}
            className="rounded-lg border border-border-dark px-4 py-2 text-sm text-text-dark-muted hover:bg-surface-dark"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-field/20 border-t-field" />
        </div>
      )}

      {/* Wager table */}
      {!loading && (
        <div className="overflow-x-auto rounded-xl border border-border-dark">
          <table className="w-full text-sm text-text-dark">
            <thead className="bg-surface-dark text-xs uppercase text-text-dark-muted">
              <tr>
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
            <tbody className="divide-y divide-border-dark">
              {wagers.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-text-dark-muted">
                    No wagers yet. Create your first one!
                  </td>
                </tr>
              )}
              {wagers.map(w => {
                const exp = exposures[w.id];
                return (
                  <tr key={w.id} className="bg-surface-dark-alt hover:bg-surface-dark">
                    <td className="max-w-[200px] truncate px-4 py-3 font-medium">{w.title}</td>
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
                        <span className={exp.maxLiabilityCents > 50000 ? 'text-alert-light' : ''}>
                          ${(exp.maxLiabilityCents / 100).toFixed(2)}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {w.status === 'open' && (
                          <button
                            onClick={() => { setEditWager(w); setShowForm(true); }}
                            className="text-xs text-field-light hover:underline"
                          >
                            Edit
                          </button>
                        )}
                        {w.status !== 'void' && (
                          <button
                            onClick={() => { setVoidTarget(w); setVoidReason(''); }}
                            className="text-xs text-heat-light hover:underline"
                          >
                            Void
                          </button>
                        )}
                        <button
                          onClick={() => setConfirmDelete(w)}
                          className="text-xs text-alert-light hover:underline"
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

      {/* Credit user balance (testing tool) */}
      <div className="rounded-xl border border-border-dark bg-surface-dark-alt p-5">
        <h3 className="mb-3 text-sm font-semibold text-text-dark">Credit User Balance</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs text-text-dark-muted">User email</label>
            <input
              type="email"
              value={creditEmail}
              onChange={e => setCreditEmail(e.target.value)}
              placeholder="user@example.com"
              className="w-56 rounded-lg border border-border-dark bg-surface-dark px-3 py-2 text-sm text-text-dark outline-none focus:border-field"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-text-dark-muted">Amount ($)</label>
            <input
              type="number"
              min="1"
              value={creditAmount}
              onChange={e => setCreditAmount(e.target.value)}
              className="w-24 rounded-lg border border-border-dark bg-surface-dark px-3 py-2 text-sm text-text-dark outline-none focus:border-field"
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
          <p className={`mt-2 text-xs ${creditMsg.startsWith('Error') ? 'text-alert-light' : 'text-green-400'}`}>
            {creditMsg}
          </p>
        )}
      </div>

      {/* Form modal */}
      {showForm && (
        <WagerFormModal
          editWager={editWager}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); fetchWagers(); }}
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
          onCancel={() => setConfirmDelete(null)}
        />
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
            className="mt-3 w-full rounded-lg border border-border-dark bg-surface-dark px-3 py-2 text-sm text-text-dark outline-none focus:border-field"
            autoFocus
          />
        </ConfirmDialog>
      )}
    </div>
  );
}

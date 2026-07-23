// ── Step 119B Part A: Pretend User Testing Center (admin-only) ──────────────
//
// Sandbox-only UI. No wallet/bet writes. Lists pretend-user sessions and
// gives the operator a checklist for exercising the public flow safely.

import React, { useEffect, useMemo, useState } from 'react';
import { formatDMYTime } from '../../lib/date-format';
import SystemNav from './SystemNav';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const tile: React.CSSProperties = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 12 };
const btn = (bg: string): React.CSSProperties => ({ padding: '6px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const input: React.CSSProperties = { background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', padding: '6px 8px', borderRadius: 6, fontSize: 12 };
const label: React.CSSProperties = { fontSize: 11, color: '#94a3b8', marginBottom: 4, display: 'block' };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13, color: '#e2e8f0' };
const sectionHeader: React.CSSProperties = { fontSize: 16, fontWeight: 800, marginBottom: 8, color: '#e2e8f0' };
const muted: React.CSSProperties = { fontSize: 12, color: '#94a3b8' };

const BANNER: React.CSSProperties = {
  background: 'linear-gradient(90deg, #064e3b, #047857)',
  color: '#fff',
  padding: '10px 14px',
  borderRadius: 8,
  marginBottom: 16,
  fontSize: 13,
  fontWeight: 600,
};

type Tab = 'active' | 'create' | 'checklist' | 'notes' | 'bet' | 'methodology';

interface TestAction {
  at: string;
  actor: string;
  action: string;
  details?: any;
}

interface TestSession {
  id: string;
  createdAt: string;
  createdBy: string;
  pretendUserId: string;
  displayName: string;
  startingTestBalanceCents: number;
  currentTestBalanceCents: number;
  status: 'active' | 'closed';
  notes: string[];
  actions: TestAction[];
}

interface SessionSummary {
  total: number;
  active: number;
  closed: number;
  latest: TestSession | null;
}

const API = '/api/admin/system/pretend-user-testing';
const BET_API = '/api/admin/system/pretend-bet-sandbox';
const PUBLIC_WAGERS_API = '/api/wagers';

const CHECKLIST: { key: string; text: string; href?: string }[] = [
  { key: 'visit-wagers', text: 'Visit /wagers', href: '/wagers' },
  { key: 'open-detail', text: 'Open a market detail page' },
  { key: 'review-timeline', text: 'Review the timeline, rules, FAQ, and responsible-play note' },
  { key: 'void-cancel', text: 'Confirm cancelled markets do not expose internal voidReason' },
  { key: 'no-internal', text: 'Confirm no Kalshi or admin/internal data appears on public pages' },
  { key: 'sandbox-bet', text: 'Use the Place Pretend Bet tab to record a sandbox wager' },
];

interface PublicOutcomeMini {
  label: string;
  displayedOdds?: number;
}

interface PublicWagerMini {
  id: string;
  ticketNumber?: string;
  title: string;
  status: 'open' | 'locked' | 'graded' | 'void';
  outcomes: PublicOutcomeMini[];
}

interface PretendBet {
  id: string;
  createdAt: string;
  sessionId: string;
  pretendUserId: string;
  wagerId: string;
  wagerTitle: string;
  outcomeLabel: string;
  stakeCents: number;
  potentialPayoutCents: number;
  odds: number;
  status: 'open' | 'won' | 'lost' | 'push' | 'void';
  notes: { at: string; actor: string; text: string }[];
}

export default function PretendUserTestingCenter() {
  const [tab, setTab] = useState<Tab>('active');
  const [sessions, setSessions] = useState<TestSession[]>([]);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [active, setActive] = useState<TestSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [displayName, setDisplayName] = useState('');
  const [startingDollars, setStartingDollars] = useState<number>(1000);

  // Note form
  const [noteText, setNoteText] = useState('');

  // Pretend-bet state
  const [openWagers, setOpenWagers] = useState<PublicWagerMini[]>([]);
  const [betWagerId, setBetWagerId] = useState('');
  const [betOutcome, setBetOutcome] = useState('');
  const [betStakeDollars, setBetStakeDollars] = useState<number>(10);
  const [betPreview, setBetPreview] = useState<{ odds?: number; profitCents?: number; potentialPayoutCents?: number; reason?: string; ok: boolean } | null>(null);
  const [pretendBets, setPretendBets] = useState<PretendBet[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [listR, sumR, openR] = await Promise.all([
          fetch(`${API}?action=list&limit=50`),
          fetch(`${API}?action=summary`),
          fetch(`${PUBLIC_WAGERS_API}?status=open&limit=50`),
        ]);
        const [listJ, sumJ, openJ] = await Promise.all([listR.json(), sumR.json(), openR.json()]);
        if (cancelled) return;
        if (!listR.ok) throw new Error(listJ.message ?? 'list failed');
        setSessions(listJ.sessions ?? []);
        setSummary(sumJ.summary ?? null);
        setOpenWagers(Array.isArray(openJ?.wagers) ? openJ.wagers : []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Failed to load.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-fetch the bet ledger whenever an active session is selected.
  useEffect(() => {
    let cancelled = false;
    if (!active) {
      setPretendBets([]);
      return;
    }
    fetch(`${BET_API}?action=get-by-session&sessionId=${encodeURIComponent(active.id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then((j) => {
        if (!cancelled) setPretendBets(j.bets ?? []);
      })
      .catch(() => {
        if (!cancelled) setPretendBets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [active?.id]);

  // Live payout preview as the operator types.
  useEffect(() => {
    let cancelled = false;
    if (!betWagerId || !betOutcome || !(betStakeDollars > 0)) {
      setBetPreview(null);
      return;
    }
    const stakeCents = Math.floor(betStakeDollars * 100);
    fetch(
      `${BET_API}?action=preview&wagerId=${encodeURIComponent(betWagerId)}&outcomeLabel=${encodeURIComponent(betOutcome)}&stakeCents=${stakeCents}`,
    )
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setBetPreview(j.result ?? null);
      })
      .catch(() => {
        if (!cancelled) setBetPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [betWagerId, betOutcome, betStakeDollars]);

  async function refresh() {
    const [listR, sumR] = await Promise.all([
      fetch(`${API}?action=list&limit=50`),
      fetch(`${API}?action=summary`),
    ]);
    if (listR.ok) setSessions((await listR.json()).sessions ?? []);
    if (sumR.ok) setSummary((await sumR.json()).summary ?? null);
  }

  async function onCreate() {
    setBusy('create');
    setError(null);
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create-session',
          displayName: displayName.trim() || undefined,
          startingTestBalanceCents: Math.max(0, Math.floor(startingDollars * 100)),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? 'create failed');
      setActive(j.session ?? null);
      setDisplayName('');
      await refresh();
      setTab('active');
    } catch (e: any) {
      setError(e?.message ?? 'Create failed.');
    } finally {
      setBusy(null);
    }
  }

  async function onAddNote() {
    if (!active || !noteText.trim()) return;
    setBusy('note');
    setError(null);
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add-note', id: active.id, note: noteText.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? 'add-note failed');
      setActive(j.session ?? null);
      setNoteText('');
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Note failed.');
    } finally {
      setBusy(null);
    }
  }

  async function onClose() {
    if (!active) return;
    if (!confirm('Close this pretend-user session?')) return;
    setBusy('close');
    setError(null);
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'close-session', id: active.id }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? 'close failed');
      setActive(j.session ?? null);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Close failed.');
    } finally {
      setBusy(null);
    }
  }

  async function onOpen(id: string) {
    setBusy('open');
    setError(null);
    try {
      const r = await fetch(`${API}?action=get&id=${encodeURIComponent(id)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? 'get failed');
      setActive(j.session ?? null);
    } catch (e: any) {
      setError(e?.message ?? 'Open failed.');
    } finally {
      setBusy(null);
    }
  }

  async function refreshBetsForActive() {
    if (!active) return;
    const r = await fetch(
      `${BET_API}?action=get-by-session&sessionId=${encodeURIComponent(active.id)}`,
    );
    if (r.ok) setPretendBets((await r.json()).bets ?? []);
  }

  async function onPlacePretendBet() {
    if (!active) {
      setError('Open an active pretend-user session first.');
      return;
    }
    if (!betWagerId || !betOutcome || !(betStakeDollars > 0)) {
      setError('Pick a wager, an outcome, and a positive stake.');
      return;
    }
    setBusy('place');
    setError(null);
    try {
      const r = await fetch(BET_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'place-pretend-bet',
          sessionId: active.id,
          wagerId: betWagerId,
          outcomeLabel: betOutcome,
          stakeCents: Math.floor(betStakeDollars * 100),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? 'place failed');
      if (j.session) setActive(j.session);
      await refreshBetsForActive();
      setBetOutcome('');
    } catch (e: any) {
      setError(e?.message ?? 'Place failed.');
    } finally {
      setBusy(null);
    }
  }

  async function onVoidPretendBet(id: string) {
    if (!confirm('Void this pretend bet and restore the stake to the session balance?')) return;
    setBusy('void');
    setError(null);
    try {
      const r = await fetch(BET_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'void-pretend-bet', id }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? 'void failed');
      if (j.session) setActive(j.session);
      await refreshBetsForActive();
    } catch (e: any) {
      setError(e?.message ?? 'Void failed.');
    } finally {
      setBusy(null);
    }
  }

  const formatBal = (c: number) => `$${(c / 100).toLocaleString()}`;
  const selectedWager = openWagers.find((w) => w.id === betWagerId);

  return (
    <div style={{ background: '#0f172a', minHeight: '100vh', padding: 16, color: '#e2e8f0' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>Pretend User Testing</h1>
      <p style={{ ...muted, marginBottom: 12 }}>
        Sandbox-only. Use this to walk the public/customer flow as a fake user. No real money, no
        wallet writes, no bet-store writes. Bet placement is not yet available — exercise read-only
        paths and document gaps in notes.
      </p>

      <div style={BANNER}>
        Pretend User Testing is sandbox-only. It does not use real money, real balances, or external trading.
      </div>

      <div style={{ ...muted, marginBottom: 12, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        Quick links:
        <a href="/wagers" style={{ color: '#60a5fa' }} target="_blank" rel="noreferrer">/wagers</a>
        <a href="/admin/wagers" style={{ color: '#60a5fa' }}>/admin/wagers</a>
        <a href="/admin/system/kalshi-market-comparison" style={{ color: '#60a5fa' }}>Kalshi Comparison</a>
        <a href="/admin/system/house-exposure" style={{ color: '#60a5fa' }}>House Exposure</a>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {(
          [
            ['active', 'Active Sessions'],
            ['create', 'Create Pretend User'],
            ['checklist', 'Test Flow Checklist'],
            ['notes', 'Session Notes'],
            ['bet', 'Place Pretend Bet'],
            ['methodology', 'Methodology'],
          ] as [Tab, string][]
        ).map(([k, lbl]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            style={{ ...btn(tab === k ? '#3b82f6' : '#334155'), opacity: tab === k ? 1 : 0.85 }}
          >
            {lbl}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ ...card, background: '#7f1d1d', color: '#fef2f2' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {tab === 'active' && (
        <div style={card}>
          <h2 style={sectionHeader}>Sessions</h2>
          {summary && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 12 }}>
              <div style={tile}><div style={muted}>Total</div><div style={{ fontSize: 22, fontWeight: 700 }}>{summary.total}</div></div>
              <div style={tile}><div style={muted}>Active</div><div style={{ fontSize: 22, fontWeight: 700, color: '#22c55e' }}>{summary.active}</div></div>
              <div style={tile}><div style={muted}>Closed</div><div style={{ fontSize: 22, fontWeight: 700, color: '#94a3b8' }}>{summary.closed}</div></div>
            </div>
          )}
          {loading ? (
            <div style={muted}>Loading…</div>
          ) : sessions.length === 0 ? (
            <div style={muted}>No sessions yet. Create one in the next tab.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>When</th>
                    <th style={th}>Pretend user</th>
                    <th style={th}>Display</th>
                    <th style={th}>Test balance</th>
                    <th style={th}>Status</th>
                    <th style={th}>Notes</th>
                    <th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id}>
                      <td style={td}>{formatDMYTime(s.createdAt)}</td>
                      <td style={td}><code style={{ fontSize: 11 }}>{s.pretendUserId}</code></td>
                      <td style={td}>{s.displayName}</td>
                      <td style={td}>{formatBal(s.currentTestBalanceCents)}</td>
                      <td style={td}>
                        <span style={{ color: s.status === 'active' ? '#22c55e' : '#94a3b8', fontWeight: 600 }}>
                          {s.status}
                        </span>
                      </td>
                      <td style={td}>{s.notes.length}</td>
                      <td style={td}><button style={btn('#475569')} onClick={() => onOpen(s.id)}>Open</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'create' && (
        <div style={card}>
          <h2 style={sectionHeader}>Create Pretend User</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 8 }}>
            <div>
              <span style={label}>Display name (optional)</span>
              <input
                style={{ ...input, width: '100%' }}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Tester Pat"
              />
            </div>
            <div>
              <span style={label}>Starting test balance (USD)</span>
              <input
                type="number"
                min={0}
                style={{ ...input, width: '100%' }}
                value={startingDollars}
                onChange={(e) => setStartingDollars(Number(e.target.value) || 0)}
              />
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <button
              style={{ ...btn('#22c55e'), opacity: busy ? 0.6 : 1 }}
              disabled={!!busy}
              onClick={onCreate}
            >
              {busy === 'create' ? 'Creating…' : 'Create session'}
            </button>
          </div>
          <p style={{ ...muted, marginTop: 12 }}>
            Test balance is virtual (operator-tracked accounting). It does not credit any real wallet
            and is not visible to public pages.
          </p>
        </div>
      )}

      {tab === 'checklist' && (
        <div style={card}>
          <h2 style={sectionHeader}>Test Flow Checklist</h2>
          <p style={muted}>
            Walk this checklist as a non-admin user. Use the active session's notes tab to record
            findings. Cancellation language and the absence of internal data are the most important
            checks.
          </p>
          <ul style={{ marginTop: 12, lineHeight: 1.7 }}>
            {CHECKLIST.map((c) => (
              <li key={c.key}>
                {c.text}
                {c.href && (
                  <>
                    {' '}—{' '}
                    <a href={c.href} target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>
                      open
                    </a>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'notes' && (
        <div style={card}>
          <h2 style={sectionHeader}>Session Notes</h2>
          {!active ? (
            <div style={muted}>Open a session in Active Sessions to add notes.</div>
          ) : (
            <>
              <div style={{ ...tile, marginBottom: 12 }}>
                <div style={{ fontWeight: 700 }}>{active.displayName}</div>
                <div style={muted}>
                  <code style={{ fontSize: 11 }}>{active.pretendUserId}</code> · {active.status} · balance {formatBal(active.currentTestBalanceCents)}
                </div>
              </div>
              {active.status === 'active' && (
                <div style={{ marginBottom: 12 }}>
                  <textarea
                    style={{ ...input, width: '100%', minHeight: 80 }}
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Observation about the public flow…"
                  />
                  <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                    <button
                      style={{ ...btn('#3b82f6'), opacity: busy || !noteText.trim() ? 0.6 : 1 }}
                      disabled={!!busy || !noteText.trim()}
                      onClick={onAddNote}
                    >
                      {busy === 'note' ? 'Adding…' : 'Add note'}
                    </button>
                    <button
                      style={{ ...btn('#ef4444'), opacity: busy ? 0.6 : 1 }}
                      disabled={!!busy}
                      onClick={onClose}
                    >
                      Close session
                    </button>
                  </div>
                </div>
              )}
              {active.notes.length === 0 ? (
                <div style={muted}>No notes recorded.</div>
              ) : (
                <ul style={{ lineHeight: 1.7 }}>
                  {active.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              )}
              <h3 style={{ ...sectionHeader, fontSize: 14, marginTop: 16 }}>Audit trail</h3>
              <ul style={{ ...muted, lineHeight: 1.7 }}>
                {active.actions.map((a, i) => (
                  <li key={i}>
                    <code style={{ fontSize: 11 }}>{formatDMYTime(a.at)}</code> · {a.action} · by {a.actor}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {tab === 'bet' && (
        <div style={card}>
          <h2 style={sectionHeader}>Place Pretend Bet</h2>
          <div
            style={{
              background: 'linear-gradient(90deg, #064e3b, #047857)',
              color: '#fff',
              padding: '10px 14px',
              borderRadius: 8,
              marginBottom: 12,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Pretend bets are sandbox records only. They do not affect real balances, production bets, or settlement.
          </div>
          {!active ? (
            <div style={muted}>Open an active pretend-user session first (Active Sessions tab).</div>
          ) : active.status !== 'active' ? (
            <div style={muted}>This session is closed. Create a new one or open an active one.</div>
          ) : (
            <>
              <div style={{ ...tile, marginBottom: 12 }}>
                <div style={{ fontWeight: 700 }}>{active.displayName}</div>
                <div style={muted}>
                  <code style={{ fontSize: 11 }}>{active.pretendUserId}</code> · session balance{' '}
                  <strong style={{ color: '#22c55e' }}>{formatBal(active.currentTestBalanceCents)}</strong>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                <div>
                  <span style={label}>Open wager</span>
                  <select
                    style={{ ...input, width: '100%' }}
                    value={betWagerId}
                    onChange={(e) => {
                      setBetWagerId(e.target.value);
                      setBetOutcome('');
                    }}
                  >
                    <option value="">— pick an open wager —</option>
                    {openWagers.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.ticketNumber ? `${w.ticketNumber} · ` : ''}
                        {w.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <span style={label}>Outcome</span>
                  <select
                    style={{ ...input, width: '100%' }}
                    value={betOutcome}
                    onChange={(e) => setBetOutcome(e.target.value)}
                    disabled={!selectedWager}
                  >
                    <option value="">— pick an outcome —</option>
                    {(selectedWager?.outcomes ?? []).map((o, i) => (
                      <option key={i} value={o.label}>
                        {o.label}
                        {typeof o.displayedOdds === 'number'
                          ? ` (${o.displayedOdds > 0 ? '+' : ''}${o.displayedOdds})`
                          : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <span style={label}>Stake (USD)</span>
                  <input
                    type="number"
                    min={1}
                    step="any"
                    style={{ ...input, width: '100%' }}
                    value={betStakeDollars}
                    onChange={(e) => setBetStakeDollars(Number(e.target.value) || 0)}
                  />
                </div>
              </div>
              <div style={{ ...tile, marginTop: 12 }}>
                {betPreview?.ok ? (
                  <>
                    Potential payout:{' '}
                    <strong>{formatBal(betPreview.potentialPayoutCents ?? 0)}</strong> (profit{' '}
                    <strong>{formatBal(betPreview.profitCents ?? 0)}</strong>) at odds{' '}
                    <code style={{ fontSize: 11 }}>
                      {(betPreview.odds ?? 0) > 0 ? '+' : ''}
                      {betPreview.odds ?? '—'}
                    </code>
                  </>
                ) : (
                  <span style={muted}>{betPreview?.reason ?? 'Pick a wager, outcome, and stake to preview the payout.'}</span>
                )}
              </div>
              <div style={{ marginTop: 12 }}>
                <button
                  style={{ ...btn('#22c55e'), opacity: !betPreview?.ok || busy ? 0.6 : 1 }}
                  disabled={!betPreview?.ok || !!busy}
                  onClick={onPlacePretendBet}
                >
                  {busy === 'place' ? 'Placing…' : 'Place pretend bet'}
                </button>
              </div>

              <h3 style={{ ...sectionHeader, fontSize: 14, marginTop: 20 }}>Pretend bet ledger (this session)</h3>
              {pretendBets.length === 0 ? (
                <div style={muted}>No pretend bets yet for this session.</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={th}>When</th>
                        <th style={th}>Wager</th>
                        <th style={th}>Outcome</th>
                        <th style={th}>Stake</th>
                        <th style={th}>Odds</th>
                        <th style={th}>Potential payout</th>
                        <th style={th}>Status</th>
                        <th style={th}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {pretendBets.map((b) => (
                        <tr key={b.id}>
                          <td style={td}>{formatDMYTime(b.createdAt)}</td>
                          <td style={td}>{b.wagerTitle}</td>
                          <td style={td}>{b.outcomeLabel}</td>
                          <td style={td}>{formatBal(b.stakeCents)}</td>
                          <td style={td}>
                            <code style={{ fontSize: 11 }}>{b.odds > 0 ? '+' : ''}{b.odds}</code>
                          </td>
                          <td style={td}>{formatBal(b.potentialPayoutCents)}</td>
                          <td style={td}>
                            <span
                              style={{
                                color: b.status === 'open' ? '#22c55e' : '#94a3b8',
                                fontWeight: 600,
                              }}
                            >
                              {b.status}
                            </span>
                          </td>
                          <td style={td}>
                            {b.status === 'open' && (
                              <button
                                style={{ ...btn('#475569'), opacity: busy ? 0.6 : 1 }}
                                disabled={!!busy}
                                onClick={() => onVoidPretendBet(b.id)}
                              >
                                Void
                              </button>
                            )}
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

      {tab === 'methodology' && (
        <div style={card}>
          <h2 style={sectionHeader}>Methodology</h2>
          <ul style={{ marginTop: 8, lineHeight: 1.7 }}>
            <li>Sandbox-only. State lives in <code>pretend-user-session:&lt;id&gt;</code> + <code>pretend-bet:&lt;id&gt;</code> with their respective indexes. Test balance is virtual and never written to <code>wallet-store</code>.</li>
            <li>Pretend bets are only allowed on <strong>open</strong> wagers. Stake is debited from the session's virtual balance on place; voiding a pretend bet restores it. There is no auto-grading in this step.</li>
            <li>Payout estimate uses American-odds: <code>+x</code> → <code>stake × x/100</code>; <code>-x</code> → <code>stake × 100/x</code>. Total potential payout includes the original stake.</li>
            <li>Audit events: <code>pretend_user_session_*</code>, <code>pretend_bet_placed</code>, <code>pretend_bet_note_added</code>, <code>pretend_bet_voided</code>.</li>
            <li>Future enhancement: a strictly scoped "view-as-user" admin session shim may be considered later. Not implemented now — the current pretend system is a sandbox ledger only.</li>
            <li>Public pages are unaware of these sessions and bets. No Kalshi or admin data is exposed.</li>
          </ul>

          <h3 style={{ ...sectionHeader, fontSize: 14, marginTop: 16 }}>Sandbox isolation review (Step 121 Part E)</h3>
          <ul style={{ marginTop: 8, lineHeight: 1.7 }}>
            <li><strong>Namespace separation:</strong> the only Redis keys this subsystem writes are <code>pretend-user-session:*</code>, <code>pretend-user-sessions:all</code>, <code>pretend-user-session:active:&lt;pretendUserId&gt;</code>, <code>pretend-bet:*</code>, <code>pretend-bets:all</code>, <code>pretend-bets:session:*</code>, <code>pretend-bets:wager:*</code>. No reads or writes to <code>balance:*</code>, <code>transaction:*</code>, <code>bet:*</code>, <code>bets:by-user:*</code>, or <code>bets:by-wager:*</code>.</li>
            <li><strong>ID format separation:</strong> pretend session ids are prefixed <code>puts-</code>, pretend user ids are prefixed <code>pretend-</code>, and pretend bet ids are prefixed <code>pbet-</code>. Production users (<code>user:*</code>) and bets (<code>bet_</code>) use distinct prefixes — accidental crossover is impossible at the key level.</li>
            <li><strong>API boundary:</strong> all pretend routes are under <code>/api/admin/system/</code> and gated by <code>requireAdmin</code>. There is no public or authenticated-user endpoint that touches pretend data.</li>
            <li><strong>Code boundary:</strong> <code>pretend-bet-store.ts</code> never imports <code>wallet-store</code>, <code>bet-store</code>, or any settlement helper. <code>applyTestBalanceDelta</code> is the only path that mutates the virtual balance, and it only writes to <code>pretend-user-session:&lt;id&gt;</code>.</li>
            <li><strong>Read coupling is one-way:</strong> the pretend-bet placer reads the <code>Wager</code> via <code>getWager</code> for outcome/odds validation. It never writes back to <code>wager:*</code>.</li>
          </ul>
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <SystemNav activeHref="/admin/system/pretend-user-testing" />
      </div>
    </div>
  );
}

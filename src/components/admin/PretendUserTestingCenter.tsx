// ── Step 119B Part A: Pretend User Testing Center (admin-only) ──────────────
//
// Sandbox-only UI. No wallet/bet writes. Lists pretend-user sessions and
// gives the operator a checklist for exercising the public flow safely.

import React, { useEffect, useMemo, useState } from 'react';
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

type Tab = 'active' | 'create' | 'checklist' | 'notes' | 'methodology';

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

const CHECKLIST: { key: string; text: string; href?: string }[] = [
  { key: 'visit-wagers', text: 'Visit /wagers', href: '/wagers' },
  { key: 'open-detail', text: 'Open a market detail page' },
  { key: 'review-timeline', text: 'Review the timeline, rules, FAQ, and responsible-play note' },
  { key: 'void-cancel', text: 'Confirm cancelled markets do not expose internal voidReason' },
  { key: 'no-internal', text: 'Confirm no Kalshi or admin/internal data appears on public pages' },
  { key: 'sandbox-bet', text: 'Sandbox bet placement is NOT yet available; instructions only' },
];

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

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [listR, sumR] = await Promise.all([
          fetch(`${API}?action=list&limit=50`),
          fetch(`${API}?action=summary`),
        ]);
        const [listJ, sumJ] = await Promise.all([listR.json(), sumR.json()]);
        if (cancelled) return;
        if (!listR.ok) throw new Error(listJ.message ?? 'list failed');
        setSessions(listJ.sessions ?? []);
        setSummary(sumJ.summary ?? null);
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

  const formatBal = (c: number) => `$${(c / 100).toLocaleString()}`;

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
                      <td style={td}>{new Date(s.createdAt).toLocaleString()}</td>
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
                    <code style={{ fontSize: 11 }}>{new Date(a.at).toLocaleString()}</code> · {a.action} · by {a.actor}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {tab === 'methodology' && (
        <div style={card}>
          <h2 style={sectionHeader}>Methodology</h2>
          <ul style={{ marginTop: 8, lineHeight: 1.7 }}>
            <li>Sandbox-only. State lives in <code>pretend-user-session:&lt;id&gt;</code>, with sorted set <code>pretend-user-sessions:all</code> and an active pointer per pretend user.</li>
            <li>Test balance is virtual. It is never written to <code>wallet-store</code> or any production balance store.</li>
            <li>Sandbox bet placement is not implemented; the production bet path requires real users and real balances. Notes are the artifact of testing for now.</li>
            <li>Audit events: <code>pretend_user_session_created</code>, <code>pretend_user_session_note_added</code>, <code>pretend_user_session_closed</code>.</li>
            <li>Public pages are unaware of these sessions. No Kalshi or admin data is exposed.</li>
          </ul>
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <SystemNav activeHref="/admin/system/pretend-user-testing" />
      </div>
    </div>
  );
}

import React, { useEffect, useState } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface E2ECheck {
  key: string; stage: string; title: string; description: string;
  status: string; verificationDepth: string; summary: string;
  durationMs?: number; lastRun?: string; automated: boolean;
}
interface ManualSignoff {
  key: string; stage: string; title: string;
  confirmedBy?: string; confirmedAt?: string; notes?: string;
}
interface CheckDef { key: string; title: string; description: string; stage: string; automated: boolean; }
interface ManualItem { key: string; stage: string; title: string; }
interface RunRecord {
  id: string; createdAt: string; stage: string; checkKey: string;
  status: string; verificationDepth: string; summary: string; automated: boolean; operatorId?: string;
}

/* ------------------------------------------------------------------ */
/*  Styles                                                              */
/* ------------------------------------------------------------------ */

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({ padding: '5px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (color: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: color, color: '#fff' });

const statusColor: Record<string, string> = { pass: '#22c55e', fail: '#ef4444', warn: '#f59e0b', not_run: '#64748b', manual_pending: '#8b5cf6' };
const depthColor: Record<string, string> = { automated: '#3b82f6', structural: '#f59e0b', manual_required: '#8b5cf6', operator_confirmed: '#22c55e' };

const STAGE_LABELS: Record<string, string> = {
  forecasting: 'A. Forecasting', market_generation: 'B. Market Generation',
  signals_candidates: 'C. Signals & Candidates', execution: 'D. Execution',
  post_trade: 'E. Post-Trade', operations: 'F. Operations',
  governance_launch: 'G. Governance & Launch', manual: 'Manual Operator Signoff',
};

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function E2EValidation() {
  const [checks, setChecks] = useState<CheckDef[]>([]);
  const [manualItems, setManualItems] = useState<ManualItem[]>([]);
  const [signoffs, setSignoffs] = useState<ManualSignoff[]>([]);
  const [results, setResults] = useState<Record<string, E2ECheck>>({});
  const [history, setHistory] = useState<RunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState<'checks' | 'manual' | 'history'>('checks');

  const fetchOverview = async () => {
    try {
      const res = await fetch('/api/admin/system/e2e-validation');
      if (res.ok) {
        const d = await res.json();
        setChecks(d.checks || []);
        setManualItems(d.manualItems || []);
        setSignoffs(d.signoffs || []);
        setHistory(d.recentHistory || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/admin/system/e2e-validation?action=history&limit=100');
      if (res.ok) { const d = await res.json(); setHistory(d.runs || []); }
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchOverview(); }, []);

  const post = async (body: any) => {
    setMsg('');
    try {
      const res = await fetch('/api/admin/system/e2e-validation', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) { setMsg(j.error || 'Error'); return null; }
      return j;
    } catch (e: any) { setMsg(e.message); return null; }
  };

  const runAll = async () => {
    setRunning('all'); setMsg('');
    const j = await post({ action: 'run-all' });
    if (j?.checks) {
      const map: Record<string, E2ECheck> = {};
      for (const c of j.checks) map[c.key] = c;
      setResults(map);
      const p = j.checks.filter((c: E2ECheck) => c.status === 'pass').length;
      const f = j.checks.filter((c: E2ECheck) => c.status === 'fail').length;
      const w = j.checks.filter((c: E2ECheck) => c.status === 'warn').length;
      setMsg(`Operational validation complete: ${p} pass, ${f} fail, ${w} warn`);
    }
    await fetchHistory();
    setRunning(null);
  };

  const runStage = async (stage: string) => {
    setRunning(stage); setMsg('');
    const j = await post({ action: 'run-stage', stage });
    if (j?.checks) {
      const map = { ...results };
      for (const c of j.checks) map[c.key] = c;
      setResults(map);
      setMsg(`${STAGE_LABELS[stage]} checks complete`);
    }
    await fetchHistory();
    setRunning(null);
  };

  const doSignoff = async (key: string) => {
    const notes = prompt('Optional notes for signoff:');
    const j = await post({ action: 'manual-signoff', key, notes: notes || undefined });
    if (j?.signoff) {
      setSignoffs(prev => prev.map(s => s.key === key ? j.signoff : s));
      setMsg(`Signed off: ${j.signoff.title}`);
    }
  };

  const navLinks = [
    { href: '/admin/system/validation-center', label: 'Validation Center' },
    { href: '/admin/system/security-audit', label: 'Security Audit' },
    { href: '/admin/system/authorization-audit', label: 'Authorization Audit' },
    { href: '/admin/system/end-to-end-validation', label: 'E2E Validation', active: true },
  ];

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading end-to-end validation...</div>;

  const totalChecks = checks.length;
  const ranChecks = Object.keys(results).length;
  const passCount = Object.values(results).filter(r => r.status === 'pass').length;
  const failCount = Object.values(results).filter(r => r.status === 'fail').length;
  const warnCount = Object.values(results).filter(r => r.status === 'warn').length;
  const manualDone = signoffs.filter(s => s.confirmedBy).length;

  const stages = ['forecasting', 'market_generation', 'signals_candidates', 'execution', 'post_trade', 'operations', 'governance_launch'];

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {navLinks.map(l => (
          <a key={l.href} href={l.href} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none', background: l.active ? '#6366f1' : '#334155', color: '#fff' }}>{l.label}</a>
        ))}
      </div>

      <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>End-to-End Operational Validation</h1>
      <p style={{ margin: '0 0 20px', fontSize: 14, color: '#94a3b8' }}>
        Structured validation of the full platform workflow — forecast through settlement and launch readiness.
      </p>

      {msg && <div style={{ ...card, background: msg.includes('fail') || msg.includes('Error') ? '#7f1d1d' : '#1e3a2f', padding: 12, fontSize: 13, marginBottom: 16 }}>{msg}</div>}

      <div style={grid4}>
        <div style={card}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Automated Checks</div><div style={{ fontSize: 24, fontWeight: 700 }}>{totalChecks}</div></div>
        <div style={card}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Checks Run</div><div style={{ fontSize: 24, fontWeight: 700 }}>{ranChecks}</div></div>
        <div style={card}><div style={{ fontSize: 11, color: '#22c55e', marginBottom: 4 }}>Pass</div><div style={{ fontSize: 24, fontWeight: 700, color: '#22c55e' }}>{passCount}</div></div>
        <div style={card}><div style={{ fontSize: 11, color: '#ef4444', marginBottom: 4 }}>Fail</div><div style={{ fontSize: 24, fontWeight: 700, color: '#ef4444' }}>{failCount}</div></div>
        <div style={card}><div style={{ fontSize: 11, color: '#f59e0b', marginBottom: 4 }}>Warn</div><div style={{ fontSize: 24, fontWeight: 700, color: '#f59e0b' }}>{warnCount}</div></div>
        <div style={card}><div style={{ fontSize: 11, color: '#8b5cf6', marginBottom: 4 }}>Manual Signoffs</div><div style={{ fontSize: 24, fontWeight: 700 }}>{manualDone}/{manualItems.length}</div></div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <button style={{ ...btn('#22c55e'), padding: '10px 24px', fontSize: 14 }} onClick={runAll} disabled={running !== null}>
          {running === 'all' ? 'Running Operational Validation...' : 'Run Operational Validation'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {(['checks', 'manual', 'history'] as const).map(t => (
          <button key={t} onClick={() => { setTab(t); if (t === 'history') fetchHistory(); }} style={{ ...btn(tab === t ? '#6366f1' : '#334155'), padding: '8px 18px', fontSize: 13 }}>
            {t === 'checks' ? 'Workflow Checks' : t === 'manual' ? 'Manual Signoffs' : 'History'}
          </button>
        ))}
      </div>

      {tab === 'checks' && stages.map(stage => {
        const stageChecks = checks.filter(c => c.stage === stage);
        if (stageChecks.length === 0) return null;
        return (
          <div key={stage} style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{STAGE_LABELS[stage]}</h3>
              <button style={btn('#6366f1')} onClick={() => runStage(stage)} disabled={running !== null}>
                {running === stage ? 'Running...' : 'Run Stage'}
              </button>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Check</th><th style={th}>Status</th><th style={th}>Depth</th><th style={th}>Summary</th><th style={th}>Duration</th></tr></thead>
              <tbody>
                {stageChecks.map(c => {
                  const r = results[c.key];
                  const st = r?.status || 'not_run';
                  const dp = r?.verificationDepth || 'automated';
                  return (
                    <tr key={c.key}>
                      <td style={td}><div style={{ fontWeight: 600, fontSize: 13 }}>{c.title}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>{c.description}</div></td>
                      <td style={td}><span style={badge(statusColor[st] || '#64748b')}>{st.toUpperCase().replace('_', ' ')}</span></td>
                      <td style={td}><span style={badge(depthColor[dp] || '#64748b')}>{dp.replace('_', ' ')}</span></td>
                      <td style={td}><span style={{ fontSize: 12, color: st === 'fail' ? '#fca5a5' : '#cbd5e1' }}>{r?.summary || '—'}</span></td>
                      <td style={td}><span style={{ fontSize: 12, color: '#94a3b8' }}>{r?.durationMs != null ? `${r.durationMs}ms` : '—'}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}

      {tab === 'manual' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Manual Operator Signoffs</h3>
          <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>These items require manual operator review and confirmation. They are clearly marked as operator-confirmed, not system-verified.</p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Item</th><th style={th}>Status</th><th style={th}>Confirmed By</th><th style={th}>Time</th><th style={th}>Notes</th><th style={th}>Action</th></tr></thead>
            <tbody>
              {signoffs.map(s => (
                <tr key={s.key}>
                  <td style={td}><span style={{ fontWeight: 600 }}>{s.title}</span></td>
                  <td style={td}>{s.confirmedBy ? <span style={badge('#22c55e')}>CONFIRMED</span> : <span style={badge('#8b5cf6')}>PENDING</span>}</td>
                  <td style={td}><span style={{ fontSize: 12, color: '#94a3b8' }}>{s.confirmedBy || '—'}</span></td>
                  <td style={td}><span style={{ fontSize: 11, color: '#64748b' }}>{s.confirmedAt ? new Date(s.confirmedAt).toLocaleString() : '—'}</span></td>
                  <td style={td}><span style={{ fontSize: 12, color: '#cbd5e1' }}>{s.notes || '—'}</span></td>
                  <td style={td}><button style={btn(s.confirmedBy ? '#334155' : '#8b5cf6')} onClick={() => doSignoff(s.key)}>{s.confirmedBy ? 'Re-confirm' : 'Confirm'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'history' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Validation Run History</h3>
          {history.length === 0 ? (
            <div style={{ color: '#64748b', padding: 20, textAlign: 'center' }}>No validation runs yet.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Time</th><th style={th}>Stage</th><th style={th}>Check</th><th style={th}>Status</th><th style={th}>Depth</th><th style={th}>Summary</th></tr></thead>
              <tbody>
                {history.map(r => (
                  <tr key={r.id}>
                    <td style={td}><span style={{ fontSize: 11, color: '#64748b' }}>{new Date(r.createdAt).toLocaleString()}</span></td>
                    <td style={td}><span style={{ fontSize: 12 }}>{STAGE_LABELS[r.stage] || r.stage}</span></td>
                    <td style={td}><span style={{ fontSize: 12 }}>{r.checkKey}</span></td>
                    <td style={td}><span style={badge(statusColor[r.status] || '#64748b')}>{r.status.toUpperCase()}</span></td>
                    <td style={td}><span style={badge(depthColor[r.verificationDepth] || '#64748b')}>{r.verificationDepth.replace('_', ' ')}</span></td>
                    <td style={td}><span style={{ fontSize: 12, color: '#cbd5e1' }}>{r.summary}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

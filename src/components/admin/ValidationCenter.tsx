import React, { useEffect, useState } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface ValidationCheck {
  key: string;
  title: string;
  description: string;
  category: 'engineering' | 'trading' | 'operator' | 'launch';
  status: 'pass' | 'fail' | 'warn' | 'not_run';
  summary: string;
  durationMs?: number;
  lastRun?: string;
}

interface ValidationRun {
  id: string;
  createdAt: string;
  category: string;
  checkName: string;
  status: 'pass' | 'fail' | 'warn';
  summary: string;
}

interface CheckDef {
  key: string;
  title: string;
  description: string;
}

interface Definitions {
  engineering: CheckDef[];
  trading: CheckDef[];
  operator: CheckDef[];
  launch: CheckDef[];
}

/* ------------------------------------------------------------------ */
/*  Styles                                                              */
/* ------------------------------------------------------------------ */

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({ padding: '5px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (color: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: color, color: '#fff' });

const statusColor: Record<string, string> = {
  pass: '#22c55e',
  fail: '#ef4444',
  warn: '#f59e0b',
  not_run: '#64748b',
};

const categoryLabel: Record<string, string> = {
  engineering: 'Engineering Quality',
  trading: 'Trading Quality',
  operator: 'Operator Workflow',
  launch: 'Launch Readiness',
};

const categoryIcon: Record<string, string> = {
  engineering: '\u2699\uFE0F',
  trading: '\uD83D\uDCC8',
  operator: '\uD83D\uDC77',
  launch: '\uD83D\uDE80',
};

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function ValidationCenter() {
  const [definitions, setDefinitions] = useState<Definitions | null>(null);
  const [results, setResults] = useState<Record<string, ValidationCheck>>({});
  const [history, setHistory] = useState<ValidationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState<'checks' | 'history'>('checks');

  const fetchOverview = async () => {
    try {
      const res = await fetch('/api/admin/system/validation');
      if (res.ok) {
        const d = await res.json();
        setDefinitions(d.definitions || null);
        setHistory(d.recentHistory || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/admin/system/validation?action=history&limit=100');
      if (res.ok) {
        const d = await res.json();
        setHistory(d.runs || []);
      }
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchOverview(); }, []);

  const post = async (body: any) => {
    setMsg('');
    try {
      const res = await fetch('/api/admin/system/validation', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) { setMsg(j.error || 'Error'); return null; }
      return j;
    } catch (e: any) { setMsg(e.message); return null; }
  };

  const runAll = async () => {
    setRunning('all');
    setMsg('');
    const j = await post({ action: 'run-all' });
    if (j?.checks) {
      const map: Record<string, ValidationCheck> = {};
      for (const c of j.checks) map[c.key] = c;
      setResults(map);
      const pass = j.checks.filter((c: ValidationCheck) => c.status === 'pass').length;
      const fail = j.checks.filter((c: ValidationCheck) => c.status === 'fail').length;
      const warn = j.checks.filter((c: ValidationCheck) => c.status === 'warn').length;
      setMsg(`All checks complete: ${pass} pass, ${fail} fail, ${warn} warn`);
    }
    await fetchHistory();
    setRunning(null);
  };

  const runCategory = async (cat: string) => {
    setRunning(cat);
    setMsg('');
    const j = await post({ action: 'run-category', category: cat });
    if (j?.checks) {
      const map = { ...results };
      for (const c of j.checks) map[c.key] = c;
      setResults(map);
      setMsg(`${categoryLabel[cat]} checks complete`);
    }
    await fetchHistory();
    setRunning(null);
  };

  const runSingle = async (key: string) => {
    setRunning(key);
    const j = await post({ action: 'run-check', key });
    if (j?.check) {
      setResults(prev => ({ ...prev, [key]: j.check }));
    }
    await fetchHistory();
    setRunning(null);
  };

  const navLinks = [
    { href: '/admin/launch-readiness', label: 'Launch Readiness' },
    { href: '/admin/performance', label: 'Performance' },
    { href: '/admin/compliance', label: 'Compliance' },
    { href: '/admin/system/validation-center', label: 'Validation Center', active: true },
  ];

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading validation center...</div>;
  if (!definitions) return <div style={{ color: '#ef4444', padding: 40 }}>Failed to load validation definitions.</div>;

  /* ---- Summary stats ---- */
  const allKeys = [
    ...definitions.engineering,
    ...definitions.trading,
    ...definitions.operator,
    ...definitions.launch,
  ];
  const totalChecks = allKeys.length;
  const ranChecks = Object.keys(results).length;
  const passCount = Object.values(results).filter(r => r.status === 'pass').length;
  const failCount = Object.values(results).filter(r => r.status === 'fail').length;
  const warnCount = Object.values(results).filter(r => r.status === 'warn').length;

  const renderSection = (category: string, checks: CheckDef[]) => (
    <div key={category} style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
          {categoryIcon[category]} {categoryLabel[category]}
        </h3>
        <button
          style={btn('#6366f1')}
          onClick={() => runCategory(category)}
          disabled={running !== null}
        >
          {running === category ? 'Running...' : `Run ${categoryLabel[category]}`}
        </button>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Check</th>
            <th style={th}>Status</th>
            <th style={th}>Summary</th>
            <th style={th}>Duration</th>
            <th style={th}>Last Run</th>
            <th style={th}>Action</th>
          </tr>
        </thead>
        <tbody>
          {checks.map(c => {
            const r = results[c.key];
            const st = r?.status || 'not_run';
            return (
              <tr key={c.key}>
                <td style={td}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{c.title}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{c.description}</div>
                </td>
                <td style={td}>
                  <span style={badge(statusColor[st])}>
                    {st.toUpperCase().replace('_', ' ')}
                  </span>
                </td>
                <td style={td}>
                  <span style={{ fontSize: 12, color: st === 'fail' ? '#fca5a5' : '#cbd5e1' }}>
                    {r?.summary || '—'}
                  </span>
                </td>
                <td style={td}>
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>
                    {r?.durationMs != null ? `${r.durationMs}ms` : '—'}
                  </span>
                </td>
                <td style={td}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>
                    {r?.lastRun ? new Date(r.lastRun).toLocaleString() : '—'}
                  </span>
                </td>
                <td style={td}>
                  <button
                    style={btn('#334155')}
                    onClick={() => runSingle(c.key)}
                    disabled={running !== null}
                  >
                    {running === c.key ? '...' : 'Run'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      {/* Nav */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {navLinks.map(l => (
          <a key={l.href} href={l.href} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none', background: l.active ? '#6366f1' : '#334155', color: '#fff' }}>{l.label}</a>
        ))}
      </div>

      <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Validation Center</h1>
      <p style={{ margin: '0 0 20px', fontSize: 14, color: '#94a3b8' }}>
        Platform-wide validation dashboard — run safe, non-destructive checks across engineering, trading, operator, and launch systems.
      </p>

      {msg && <div style={{ ...card, background: msg.includes('fail') || msg.includes('Error') ? '#7f1d1d' : '#1e3a2f', padding: 12, fontSize: 13, marginBottom: 16 }}>{msg}</div>}

      {/* Summary cards */}
      <div style={grid4}>
        <div style={card}>
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Total Checks</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{totalChecks}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Checks Run</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{ranChecks}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 11, color: '#22c55e', marginBottom: 4 }}>Pass</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#22c55e' }}>{passCount}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 4 }}>Fail</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#ef4444' }}>{failCount}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 11, color: '#f59e0b', marginBottom: 4 }}>Warn</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#f59e0b' }}>{warnCount}</div>
        </div>
      </div>

      {/* Run All button */}
      <div style={{ marginBottom: 20 }}>
        <button
          style={{ ...btn('#22c55e'), padding: '10px 24px', fontSize: 14 }}
          onClick={runAll}
          disabled={running !== null}
        >
          {running === 'all' ? 'Running All Safe Checks...' : 'Run All Safe Checks'}
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {(['checks', 'history'] as const).map(t => (
          <button key={t} onClick={() => { setTab(t); if (t === 'history') fetchHistory(); }} style={{ ...btn(tab === t ? '#6366f1' : '#334155'), padding: '8px 18px', fontSize: 13 }}>
            {t === 'checks' ? 'Validation Checks' : 'Run History'}
          </button>
        ))}
      </div>

      {/* Checks tab */}
      {tab === 'checks' && (
        <div>
          {renderSection('engineering', definitions.engineering)}
          {renderSection('trading', definitions.trading)}
          {renderSection('operator', definitions.operator)}
          {renderSection('launch', definitions.launch)}
        </div>
      )}

      {/* History tab */}
      {tab === 'history' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Validation Run History</h3>
          {history.length === 0 ? (
            <div style={{ color: '#64748b', padding: 20, textAlign: 'center' }}>
              No validation runs recorded yet. Run checks to see history.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Time</th>
                  <th style={th}>Category</th>
                  <th style={th}>Check</th>
                  <th style={th}>Status</th>
                  <th style={th}>Summary</th>
                </tr>
              </thead>
              <tbody>
                {history.map(r => (
                  <tr key={r.id}>
                    <td style={td}><span style={{ fontSize: 11, color: '#64748b' }}>{new Date(r.createdAt).toLocaleString()}</span></td>
                    <td style={td}><span style={{ fontSize: 12 }}>{categoryLabel[r.category] || r.category}</span></td>
                    <td style={td}><span style={{ fontSize: 12 }}>{r.checkName}</span></td>
                    <td style={td}><span style={badge(statusColor[r.status] || '#64748b')}>{r.status.toUpperCase()}</span></td>
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

import React, { useEffect, useState } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface IntegrityCheck {
  key: string; domain: string; title: string; status: string;
  depth: string; summary: string; durationMs?: number; lastRun?: string;
}
interface DomainDef { domain: string; label: string; indexKey: string; freshnessThresholdHours: number; }
interface ScanRecord { id: string; createdAt: string; domain: string; checkName: string; status: string; summary: string; }

/* ------------------------------------------------------------------ */
/*  Styles                                                              */
/* ------------------------------------------------------------------ */

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({ padding: '5px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (color: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: color, color: '#fff' });

const statusColor: Record<string, string> = { pass: '#22c55e', fail: '#ef4444', warn: '#f59e0b', not_run: '#64748b' };
const depthColor: Record<string, string> = { integrity_verified: '#22c55e', freshness_warning: '#f59e0b', limited_coverage: '#64748b', manual_review: '#8b5cf6' };

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function DataIntegrity() {
  const [domains, setDomains] = useState<DomainDef[]>([]);
  const [results, setResults] = useState<Record<string, IntegrityCheck>>({});
  const [history, setHistory] = useState<ScanRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState<'checks' | 'history'>('checks');

  const fetchOverview = async () => {
    try {
      const res = await fetch('/api/admin/system/data-integrity');
      if (res.ok) { const d = await res.json(); setDomains(d.domains || []); setHistory(d.recentHistory || []); }
    } catch {}
    setLoading(false);
  };

  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/admin/system/data-integrity?action=history&limit=100');
      if (res.ok) { const d = await res.json(); setHistory(d.records || []); }
    } catch {}
  };

  useEffect(() => { fetchOverview(); }, []);

  const post = async (body: any) => {
    setMsg('');
    try {
      const res = await fetch('/api/admin/system/data-integrity', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) { setMsg(j.error || 'Error'); return null; }
      return j;
    } catch (e: any) { setMsg(e.message); return null; }
  };

  const scanAll = async () => {
    setRunning('all'); setMsg('');
    const j = await post({ action: 'scan-all' });
    if (j?.checks) {
      const map: Record<string, IntegrityCheck> = {};
      for (const c of j.checks) map[c.key] = c;
      setResults(map);
      const p = j.checks.filter((c: IntegrityCheck) => c.status === 'pass').length;
      const f = j.checks.filter((c: IntegrityCheck) => c.status === 'fail').length;
      const w = j.checks.filter((c: IntegrityCheck) => c.status === 'warn').length;
      setMsg(`Integrity scan complete: ${p} pass, ${f} fail, ${w} warn`);
    }
    await fetchHistory();
    setRunning(null);
  };

  const scanDomain = async (domain: string) => {
    setRunning(domain); setMsg('');
    const j = await post({ action: 'scan-domain', domain });
    if (j?.checks) {
      const map = { ...results };
      for (const c of j.checks) map[c.key] = c;
      setResults(map);
      setMsg(`${domains.find(d => d.domain === domain)?.label || domain} scan complete`);
    }
    await fetchHistory();
    setRunning(null);
  };

  const navLinks = [
    { href: '/admin/system/validation-center', label: 'Validation' },
    { href: '/admin/system/end-to-end-validation', label: 'E2E' },
    { href: '/admin/system/data-integrity', label: 'Data Integrity', active: true },
  ];

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading data integrity dashboard...</div>;

  const allChecks = Object.values(results);
  const passCount = allChecks.filter(c => c.status === 'pass').length;
  const failCount = allChecks.filter(c => c.status === 'fail').length;
  const warnCount = allChecks.filter(c => c.status === 'warn').length;

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {navLinks.map(l => (
          <a key={l.href} href={l.href} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none', background: l.active ? '#6366f1' : '#334155', color: '#fff' }}>{l.label}</a>
        ))}
      </div>

      <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Data Integrity & Freshness</h1>
      <p style={{ margin: '0 0 20px', fontSize: 14, color: '#94a3b8' }}>
        Validate that operational data is present, internally consistent, and reasonably fresh across all platform domains.
      </p>

      {msg && <div style={{ ...card, background: msg.includes('fail') || msg.includes('Error') ? '#7f1d1d' : '#1e3a2f', padding: 12, fontSize: 13, marginBottom: 16 }}>{msg}</div>}

      <div style={grid4}>
        <div style={card}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Domains</div><div style={{ fontSize: 24, fontWeight: 700 }}>{domains.length}</div></div>
        <div style={card}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Checks Run</div><div style={{ fontSize: 24, fontWeight: 700 }}>{allChecks.length}</div></div>
        <div style={card}><div style={{ fontSize: 11, color: '#22c55e', marginBottom: 4 }}>Pass</div><div style={{ fontSize: 24, fontWeight: 700, color: '#22c55e' }}>{passCount}</div></div>
        <div style={card}><div style={{ fontSize: 11, color: '#ef4444', marginBottom: 4 }}>Fail</div><div style={{ fontSize: 24, fontWeight: 700, color: '#ef4444' }}>{failCount}</div></div>
        <div style={card}><div style={{ fontSize: 11, color: '#f59e0b', marginBottom: 4 }}>Warn</div><div style={{ fontSize: 24, fontWeight: 700, color: '#f59e0b' }}>{warnCount}</div></div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <button style={{ ...btn('#22c55e'), padding: '10px 24px', fontSize: 14 }} onClick={scanAll} disabled={running !== null}>
          {running === 'all' ? 'Scanning All Domains...' : 'Run Full Integrity Scan'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {(['checks', 'history'] as const).map(t => (
          <button key={t} onClick={() => { setTab(t); if (t === 'history') fetchHistory(); }} style={{ ...btn(tab === t ? '#6366f1' : '#334155'), padding: '8px 18px', fontSize: 13 }}>
            {t === 'checks' ? 'Integrity Checks' : 'Scan History'}
          </button>
        ))}
      </div>

      {tab === 'checks' && domains.map(d => {
        const domainChecks = allChecks.filter(c => c.domain === d.domain);
        return (
          <div key={d.domain} style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{d.label}</h3>
                <span style={{ fontSize: 11, color: '#64748b' }}>Index: {d.indexKey} | Freshness threshold: {d.freshnessThresholdHours}h</span>
              </div>
              <button style={btn('#6366f1')} onClick={() => scanDomain(d.domain)} disabled={running !== null}>
                {running === d.domain ? 'Scanning...' : 'Scan Domain'}
              </button>
            </div>
            {domainChecks.length === 0 ? (
              <div style={{ color: '#64748b', padding: 12, textAlign: 'center', fontSize: 13 }}>No results yet. Click "Scan Domain" or "Run Full Integrity Scan" to check.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>Check</th><th style={th}>Status</th><th style={th}>Depth</th><th style={th}>Summary</th><th style={th}>Duration</th></tr></thead>
                <tbody>
                  {domainChecks.map(c => (
                    <tr key={c.key}>
                      <td style={td}><span style={{ fontWeight: 600, fontSize: 13 }}>{c.title}</span></td>
                      <td style={td}><span style={badge(statusColor[c.status] || '#64748b')}>{c.status.toUpperCase()}</span></td>
                      <td style={td}><span style={badge(depthColor[c.depth] || '#64748b')}>{c.depth.replace(/_/g, ' ')}</span></td>
                      <td style={td}><span style={{ fontSize: 12, color: c.status === 'fail' ? '#fca5a5' : '#cbd5e1' }}>{c.summary}</span></td>
                      <td style={td}><span style={{ fontSize: 12, color: '#94a3b8' }}>{c.durationMs != null ? `${c.durationMs}ms` : '—'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}

      {tab === 'history' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Scan History</h3>
          {history.length === 0 ? (
            <div style={{ color: '#64748b', padding: 20, textAlign: 'center' }}>No scan history yet. Run a scan to see results.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Time</th><th style={th}>Domain</th><th style={th}>Check</th><th style={th}>Status</th><th style={th}>Summary</th></tr></thead>
              <tbody>
                {history.map(r => (
                  <tr key={r.id}>
                    <td style={td}><span style={{ fontSize: 11, color: '#64748b' }}>{new Date(r.createdAt).toLocaleString()}</span></td>
                    <td style={td}><span style={{ fontSize: 12 }}>{r.domain}</span></td>
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

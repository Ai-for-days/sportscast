import React, { useEffect, useState } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface SensitiveAction {
  key: string;
  route: string;
  method: string;
  actionName: string;
  description: string;
  sensitivity: string;
  expectedProtection: string;
  actualProtection: string;
  enforcement: string;
  hardenedInStep54: boolean;
  notes: string;
}

interface Summary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  enforced: number;
  partiallyEnforced: number;
  expectedNotEnforced: number;
  hardenedInStep54: number;
  deferred: number;
}

interface AuditData {
  actions: SensitiveAction[];
  summary: Summary;
  auditCompletedAt: string;
  notes: string[];
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

const sensitivityColor: Record<string, string> = { critical: '#ef4444', high: '#f59e0b', medium: '#3b82f6' };
const enforcementColor: Record<string, string> = { enforced: '#22c55e', partially_enforced: '#f59e0b', expected_not_enforced: '#ef4444' };

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function AuthorizationAudit() {
  const [data, setData] = useState<AuditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'overview' | 'actions' | 'hardened' | 'deferred' | 'notes'>('overview');

  useEffect(() => {
    fetch('/api/admin/system/authorization-audit')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const navLinks = [
    { href: '/admin/security', label: 'Security' },
    { href: '/admin/system/security-audit', label: 'Security Audit' },
    { href: '/admin/system/authorization-audit', label: 'Authorization Audit', active: true },
  ];

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading authorization audit...</div>;
  if (!data) return <div style={{ color: '#ef4444', padding: 40 }}>Failed to load authorization audit data.</div>;

  const { summary: s } = data;
  const hardened = data.actions.filter(a => a.hardenedInStep54);
  const deferred = data.actions.filter(a => !a.hardenedInStep54);

  const renderActionTable = (actions: SensitiveAction[]) => (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={th}>Action</th>
          <th style={th}>Route</th>
          <th style={th}>Sensitivity</th>
          <th style={th}>Protection</th>
          <th style={th}>Status</th>
          <th style={th}>Notes</th>
        </tr>
      </thead>
      <tbody>
        {actions.map(a => (
          <tr key={a.key}>
            <td style={td}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{a.description}</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>{a.method} {a.actionName}</div>
            </td>
            <td style={td}><code style={{ fontSize: 11 }}>{a.route}</code></td>
            <td style={td}><span style={badge(sensitivityColor[a.sensitivity] || '#64748b')}>{a.sensitivity.toUpperCase()}</span></td>
            <td style={td}><span style={{ fontSize: 11, color: '#cbd5e1' }}>{a.actualProtection}</span></td>
            <td style={td}><span style={badge(enforcementColor[a.enforcement] || '#64748b')}>{a.enforcement.replace(/_/g, ' ')}</span></td>
            <td style={td}><span style={{ fontSize: 11, color: '#94a3b8' }}>{a.notes}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {navLinks.map(l => (
          <a key={l.href} href={l.href} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none', background: l.active ? '#6366f1' : '#334155', color: '#fff' }}>{l.label}</a>
        ))}
      </div>

      <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Authorization Audit</h1>
      <p style={{ margin: '0 0 20px', fontSize: 14, color: '#94a3b8' }}>
        Sensitive action authorization review — Step 54 hardening results.
      </p>

      <div style={grid4}>
        <div style={card}>
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Total Actions</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{s.total}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 4 }}>Critical</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#ef4444' }}>{s.critical}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 11, color: '#f59e0b', marginBottom: 4 }}>High</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#f59e0b' }}>{s.high}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 11, color: '#3b82f6', marginBottom: 4 }}>Medium</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#3b82f6' }}>{s.medium}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 11, color: '#22c55e', marginBottom: 4 }}>Enforced</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#22c55e' }}>{s.enforced}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 11, color: '#f59e0b', marginBottom: 4 }}>Hardened (Step 54)</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{s.hardenedInStep54}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Deferred</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{s.deferred}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {(['overview', 'actions', 'hardened', 'deferred', 'notes'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ ...btn(tab === t ? '#6366f1' : '#334155'), padding: '8px 18px', fontSize: 13 }}>
            {t === 'overview' ? 'Overview' : t === 'actions' ? 'All Actions' : t === 'hardened' ? 'Hardened' : t === 'deferred' ? 'Deferred' : 'Notes'}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Summary</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <tr><td style={td}>Total sensitive actions reviewed</td><td style={td}>{s.total}</td></tr>
              <tr><td style={td}>Critical actions</td><td style={td}>{s.critical}</td></tr>
              <tr><td style={td}>High-risk actions</td><td style={td}>{s.high}</td></tr>
              <tr><td style={td}>Medium-risk actions</td><td style={td}>{s.medium}</td></tr>
              <tr><td style={td}>Fully enforced</td><td style={td}>{s.enforced}</td></tr>
              <tr><td style={td}>Hardened in Step 54</td><td style={td}>{s.hardenedInStep54}</td></tr>
              <tr><td style={td}>Already enforced (deferred from Step 54)</td><td style={td}>{s.deferred}</td></tr>
            </tbody>
          </table>
        </div>
      )}

      {tab === 'actions' && <div style={card}><h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>All Sensitive Actions</h3>{renderActionTable(data.actions)}</div>}
      {tab === 'hardened' && <div style={card}><h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Hardened in Step 54</h3>{hardened.length === 0 ? <div style={{ color: '#64748b', padding: 20 }}>No actions hardened.</div> : renderActionTable(hardened)}</div>}
      {tab === 'deferred' && <div style={card}><h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Deferred (Already Enforced at Lib Level)</h3>{deferred.length === 0 ? <div style={{ color: '#64748b', padding: 20 }}>No deferred actions.</div> : renderActionTable(deferred)}</div>}

      {tab === 'notes' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Audit Notes</h3>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {data.notes.map((n, i) => (
              <li key={i} style={{ marginBottom: 8, fontSize: 13, color: '#cbd5e1' }}>{n}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

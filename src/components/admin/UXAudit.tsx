import React, { useEffect, useState } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface PageReview { page: string; path: string; status: string; fix: string; }
interface FixCategory { category: string; count: number; severity: string; description: string; }
interface AuditData {
  pagesReviewed: number; pagesImproved: number; pagesAlreadyConsistent: number;
  pages: PageReview[]; fixCategories: FixCategory[]; remainingDebt: string[];
  auditCompletedAt: string;
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

const statusColor: Record<string, string> = { improved: '#22c55e', reviewed: '#3b82f6' };

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function UXAudit() {
  const [data, setData] = useState<AuditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'pages' | 'fixes' | 'debt'>('pages');

  useEffect(() => {
    fetch('/api/admin/system/ux-audit')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const navLinks = [
    { href: '/admin/system/validation-center', label: 'Validation' },
    { href: '/admin/system/security-audit', label: 'Security' },
    { href: '/admin/system/authorization-audit', label: 'Authorization' },
    { href: '/admin/system/end-to-end-validation', label: 'E2E' },
    { href: '/admin/system/ux-audit', label: 'UX Audit', active: true },
  ];

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading UX audit...</div>;
  if (!data) return <div style={{ color: '#ef4444', padding: 40 }}>Failed to load UX audit data.</div>;

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {navLinks.map(l => (
          <a key={l.href} href={l.href} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none', background: l.active ? '#6366f1' : '#334155', color: '#fff' }}>{l.label}</a>
        ))}
      </div>

      <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>UX Consistency Audit</h1>
      <p style={{ margin: '0 0 20px', fontSize: 14, color: '#94a3b8' }}>
        Admin UI consistency review — page structure, descriptions, states, and workflow clarity.
      </p>

      <div style={grid4}>
        <div style={card}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Pages Reviewed</div><div style={{ fontSize: 24, fontWeight: 700 }}>{data.pagesReviewed}</div></div>
        <div style={card}><div style={{ fontSize: 11, color: '#22c55e', marginBottom: 4 }}>Pages Improved</div><div style={{ fontSize: 24, fontWeight: 700, color: '#22c55e' }}>{data.pagesImproved}</div></div>
        <div style={card}><div style={{ fontSize: 11, color: '#3b82f6', marginBottom: 4 }}>Already Consistent</div><div style={{ fontSize: 24, fontWeight: 700, color: '#3b82f6' }}>{data.pagesAlreadyConsistent}</div></div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {(['pages', 'fixes', 'debt'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ ...btn(tab === t ? '#6366f1' : '#334155'), padding: '8px 18px', fontSize: 13 }}>
            {t === 'pages' ? 'Pages Reviewed' : t === 'fixes' ? 'Fix Categories' : 'Remaining Debt'}
          </button>
        ))}
      </div>

      {tab === 'pages' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Pages Reviewed</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Page</th><th style={th}>Path</th><th style={th}>Status</th><th style={th}>Notes</th></tr></thead>
            <tbody>
              {data.pages.map(p => (
                <tr key={p.path}>
                  <td style={td}><span style={{ fontWeight: 600 }}>{p.page}</span></td>
                  <td style={td}><code style={{ fontSize: 11 }}>{p.path}</code></td>
                  <td style={td}><span style={badge(statusColor[p.status] || '#64748b')}>{p.status.toUpperCase()}</span></td>
                  <td style={td}><span style={{ fontSize: 12, color: '#cbd5e1' }}>{p.fix}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'fixes' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Fix Categories</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Category</th><th style={th}>Fixes</th><th style={th}>Description</th></tr></thead>
            <tbody>
              {data.fixCategories.map(f => (
                <tr key={f.category}>
                  <td style={td}><span style={{ fontWeight: 600 }}>{f.category}</span></td>
                  <td style={td}><span style={{ fontWeight: 700 }}>{f.count}</span></td>
                  <td style={td}><span style={{ fontSize: 12, color: '#cbd5e1' }}>{f.description}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'debt' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Remaining UX Debt</h3>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {data.remainingDebt.map((d, i) => (
              <li key={i} style={{ marginBottom: 8, fontSize: 13, color: '#cbd5e1' }}>{d}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

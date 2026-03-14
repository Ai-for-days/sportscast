import React, { useEffect, useState } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface SensitiveAction {
  route: string;
  action: string;
  risk: string;
  protection: string;
}

interface AuditSummary {
  totalAdminPages: number;
  totalAdminApis: number;
  intentionallyPublicRoutes: number;
  pagesReviewed: number;
  pagesAlreadyProtected: number;
  pagesFixed: number;
  apisReviewed: number;
  apisAlreadyProtected: number;
  apisFixed: number;
  routesFixedInStep53: string[];
  sensitiveActionsIdentified: number;
  sensitiveActions: SensitiveAction[];
  permissionMismatchesFound: number;
  auditLoggingGapsFixed: number;
  securityStatus: string;
  auditCompletedAt: string;
  notes: string[];
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

const riskColor: Record<string, string> = {
  critical: '#ef4444',
  high: '#f59e0b',
  medium: '#3b82f6',
  low: '#22c55e',
};

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function SecurityAudit() {
  const [data, setData] = useState<AuditSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'overview' | 'fixes' | 'sensitive' | 'notes'>('overview');

  useEffect(() => {
    fetch('/api/admin/system/security-audit')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const navLinks = [
    { href: '/admin/security', label: 'Security' },
    { href: '/admin/compliance', label: 'Compliance' },
    { href: '/admin/system/validation-center', label: 'Validation Center' },
    { href: '/admin/system/security-audit', label: 'Security Audit', active: true },
  ];

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading security audit...</div>;
  if (!data) return <div style={{ color: '#ef4444', padding: 40 }}>Failed to load security audit data.</div>;

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      {/* Nav */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {navLinks.map(l => (
          <a key={l.href} href={l.href} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none', background: l.active ? '#6366f1' : '#334155', color: '#fff' }}>{l.label}</a>
        ))}
      </div>

      <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Security Audit</h1>
      <p style={{ margin: '0 0 20px', fontSize: 14, color: '#94a3b8' }}>
        Platform-wide admin API security and permissions audit — Step 53 hardening results.
      </p>

      {/* Status badge */}
      <div style={{ marginBottom: 20 }}>
        <span style={badge(data.securityStatus === 'HARDENED' ? '#22c55e' : '#3b82f6')}>
          {data.securityStatus}
        </span>
        <span style={{ marginLeft: 12, fontSize: 12, color: '#64748b' }}>
          Audit completed: {new Date(data.auditCompletedAt).toLocaleString()}
        </span>
      </div>

      {/* Summary cards */}
      <div style={grid4}>
        <div style={card}>
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Admin Pages Reviewed</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{data.pagesReviewed}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Admin APIs Reviewed</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{data.apisReviewed}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 11, color: '#22c55e', marginBottom: 4 }}>Pages Fixed</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#22c55e' }}>{data.pagesFixed}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 11, color: '#f59e0b', marginBottom: 4 }}>APIs Fixed</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#f59e0b' }}>{data.apisFixed}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 4 }}>Sensitive Actions</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{data.sensitiveActionsIdentified}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Permission Mismatches</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{data.permissionMismatchesFound}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Audit Log Gaps Fixed</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{data.auditLoggingGapsFixed}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Public Routes</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{data.intentionallyPublicRoutes}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {(['overview', 'fixes', 'sensitive', 'notes'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ ...btn(tab === t ? '#6366f1' : '#334155'), padding: '8px 18px', fontSize: 13 }}>
            {t === 'overview' ? 'Overview' : t === 'fixes' ? 'Routes Fixed' : t === 'sensitive' ? 'Sensitive Actions' : 'Notes'}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {tab === 'overview' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Audit Summary</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <tr><td style={td}>Total admin pages</td><td style={td}>{data.totalAdminPages}</td></tr>
              <tr><td style={td}>Pages already protected</td><td style={td}>{data.pagesAlreadyProtected}</td></tr>
              <tr><td style={td}>Pages fixed in Step 53</td><td style={td}>{data.pagesFixed}</td></tr>
              <tr><td style={td}>Total admin API routes</td><td style={td}>{data.totalAdminApis}</td></tr>
              <tr><td style={td}>APIs already protected</td><td style={td}>{data.apisAlreadyProtected}</td></tr>
              <tr><td style={td}>APIs fixed in Step 53</td><td style={td}>{data.apisFixed}</td></tr>
              <tr><td style={td}>Intentionally public routes</td><td style={td}>{data.intentionallyPublicRoutes} (health, login, logout)</td></tr>
              <tr><td style={td}>Sensitive actions reviewed</td><td style={td}>{data.sensitiveActionsIdentified}</td></tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Fixes tab */}
      {tab === 'fixes' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Routes Fixed in Step 53</h3>
          {data.routesFixedInStep53.length === 0 ? (
            <div style={{ color: '#64748b', padding: 20, textAlign: 'center' }}>No routes needed fixing.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>#</th>
                  <th style={th}>API Route</th>
                  <th style={th}>Fix Applied</th>
                </tr>
              </thead>
              <tbody>
                {data.routesFixedInStep53.map((r, i) => (
                  <tr key={r}>
                    <td style={td}>{i + 1}</td>
                    <td style={td}><code style={{ fontSize: 12 }}>/api/admin/{r}</code></td>
                    <td style={td}><span style={badge('#22c55e')}>requireAdmin added to GET + POST</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Sensitive Actions tab */}
      {tab === 'sensitive' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Sensitive Actions Review</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Route</th>
                <th style={th}>Action</th>
                <th style={th}>Risk</th>
                <th style={th}>Protection</th>
              </tr>
            </thead>
            <tbody>
              {data.sensitiveActions.map((a, i) => (
                <tr key={i}>
                  <td style={td}><code style={{ fontSize: 12 }}>{a.route}</code></td>
                  <td style={td}>{a.action}</td>
                  <td style={td}><span style={badge(riskColor[a.risk] || '#64748b')}>{a.risk.toUpperCase()}</span></td>
                  <td style={td}><span style={{ fontSize: 12, color: '#cbd5e1' }}>{a.protection}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Notes tab */}
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

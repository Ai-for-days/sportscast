import React, { useEffect, useState } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface HealthCheck {
  key: string;
  label: string;
  category: string;
  status: 'healthy' | 'warning' | 'critical';
  message: string;
  checkedAt: string;
  latencyMs?: number;
}

interface HealthOverview {
  healthy: number;
  warning: number;
  critical: number;
  stale: number;
  lastCheckedAt: string;
}

interface Alert {
  id: string;
  createdAt: string;
  severity: 'info' | 'warning' | 'critical';
  type: string;
  title: string;
  message: string;
  status: 'open' | 'acknowledged' | 'resolved';
  link?: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
}

interface AlertSummary {
  openCritical: number;
  openWarnings: number;
  openInfo: number;
  total: number;
}

/* ------------------------------------------------------------------ */
/*  Styles                                                              */
/* ------------------------------------------------------------------ */

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const grid5: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({
  padding: '5px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600,
});
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (color: string): React.CSSProperties => ({
  display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: color, color: '#fff',
});

const STATUS_COLORS: Record<string, string> = { healthy: '#22c55e', warning: '#eab308', critical: '#dc2626' };
const SEV_COLORS: Record<string, string> = { info: '#3b82f6', warning: '#eab308', critical: '#dc2626' };
const ALERT_STATUS_COLORS: Record<string, string> = { open: '#dc2626', acknowledged: '#eab308', resolved: '#22c55e' };

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function AlertCenter() {
  const [healthChecks, setHealthChecks] = useState<HealthCheck[]>([]);
  const [healthOverview, setHealthOverview] = useState<HealthOverview | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [summary, setSummary] = useState<AlertSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState<'overview' | 'health' | 'alerts'>('overview');

  const fetchData = async () => {
    try {
      const res = await fetch('/api/admin/alerts');
      if (res.ok) {
        const d = await res.json();
        setAlerts(d.alerts || []);
        setSummary(d.summary || null);
        setHealthChecks(d.healthChecks || []);
        setHealthOverview(d.healthOverview || null);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const post = async (body: any) => {
    setMsg('');
    try {
      const res = await fetch('/api/admin/alerts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) { setMsg(j.error || 'Error'); return; }
      setMsg('Done');
      await fetchData();
    } catch (e: any) { setMsg(e.message); }
  };

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading alert center...</div>;

  const navLinks = [
    { href: '/admin/trading-desk', label: 'Trading Desk' },
    { href: '/admin/operator-dashboard', label: 'Operator' },
    { href: '/admin/execution-control', label: 'Execution' },
    { href: '/admin/alerts', label: 'Alerts', active: true },
  ];

  const openAlerts = alerts.filter(a => a.status === 'open');
  const criticalOpen = openAlerts.filter(a => a.severity === 'critical');

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      {/* Nav */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {navLinks.map(l => (
          <a key={l.href} href={l.href} style={{
            padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none',
            background: l.active ? '#6366f1' : '#334155', color: '#fff',
          }}>{l.label}</a>
        ))}
      </div>

      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Execution Health & Alerts</h2>
      <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 16 }}>System monitoring, health checks, and operational alerts</p>

      {msg && <div style={{ ...card, background: '#1e3a5f', color: '#93c5fd', fontSize: 13 }}>{msg}</div>}

      {/* ============================================================ */}
      {/* SUMMARY CARDS                                                  */}
      {/* ============================================================ */}
      <div style={grid5}>
        {healthOverview && (
          <>
            <div style={{ ...card, borderLeft: '3px solid #22c55e' }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#22c55e' }}>{healthOverview.healthy}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Healthy</div>
            </div>
            <div style={{ ...card, borderLeft: '3px solid #eab308' }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#eab308' }}>{healthOverview.warning}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Warnings</div>
            </div>
            <div style={{ ...card, borderLeft: '3px solid #dc2626' }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#dc2626' }}>{healthOverview.critical}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Critical</div>
            </div>
          </>
        )}
        {summary && (
          <>
            <div style={card}>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{summary.openCritical + summary.openWarnings}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Open Alerts</div>
            </div>
            <div style={card}>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{healthOverview?.stale ?? 0}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Stale Systems</div>
            </div>
          </>
        )}
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button onClick={() => post({ action: 'run-health-checks' })} style={btn('#22c55e')}>Run Health Checks</button>
        <button onClick={() => post({ action: 'clear-resolved' })} style={btn('#334155')}>Clear Resolved</button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {(['overview', 'health', 'alerts'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ ...btn(tab === t ? '#6366f1' : '#334155'), textTransform: 'capitalize' }}>
            {t === 'overview' ? 'Critical Issues' : t === 'health' ? 'Health Checks' : 'All Alerts'}
          </button>
        ))}
      </div>

      {/* ============================================================ */}
      {/* CRITICAL ISSUES TAB                                            */}
      {/* ============================================================ */}
      {tab === 'overview' && (
        <div style={card}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#dc2626' }}>Open Critical Issues</h3>
          {criticalOpen.length === 0 ? (
            <p style={{ color: '#22c55e', fontSize: 13 }}>No critical issues. System looks healthy.</p>
          ) : (
            <div>
              {criticalOpen.map(a => (
                <div key={a.id} style={{ ...card, background: '#1c1917', borderLeft: '3px solid #dc2626', marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{a.title}</div>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{a.message}</div>
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{a.createdAt?.slice(0, 16).replace('T', ' ')}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => post({ action: 'acknowledge-alert', id: a.id })} style={btn('#eab308')}>Ack</button>
                      <button onClick={() => post({ action: 'resolve-alert', id: a.id })} style={btn('#22c55e')}>Resolve</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/* HEALTH CHECKS TAB                                              */}
      {/* ============================================================ */}
      {tab === 'health' && (
        <div style={card}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Health Checks</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Category</th>
                  <th style={th}>Check</th>
                  <th style={th}>Status</th>
                  <th style={th}>Message</th>
                  <th style={th}>Checked</th>
                  <th style={th}>Latency</th>
                </tr>
              </thead>
              <tbody>
                {healthChecks.map(c => (
                  <tr key={c.key}>
                    <td style={td}><span style={{ fontSize: 11, color: '#94a3b8' }}>{c.category}</span></td>
                    <td style={td}>{c.label}</td>
                    <td style={td}><span style={badge(STATUS_COLORS[c.status] || '#64748b')}>{c.status.toUpperCase()}</span></td>
                    <td style={td}>{c.message}</td>
                    <td style={td}>{c.checkedAt?.slice(11, 19)}</td>
                    <td style={td}>{c.latencyMs != null ? `${c.latencyMs}ms` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* ALL ALERTS TAB                                                 */}
      {/* ============================================================ */}
      {tab === 'alerts' && (
        <div style={card}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>All Alerts ({alerts.length})</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Severity</th>
                  <th style={th}>Title</th>
                  <th style={th}>Message</th>
                  <th style={th}>Status</th>
                  <th style={th}>Created</th>
                  <th style={th}>Link</th>
                  <th style={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map(a => (
                  <tr key={a.id}>
                    <td style={td}><span style={badge(SEV_COLORS[a.severity] || '#64748b')}>{a.severity.toUpperCase()}</span></td>
                    <td style={td}>{a.title}</td>
                    <td style={{ ...td, fontSize: 12, maxWidth: 250 }}>{a.message}</td>
                    <td style={td}><span style={badge(ALERT_STATUS_COLORS[a.status] || '#64748b')}>{a.status.toUpperCase()}</span></td>
                    <td style={td}>{a.createdAt?.slice(0, 16).replace('T', ' ')}</td>
                    <td style={td}>{a.link ? <a href={a.link} style={{ color: '#93c5fd', fontSize: 12 }}>View</a> : '—'}</td>
                    <td style={td}>
                      {a.status === 'open' && (
                        <>
                          <button onClick={() => post({ action: 'acknowledge-alert', id: a.id })} style={{ ...btn('#eab308'), marginRight: 4 }}>Ack</button>
                          <button onClick={() => post({ action: 'resolve-alert', id: a.id })} style={btn('#22c55e')}>Resolve</button>
                        </>
                      )}
                      {a.status === 'acknowledged' && (
                        <button onClick={() => post({ action: 'resolve-alert', id: a.id })} style={btn('#22c55e')}>Resolve</button>
                      )}
                      {a.status === 'resolved' && <span style={{ fontSize: 11, color: '#64748b' }}>Done</span>}
                    </td>
                  </tr>
                ))}
                {alerts.length === 0 && (
                  <tr><td colSpan={7} style={{ ...td, color: '#64748b', textAlign: 'center' }}>No alerts.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

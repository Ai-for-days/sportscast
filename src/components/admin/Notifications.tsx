import React, { useEffect, useState } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface NotifSummary {
  total: number; sent: number; failed: number; pending: number;
  criticalToday: number; configuredChannels: string[];
}
interface NotifConfig {
  notificationsEnabled: boolean; webhookUrl?: string; slackWebhookUrl?: string; emailEnabled?: boolean;
}
interface EscalationRule {
  id: string; eventType: string; severity?: string; channels: string[]; enabled: boolean;
}
interface DeliveryResult {
  channel: string; status: string; statusCode?: number; error?: string; timestamp: string;
}
interface Notif {
  id: string; createdAt: string; type: string; severity: string; title: string;
  message: string; channels: string[]; status: string; deliveryResults: DeliveryResult[];
}

/* ------------------------------------------------------------------ */
/*  Styles                                                              */
/* ------------------------------------------------------------------ */

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({ padding: '5px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const inputStyle: React.CSSProperties = { padding: '5px 8px', borderRadius: 4, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', fontSize: 13, width: '100%' };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (color: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: color, color: '#fff' });

const SEV_COLORS: Record<string, string> = { critical: '#ef4444', warning: '#f59e0b', info: '#3b82f6' };
const STATUS_COLORS: Record<string, string> = { sent: '#22c55e', failed: '#ef4444', pending: '#f59e0b', partial: '#f97316' };

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function Notifications() {
  const [summary, setSummary] = useState<NotifSummary | null>(null);
  const [config, setConfig] = useState<NotifConfig>({ notificationsEnabled: false });
  const [rules, setRules] = useState<EscalationRule[]>([]);
  const [notifications, setNotifications] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState<'overview' | 'config' | 'rules' | 'history'>('overview');
  const [viewDetail, setViewDetail] = useState<Notif | null>(null);

  // Config form
  const [cfgEnabled, setCfgEnabled] = useState(false);
  const [cfgWebhook, setCfgWebhook] = useState('');
  const [cfgSlack, setCfgSlack] = useState('');

  const fetchAll = async () => {
    try {
      const res = await fetch('/api/admin/notifications');
      if (res.ok) {
        const d = await res.json();
        setSummary(d.summary || null);
        setConfig(d.config || { notificationsEnabled: false });
        setRules(d.rules || []);
        setNotifications(d.notifications || []);
        setCfgEnabled(d.config?.notificationsEnabled || false);
        setCfgWebhook(d.config?.webhookUrl || '');
        setCfgSlack(d.config?.slackWebhookUrl || '');
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const post = async (body: any) => {
    setMsg('');
    try {
      const res = await fetch('/api/admin/notifications', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) { setMsg(j.error || 'Error'); return; }
      setMsg(j.message || 'Done');
      await fetchAll();
    } catch (e: any) { setMsg(e.message); }
  };

  const saveConfig = () => post({
    action: 'update-config',
    notificationsEnabled: cfgEnabled,
    webhookUrl: cfgWebhook || undefined,
    slackWebhookUrl: cfgSlack || undefined,
  });

  const sendTest = (channels: string[]) => post({ action: 'send-test-notification', channels });
  const retryNotif = (id: string) => post({ action: 'retry-notification', id });
  const seedRules = () => post({ action: 'seed-default-rules' });
  const toggleRule = (id: string, enabled: boolean) => post({ action: 'update-escalation-rule', id, enabled });

  const navLinks = [
    { href: '/admin/operator-dashboard', label: 'Operator' },
    { href: '/admin/alerts', label: 'Alerts' },
    { href: '/admin/operations-center', label: 'Ops Center' },
    { href: '/admin/notifications', label: 'Notifications', active: true },
  ];

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading notifications...</div>;

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      {/* Nav */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {navLinks.map(l => (
          <a key={l.href} href={l.href} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none', background: l.active ? '#6366f1' : '#334155', color: '#fff' }}>{l.label}</a>
        ))}
      </div>

      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>External Notifications</h2>
      <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 16 }}>Notification routing, escalation rules, and delivery history</p>

      {msg && <div style={{ ...card, background: '#1e3a5f', color: '#93c5fd', fontSize: 13 }}>{msg}</div>}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {(['overview', 'config', 'rules', 'history'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ ...btn(tab === t ? '#6366f1' : '#334155'), textTransform: 'capitalize' }}>{t}</button>
        ))}
      </div>

      {/* ═══════ OVERVIEW ═══════ */}
      {tab === 'overview' && summary && (
        <>
          <div style={grid4}>
            <div style={card}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.total}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Total Sent</div>
            </div>
            <div style={{ ...card, borderLeft: '3px solid #ef4444' }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.failed}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Failed</div>
            </div>
            <div style={{ ...card, borderLeft: '3px solid #f59e0b' }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.pending}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Pending</div>
            </div>
            <div style={{ ...card, borderLeft: '3px solid #ef4444' }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.criticalToday}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Critical Today</div>
            </div>
            <div style={{ ...card, borderLeft: '3px solid #3b82f6' }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.configuredChannels.length}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Channels</div>
            </div>
            <div style={{ ...card, borderLeft: `3px solid ${config.notificationsEnabled ? '#22c55e' : '#64748b'}` }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{config.notificationsEnabled ? 'ON' : 'OFF'}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Notifications</div>
            </div>
          </div>

          {/* Recent notifications */}
          <div style={card}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Recent Notifications</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>Time</th><th style={th}>Severity</th><th style={th}>Type</th><th style={th}>Title</th><th style={th}>Channels</th><th style={th}>Status</th><th style={th}>Actions</th></tr></thead>
                <tbody>
                  {notifications.slice(0, 20).map(n => (
                    <tr key={n.id}>
                      <td style={td}>{n.createdAt.slice(0, 16).replace('T', ' ')}</td>
                      <td style={td}><span style={badge(SEV_COLORS[n.severity] || '#64748b')}>{n.severity}</span></td>
                      <td style={{ ...td, fontSize: 11 }}>{n.type}</td>
                      <td style={td}>{n.title}</td>
                      <td style={td}>{n.channels.join(', ')}</td>
                      <td style={td}><span style={badge(STATUS_COLORS[n.status] || '#64748b')}>{n.status}</span></td>
                      <td style={td}>
                        <button onClick={() => setViewDetail(n)} style={{ ...btn('#6366f1'), marginRight: 4 }}>Detail</button>
                        {n.status === 'failed' && <button onClick={() => retryNotif(n.id)} style={btn('#f59e0b')}>Retry</button>}
                      </td>
                    </tr>
                  ))}
                  {notifications.length === 0 && <tr><td colSpan={7} style={{ ...td, color: '#64748b', textAlign: 'center' }}>No notifications yet</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ═══════ CONFIG ═══════ */}
      {tab === 'config' && (
        <div style={card}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Channel Configuration</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 500 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={cfgEnabled} onChange={e => setCfgEnabled(e.target.checked)} />
              <label style={{ fontSize: 13 }}>Notifications Enabled</label>
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#94a3b8' }}>Webhook URL</label>
              <input value={cfgWebhook} onChange={e => setCfgWebhook(e.target.value)} placeholder="https://..." style={inputStyle} />
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Receives JSON POST with notification payload</div>
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#94a3b8' }}>Slack Webhook URL</label>
              <input value={cfgSlack} onChange={e => setCfgSlack(e.target.value)} placeholder="https://hooks.slack.com/..." style={inputStyle} />
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Incoming webhook for Slack channel</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={saveConfig} style={btn('#6366f1')}>Save Config</button>
              <button onClick={() => sendTest(['internal_log'])} style={btn('#334155')}>Test Internal</button>
              {cfgWebhook && <button onClick={() => sendTest(['webhook'])} style={btn('#334155')}>Test Webhook</button>}
              {cfgSlack && <button onClick={() => sendTest(['slack_webhook'])} style={btn('#334155')}>Test Slack</button>}
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Channel Status</h4>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {[
                { name: 'internal_log', configured: true },
                { name: 'webhook', configured: !!cfgWebhook },
                { name: 'slack_webhook', configured: !!cfgSlack },
                { name: 'email_stub', configured: false },
              ].map(ch => (
                <div key={ch.name} style={{ ...card, margin: 0, minWidth: 140, borderLeft: `3px solid ${ch.configured ? '#22c55e' : '#64748b'}` }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{ch.name}</div>
                  <span style={badge(ch.configured ? '#22c55e' : '#64748b')}>{ch.configured ? 'configured' : 'not set'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══════ RULES ═══════ */}
      {tab === 'rules' && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600 }}>Escalation Rules ({rules.length})</h3>
            <button onClick={seedRules} style={btn('#22c55e')}>Seed Defaults</button>
          </div>
          {rules.length === 0 ? (
            <div style={{ color: '#64748b', fontSize: 13 }}>No rules. Click "Seed Defaults" to create starter escalation rules.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>Event Type</th><th style={th}>Severity</th><th style={th}>Channels</th><th style={th}>Enabled</th><th style={th}>Actions</th></tr></thead>
                <tbody>
                  {rules.map(r => (
                    <tr key={r.id}>
                      <td style={{ ...td, fontSize: 12, fontFamily: 'monospace' }}>{r.eventType}</td>
                      <td style={td}><span style={badge(SEV_COLORS[r.severity || ''] || '#64748b')}>{r.severity || '—'}</span></td>
                      <td style={td}>{r.channels.join(', ')}</td>
                      <td style={td}>{r.enabled ? <span style={{ color: '#22c55e' }}>ON</span> : <span style={{ color: '#64748b' }}>OFF</span>}</td>
                      <td style={td}>
                        <button onClick={() => toggleRule(r.id, !r.enabled)} style={btn(r.enabled ? '#64748b' : '#22c55e')}>{r.enabled ? 'Disable' : 'Enable'}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══════ HISTORY ═══════ */}
      {tab === 'history' && (
        <div style={card}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Notification History ({notifications.length})</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Time</th><th style={th}>Severity</th><th style={th}>Type</th><th style={th}>Title</th><th style={th}>Channels</th><th style={th}>Status</th><th style={th}>Actions</th></tr></thead>
              <tbody>
                {notifications.map(n => (
                  <tr key={n.id}>
                    <td style={td}>{n.createdAt.slice(0, 16).replace('T', ' ')}</td>
                    <td style={td}><span style={badge(SEV_COLORS[n.severity] || '#64748b')}>{n.severity}</span></td>
                    <td style={{ ...td, fontSize: 11 }}>{n.type}</td>
                    <td style={td}>{n.title}</td>
                    <td style={td}>{n.channels.join(', ')}</td>
                    <td style={td}><span style={badge(STATUS_COLORS[n.status] || '#64748b')}>{n.status}</span></td>
                    <td style={td}>
                      <button onClick={() => setViewDetail(n)} style={{ ...btn('#6366f1'), marginRight: 4 }}>Detail</button>
                      {(n.status === 'failed' || n.status === 'partial') && <button onClick={() => retryNotif(n.id)} style={btn('#f59e0b')}>Retry</button>}
                    </td>
                  </tr>
                ))}
                {notifications.length === 0 && <tr><td colSpan={7} style={{ ...td, color: '#64748b', textAlign: 'center' }}>No notifications</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══════ DETAIL MODAL ═══════ */}
      {viewDetail && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#1e293b', borderRadius: 12, padding: 24, maxWidth: 600, width: '95%', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 12 }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700 }}>{viewDetail.title}</h3>
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <span style={badge(SEV_COLORS[viewDetail.severity] || '#64748b')}>{viewDetail.severity}</span>
                  <span style={badge(STATUS_COLORS[viewDetail.status] || '#64748b')}>{viewDetail.status}</span>
                </div>
              </div>
              <button onClick={() => setViewDetail(null)} style={btn('#334155')}>Close</button>
            </div>

            <div style={{ fontSize: 13, marginBottom: 8 }}>{viewDetail.message}</div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>
              Type: {viewDetail.type} | Created: {viewDetail.createdAt.slice(0, 19).replace('T', ' ')}
            </div>

            <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Delivery Results</h4>
            {viewDetail.deliveryResults.length === 0 ? (
              <div style={{ color: '#64748b', fontSize: 12 }}>No delivery results</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={th}>Channel</th><th style={th}>Status</th><th style={th}>Code</th><th style={th}>Error</th><th style={th}>Time</th></tr></thead>
                  <tbody>
                    {viewDetail.deliveryResults.map((r, i) => (
                      <tr key={i}>
                        <td style={td}>{r.channel}</td>
                        <td style={td}><span style={badge(r.status === 'sent' ? '#22c55e' : '#ef4444')}>{r.status}</span></td>
                        <td style={td}>{r.statusCode || '—'}</td>
                        <td style={{ ...td, color: '#fca5a5', fontSize: 12 }}>{r.error || '—'}</td>
                        <td style={td}>{r.timestamp?.slice(11, 19)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {(viewDetail.status === 'failed' || viewDetail.status === 'partial') && (
              <div style={{ marginTop: 12 }}>
                <button onClick={() => { retryNotif(viewDetail.id); setViewDetail(null); }} style={btn('#f59e0b')}>Retry Failed Channels</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

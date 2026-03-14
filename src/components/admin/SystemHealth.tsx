import React, { useEffect, useState } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface SubsystemHealth {
  subsystem: string; operation: string; lastRuntime: number | null;
  avgRuntime: number; p95Runtime: number; errorCount: number; totalCount: number;
  lastSuccess: string | null; lastRun: string | null; status: string;
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

const statusColor: Record<string, string> = { healthy: '#22c55e', degraded: '#f59e0b', slow: '#f59e0b', error: '#ef4444', no_data: '#64748b' };

const SUBSYSTEM_LABELS: Record<string, string> = {
  forecasting: 'Forecasting', markets: 'Markets', signals: 'Signals',
  execution: 'Execution', accounting: 'Accounting', system: 'System',
};

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function SystemHealth() {
  const [subsystems, setSubsystems] = useState<SubsystemHealth[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState('');

  const fetchData = async () => {
    try {
      const res = await fetch('/api/admin/system/health');
      if (res.ok) {
        const d = await res.json();
        setSubsystems(d.subsystems || []);
        setSummary({ totalErrors: d.totalErrors, avgLatency: d.avgLatency, slowOperations: d.slowOperations, recentEvents: d.recentEvents });
      }
    } catch {}
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const runRedisCheck = async () => {
    setRunning(true); setMsg('');
    try {
      const res = await fetch('/api/admin/system/health', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run-redis-check' }),
      });
      if (res.ok) {
        const d = await res.json();
        setMsg(`Redis ping: ${d.latencyMs}ms`);
        await fetchData();
      }
    } catch {} finally { setRunning(false); }
  };

  const navLinks = [
    { href: '/admin/performance', label: 'Performance' },
    { href: '/admin/system/data-integrity', label: 'Data Integrity' },
    { href: '/admin/system/health', label: 'System Health', active: true },
  ];

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading system health...</div>;

  const groups = ['forecasting', 'markets', 'signals', 'execution', 'accounting', 'system'];

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {navLinks.map(l => (
          <a key={l.href} href={l.href} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none', background: l.active ? '#6366f1' : '#334155', color: '#fff' }}>{l.label}</a>
        ))}
      </div>

      <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>System Health & Metrics</h1>
      <p style={{ margin: '0 0 20px', fontSize: 14, color: '#94a3b8' }}>
        Operational health monitoring — subsystem runtimes, error rates, and performance trends.
      </p>

      {msg && <div style={{ ...card, background: '#1e3a2f', padding: 12, fontSize: 13 }}>{msg}</div>}

      {summary && (
        <div style={grid4}>
          <div style={card}><div style={{ fontSize: 11, color: '#ef4444', marginBottom: 4 }}>Total Errors</div><div style={{ fontSize: 24, fontWeight: 700, color: '#ef4444' }}>{summary.totalErrors}</div></div>
          <div style={card}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Avg Latency</div><div style={{ fontSize: 24, fontWeight: 700 }}>{summary.avgLatency}ms</div></div>
          <div style={card}><div style={{ fontSize: 11, color: '#f59e0b', marginBottom: 4 }}>Slow Operations</div><div style={{ fontSize: 24, fontWeight: 700, color: '#f59e0b' }}>{summary.slowOperations}</div></div>
          <div style={card}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Recent Events</div><div style={{ fontSize: 24, fontWeight: 700 }}>{summary.recentEvents}</div></div>
          {summary.instrumentation && (
            <div style={card}><div style={{ fontSize: 11, color: '#3b82f6', marginBottom: 4 }}>Instrumented</div><div style={{ fontSize: 24, fontWeight: 700, color: '#3b82f6' }}>{summary.instrumentation.instrumented}/{summary.instrumentation.total}</div><div style={{ fontSize: 10, color: '#64748b' }}>{summary.instrumentation.coveragePercent}% coverage</div></div>
          )}
        </div>
      )}

      <div style={{ marginBottom: 20 }}>
        <button style={{ ...btn('#3b82f6'), padding: '8px 18px', fontSize: 13 }} onClick={runRedisCheck} disabled={running}>
          {running ? 'Checking...' : 'Run Redis Latency Check'}
        </button>
        <button style={{ ...btn('#334155'), padding: '8px 18px', fontSize: 13, marginLeft: 8 }} onClick={fetchData}>Refresh</button>
      </div>

      {groups.map(group => {
        const ops = subsystems.filter(s => s.subsystem === group);
        if (ops.length === 0) return null;
        return (
          <div key={group} style={card}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>{SUBSYSTEM_LABELS[group] || group}</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Operation</th><th style={th}>Instrumented</th><th style={th}>Status</th><th style={th}>Last Runtime</th><th style={th}>Avg</th><th style={th}>p95</th><th style={th}>Errors</th><th style={th}>Total</th><th style={th}>Last Run</th></tr></thead>
              <tbody>
                {ops.map(h => (
                  <tr key={h.operation}>
                    <td style={td}><span style={{ fontWeight: 600 }}>{h.operation.replace(/_/g, ' ')}</span></td>
                    <td style={td}>{h.totalCount > 0 ? <span style={badge('#22c55e')}>LIVE</span> : <span style={badge('#64748b')}>AWAITING DATA</span>}</td>
                    <td style={td}><span style={badge(statusColor[h.status] || '#64748b')}>{h.status.toUpperCase().replace('_', ' ')}</span></td>
                    <td style={td}>{h.lastRuntime != null ? `${h.lastRuntime}ms` : '—'}</td>
                    <td style={td}>{h.totalCount > 0 ? `${h.avgRuntime}ms` : '—'}</td>
                    <td style={td}>{h.totalCount > 0 ? `${h.p95Runtime}ms` : '—'}</td>
                    <td style={td}><span style={{ color: h.errorCount > 0 ? '#ef4444' : '#94a3b8' }}>{h.errorCount}</span></td>
                    <td style={td}>{h.totalCount}</td>
                    <td style={td}><span style={{ fontSize: 11, color: '#64748b' }}>{h.lastRun ? new Date(h.lastRun).toLocaleString() : '—'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

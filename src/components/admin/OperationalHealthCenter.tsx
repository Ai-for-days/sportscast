import React, { useEffect, useMemo, useState } from 'react';
import SystemNav from './SystemNav';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const tile: React.CSSProperties = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 12 };
const btn = (bg: string): React.CSSProperties => ({ padding: '6px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, textDecoration: 'none', display: 'inline-block' });
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (bg: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: bg, color: '#fff' });

const sevColor: Record<string, string> = { healthy: '#22c55e', monitor: '#3b82f6', degraded: '#f59e0b', critical: '#ef4444' };
const sevLabel: Record<string, string> = { healthy: 'Healthy', monitor: 'Monitor', degraded: 'Degraded', critical: 'Critical' };

const SUBSYSTEMS = [
  'wagers', 'pricing', 'integrity', 'settlement_preview',
  'disputes', 'incidents', 'weather_evidence',
  'certifications', 'rbac_reviews', 'audit_investigation',
  'runbooks', 'exposure',
] as const;

const SUBSYSTEM_LINK: Record<string, string> = {
  wagers: '/admin/wagers',
  pricing: '/admin/wagers',
  integrity: '/admin/system/market-integrity',
  settlement_preview: '/admin/system/wager-settlement-preview',
  disputes: '/admin/system/dispute-workflow',
  incidents: '/admin/system/incident-management',
  weather_evidence: '/admin/system/weather-evidence',
  certifications: '/admin/system/operator-certification',
  rbac_reviews: '/admin/system/operator-rbac-review',
  audit_investigation: '/admin/system/audit-investigation',
  runbooks: '/admin/system/daily-operator-runbook',
  exposure: '/admin/system/house-exposure',
};

const SUBSYSTEM_LABEL: Record<string, string> = {
  wagers: 'Wagers',
  pricing: 'Pricing',
  integrity: 'Market Integrity',
  settlement_preview: 'Settlement Preview',
  disputes: 'Disputes',
  incidents: 'Incidents',
  weather_evidence: 'Weather Evidence',
  certifications: 'Certifications',
  rbac_reviews: 'RBAC Reviews',
  audit_investigation: 'Audit Investigation',
  runbooks: 'Runbooks',
  exposure: 'House Exposure',
};

const BANNER: React.CSSProperties = {
  background: 'linear-gradient(90deg, #047857, #0d9488)', color: '#fff',
  padding: '10px 14px', borderRadius: 8, marginBottom: 16,
  fontSize: 13, fontWeight: 600, display: 'flex', justifyContent: 'space-between',
  alignItems: 'center', gap: 12, flexWrap: 'wrap',
};

type Tab = 'health' | 'stale' | 'backlogs' | 'api' | 'methodology';

export default function OperationalHealthCenter() {
  const [tab, setTab] = useState<Tab>('health');
  const [snapshot, setSnapshot] = useState<any | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [summary, setSummary] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    reloadAll();
  }, []);

  async function get(action: string) {
    const res = await fetch(`/api/admin/system/operational-health?action=${action}`, { credentials: 'include' });
    const j = await res.json();
    if (!res.ok) throw new Error(j.message ?? j.error ?? 'failed');
    return j;
  }
  async function post(body: any) {
    const res = await fetch('/api/admin/system/operational-health', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.message ?? j.error ?? 'failed');
    return j;
  }

  async function reloadAll() {
    setLoading(true); setError(null);
    try {
      const [cur, hist, sum] = await Promise.all([
        get('current'), get('history'), get('summary'),
      ]);
      setSnapshot(cur.snapshot ?? null);
      setHistory(hist.snapshots ?? []);
      setSummary(sum.summary ?? null);
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setLoading(false);
  }

  async function generateSnapshot() {
    setBusy('generate'); setError(null);
    try {
      const j = await post({ action: 'generate-snapshot' });
      setSnapshot(j.snapshot ?? null);
      // Refresh history + summary
      const [hist, sum] = await Promise.all([get('history'), get('summary')]);
      setHistory(hist.snapshots ?? []);
      setSummary(sum.summary ?? null);
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  const overallSev = snapshot?.severity as string | undefined;

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}><SystemNav activeHref="/admin/system/operational-health" /></div>

      {/* Persistent advisory banner */}
      <div style={BANNER}>
        <span>
          🩺 Operational Health is advisory only. It does not restart systems, modify wagers, settle balances, or change permissions automatically.
        </span>
        <a href="/admin/system/command-center" style={{ ...btn('rgba(255,255,255,0.15)'), color: '#fff' }}>
          Command Center →
        </a>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 26, fontWeight: 800 }}>Operational Health & Reliability</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', maxWidth: 820 }}>
            Live read across wagers, integrity, disputes, incidents, settlement, certification, RBAC, runbooks, evidence, exposure, and Redis health.
            Generates a persisted snapshot per click — operationally read-only.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={reloadAll} disabled={loading} style={btn('#475569')}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button type="button" onClick={generateSnapshot} disabled={busy === 'generate'} style={btn('#22c55e')}>
            {busy === 'generate' ? 'Generating…' : 'Generate Snapshot'}
          </button>
        </div>
      </div>

      {/* Top-line severity */}
      <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>Latest snapshot severity</div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>
            {overallSev
              ? <span style={badge(sevColor[overallSev])}>{sevLabel[overallSev]}</span>
              : <span style={{ color: '#94a3b8', fontSize: 14 }}>No snapshot yet — click Generate Snapshot.</span>}
          </div>
          {snapshot && (
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>
              Generated {new Date(snapshot.generatedAt).toLocaleString()} by <code>{snapshot.generatedBy}</code>
            </div>
          )}
        </div>
        {summary && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(['healthy', 'monitor', 'degraded', 'critical'] as const).map(s => (
              <div key={s} style={{ ...tile, padding: '8px 12px', minWidth: 90, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase' }}>{sevLabel[s]}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: sevColor[s] }}>
                  {summary.severityCounts?.[s] ?? 0}
                </div>
              </div>
            ))}
            <div style={{ ...tile, padding: '8px 12px', minWidth: 90, textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase' }}>Total snapshots</div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{summary.totalSnapshots ?? 0}</div>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div style={{ ...card, borderLeft: '3px solid #ef4444', background: '#450a0a', color: '#fecaca' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Tab strip */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {(['health', 'stale', 'backlogs', 'api', 'methodology'] as Tab[]).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={btn(tab === t ? '#6366f1' : '#334155')}
          >
            {t === 'health' ? '1 · System Health'
              : t === 'stale' ? '2 · Stale Data'
              : t === 'backlogs' ? '3 · Workflow Backlogs'
              : t === 'api' ? '4 · API & Storage Health'
              : '5 · Methodology'}
          </button>
        ))}
      </div>

      {!snapshot && tab !== 'methodology' && (
        <EmptyState onGenerate={generateSnapshot} busy={busy === 'generate'} />
      )}

      {snapshot && tab === 'health' && <SystemHealthView snapshot={snapshot} history={history} />}
      {snapshot && tab === 'stale' && <StaleDataView snapshot={snapshot} />}
      {snapshot && tab === 'backlogs' && <BacklogsView snapshot={snapshot} />}
      {snapshot && tab === 'api' && <ApiStorageView snapshot={snapshot} />}
      {tab === 'methodology' && <MethodologyView />}

      <div style={{ fontSize: 11, color: '#64748b', textAlign: 'right', marginTop: 4 }}>
        Operational Health is advisory only. It writes <code>operational-health:*</code> snapshots and audit log entries — nothing else.
      </div>
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ onGenerate, busy }: { onGenerate: () => void; busy: boolean }) {
  return (
    <div style={{ ...card, borderLeft: '3px solid #3b82f6' }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>No snapshot on file yet</div>
      <p style={{ margin: '0 0 10px', fontSize: 13, color: '#cbd5e1', maxWidth: 720 }}>
        Click <strong>Generate Snapshot</strong> above to read the platform's live read-only summaries
        (wagers, integrity, disputes, incidents, settlement, certifications, RBAC, evidence, runbooks, exposure)
        and persist a single advisory snapshot.
      </p>
      <button type="button" onClick={onGenerate} disabled={busy} style={btn('#22c55e')}>
        {busy ? 'Generating…' : 'Generate Snapshot now'}
      </button>
    </div>
  );
}

// ── Tab 1: System Health ─────────────────────────────────────────────────────

function SystemHealthView({ snapshot, history }: { snapshot: any; history: any[] }) {
  return (
    <>
      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 10 }}>Subsystem status</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
          {SUBSYSTEMS.map(sub => {
            const s = snapshot.subsystemStatus?.[sub] ?? { status: 'healthy', note: '—' };
            return (
              <a key={sub} href={SUBSYSTEM_LINK[sub]} style={{ textDecoration: 'none', color: '#e2e8f0' }}>
                <div style={{ ...tile, borderLeft: `3px solid ${sevColor[s.status] ?? '#64748b'}`, height: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{SUBSYSTEM_LABEL[sub]}</div>
                    <span style={badge(sevColor[s.status] ?? '#64748b')}>{sevLabel[s.status] ?? s.status}</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 6 }}>{s.note}</div>
                  {s.metrics && (
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6, fontFamily: 'ui-monospace, Menlo, monospace' }}>
                      {Object.entries(s.metrics).map(([k, v]) => (
                        <div key={k}>{k}: {String(v ?? '—')}</div>
                      ))}
                    </div>
                  )}
                </div>
              </a>
            );
          })}
        </div>
      </div>

      {snapshot.warnings?.length > 0 && (
        <div style={{ ...card, borderLeft: '3px solid #f59e0b' }}>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>Warnings</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#fde68a' }}>
            {snapshot.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      {snapshot.recommendations?.length > 0 && (
        <div style={{ ...card, borderLeft: '3px solid #22c55e' }}>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>Recommendations</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#cbd5e1' }}>
            {snapshot.recommendations.map((r: string, i: number) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}

      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>Recent snapshots</div>
        {history.length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 13 }}>No history yet.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Generated</th>
                <th style={th}>By</th>
                <th style={th}>Severity</th>
                <th style={th}>Stale</th>
                <th style={th}>Backlogs</th>
                <th style={th}>API failures</th>
                <th style={th}>Redis</th>
              </tr>
            </thead>
            <tbody>
              {history.slice(0, 20).map((h: any) => (
                <tr key={h.id}>
                  <td style={td}>{new Date(h.generatedAt).toLocaleString()}</td>
                  <td style={td}><code>{h.generatedBy}</code></td>
                  <td style={td}><span style={badge(sevColor[h.severity] ?? '#64748b')}>{sevLabel[h.severity] ?? h.severity}</span></td>
                  <td style={td}>{h.staleDataWarnings?.length ?? 0}</td>
                  <td style={td}>{h.backlogWarnings?.length ?? 0}</td>
                  <td style={td}>{h.apiFailures?.length ?? 0}</td>
                  <td style={td}>{h.redisHealth?.status ?? '—'}{h.redisHealth?.latencyEstimateMs != null ? ` (${h.redisHealth.latencyEstimateMs}ms)` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// ── Tab 2: Stale Data ────────────────────────────────────────────────────────

function StaleDataView({ snapshot }: { snapshot: any }) {
  const items: any[] = snapshot.staleDataWarnings ?? [];
  return (
    <div style={card}>
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>Stale data warnings</div>
      {items.length === 0 ? (
        <div style={{ color: '#22c55e', fontSize: 13 }}>✓ No stale data detected by the latest snapshot.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Subsystem</th>
              <th style={th}>Detail</th>
              <th style={th}>Age</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((w: any, i: number) => (
              <tr key={i}>
                <td style={td}>{SUBSYSTEM_LABEL[w.subsystem] ?? w.subsystem}</td>
                <td style={td}>{w.detail}</td>
                <td style={td}>{formatAge(w.ageMs)}</td>
                <td style={td}>
                  {SUBSYSTEM_LINK[w.subsystem] && (
                    <a href={SUBSYSTEM_LINK[w.subsystem]} style={{ ...btn('#475569') }}>Open →</a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Tab 3: Workflow Backlogs ────────────────────────────────────────────────

function BacklogsView({ snapshot }: { snapshot: any }) {
  const items: any[] = snapshot.backlogWarnings ?? [];
  const m = snapshot.operationalMetrics ?? {};
  const max = Math.max(1, ...items.map(i => i.count ?? 0));
  return (
    <>
      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 10 }}>Operational metrics</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <Metric label="Unresolved incidents" value={m.unresolvedIncidents ?? 0} href={SUBSYSTEM_LINK.incidents} />
          <Metric label="Unresolved disputes" value={m.unresolvedDisputes ?? 0} href={SUBSYSTEM_LINK.disputes} />
          <Metric label="Overdue runbooks" value={m.overdueRunbooks ?? 0} href={SUBSYSTEM_LINK.runbooks} />
          <Metric label="Integrity warnings/critical" value={m.unresolvedIntegrityWarnings ?? 0} href={SUBSYSTEM_LINK.integrity} />
          <Metric label="Stale markets" value={m.staleMarkets ?? 0} href="/admin/system/wager-resolution" />
          <Metric label="Pending settlement previews" value={m.pendingSettlementPreviews ?? 0} href={SUBSYSTEM_LINK.settlement_preview} />
        </div>
      </div>

      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>Backlog detail</div>
        {items.length === 0 ? (
          <div style={{ color: '#22c55e', fontSize: 13 }}>✓ No workflow backlogs detected by the latest snapshot.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Subsystem</th>
                <th style={th}>Detail</th>
                <th style={th}>Count</th>
                <th style={th}>Bar</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((w: any, i: number) => (
                <tr key={i}>
                  <td style={td}>{SUBSYSTEM_LABEL[w.subsystem] ?? w.subsystem}</td>
                  <td style={td}>{w.detail}</td>
                  <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', textAlign: 'right' }}>{w.count}</td>
                  <td style={td}>
                    <div style={{ background: '#1e293b', height: 8, borderRadius: 4, width: '100%', maxWidth: 220 }}>
                      <div style={{ background: '#f59e0b', height: '100%', width: `${Math.round(((w.count ?? 0) / max) * 100)}%`, borderRadius: 4 }} />
                    </div>
                  </td>
                  <td style={td}>
                    {SUBSYSTEM_LINK[w.subsystem] && (
                      <a href={SUBSYSTEM_LINK[w.subsystem]} style={{ ...btn('#475569') }}>Open →</a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function Metric({ label, value, href }: { label: string; value: number; href?: string }) {
  const inner = (
    <div style={{ ...tile, height: '100%' }}>
      <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: value > 0 ? '#f59e0b' : '#22c55e' }}>{value}</div>
    </div>
  );
  return href ? <a href={href} style={{ textDecoration: 'none', color: '#e2e8f0' }}>{inner}</a> : inner;
}

// ── Tab 4: API & Storage Health ─────────────────────────────────────────────

function ApiStorageView({ snapshot }: { snapshot: any }) {
  const failures: any[] = snapshot.apiFailures ?? [];
  const r = snapshot.redisHealth ?? {};
  return (
    <>
      <div style={{ ...card, borderLeft: `3px solid ${r.status === 'ok' ? '#22c55e' : r.status === 'degraded' ? '#f59e0b' : '#ef4444'}` }}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>Redis health</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 13 }}>
          <div><strong>Status:</strong> <span style={badge(r.status === 'ok' ? '#22c55e' : r.status === 'degraded' ? '#f59e0b' : '#ef4444')}>{r.status}</span></div>
          {r.latencyEstimateMs != null && <div><strong>Round-trip:</strong> {r.latencyEstimateMs}ms</div>}
          {r.warning && <div style={{ color: '#fbbf24' }}><strong>Warning:</strong> {r.warning}</div>}
        </div>
      </div>

      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>API failures</div>
        {failures.length === 0 ? (
          <div style={{ color: '#22c55e', fontSize: 13 }}>✓ All upstream subsystem reads succeeded.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Subsystem</th>
                <th style={th}>Error</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {failures.map((f: any, i: number) => (
                <tr key={i}>
                  <td style={td}>{SUBSYSTEM_LABEL[f.subsystem] ?? f.subsystem}</td>
                  <td style={{ ...td, color: '#fecaca', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }}>{f.error}</td>
                  <td style={td}>
                    {SUBSYSTEM_LINK[f.subsystem] && (
                      <a href={SUBSYSTEM_LINK[f.subsystem]} style={{ ...btn('#475569') }}>Open →</a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// ── Tab 5: Methodology ──────────────────────────────────────────────────────

function MethodologyView() {
  return (
    <div style={card}>
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>How operational health is computed</div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#cbd5e1', lineHeight: 1.6 }}>
        <li><strong>Subsystem status:</strong> per-subsystem severity is derived from existing read-only summaries — open/critical counts (incidents, disputes), warning/critical reports (integrity), pending previews, conflict counts (evidence), unacknowledged reviews (RBAC), expiring certifications, and stale runbook cadence.</li>
        <li><strong>Stale data:</strong> markets unresolved &gt; 24h after target date; latest integrity report &gt; 7 days old; latest runbook &gt; 2 days old; graded markets without a settlement preview; unresolved critical incidents/disputes.</li>
        <li><strong>Workflow backlogs:</strong> open queues across incidents, disputes, RBAC, settlement preview, change control, and certification expirations.</li>
        <li><strong>API failures:</strong> subsystem reads that throw are captured (error string), the subsystem is marked degraded, and overall severity escalates.</li>
        <li><strong>Redis health:</strong> a single SET/GET round-trip on a probe key. Latency thresholds: ≥{400}ms = degraded, ≥{1500}ms = degraded with warning, throw = unavailable / critical.</li>
        <li><strong>Severity rollup:</strong> overall severity is the worst of any subsystem severity, the Redis severity, and the API-failure escalation.</li>
        <li><strong>Persistence:</strong> snapshots write to <code>operational-health:&#123;id&#125;</code> + <code>operational-health-snapshots:all</code> (capped at 500) + <code>operational-health:latest</code> + a single <code>operational_health_snapshot_generated</code> audit event. <strong>No other writes.</strong></li>
      </ul>
      <div style={{ marginTop: 10, fontSize: 12, color: '#94a3b8' }}>
        This center never restarts services, grades wagers, settles balances, modifies pricing, mutates RBAC, or triggers automated remediation. Every recommendation routes a human operator to the appropriate manual workflow.
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatAge(ms?: number): string {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return '—';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

import React, { useEffect, useState } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface RetentionPolicy {
  family: string; retentionDays: number; immutable: boolean; exportable: boolean; notes?: string;
}
interface EvidenceRecord {
  id: string; createdAt: string; evidenceType: string; title: string;
  relatedIds?: string[]; metadata?: any; payload: any; immutable: true;
}
interface EvidenceBundle {
  id: string; createdAt: string; bundleType: string; targetType: string;
  targetId: string; records: any[]; summary: any;
}
interface EvidenceSummary {
  total: number; today: number; byType: Record<string, number>; bundles: number;
}

/* ------------------------------------------------------------------ */
/*  Styles                                                              */
/* ------------------------------------------------------------------ */

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({ padding: '5px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const inputStyle: React.CSSProperties = { padding: '5px 8px', borderRadius: 4, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', fontSize: 13, width: '100%' };
const textareaStyle: React.CSSProperties = { ...inputStyle, minHeight: 60, resize: 'vertical' as const };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (color: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: color, color: '#fff' });

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function Compliance() {
  const [policies, setPolicies] = useState<RetentionPolicy[]>([]);
  const [summary, setSummary] = useState<EvidenceSummary | null>(null);
  const [evidence, setEvidence] = useState<EvidenceRecord[]>([]);
  const [bundles, setBundles] = useState<EvidenceBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState<'overview' | 'policies' | 'evidence' | 'bundles'>('overview');

  // Bundle builder
  const [bbType, setBbType] = useState('approval_evidence');
  const [bbTargetType, setBbTargetType] = useState('');
  const [bbTargetId, setBbTargetId] = useState('');

  // Detail
  const [viewEvidence, setViewEvidence] = useState<EvidenceRecord | null>(null);
  const [viewBundle, setViewBundle] = useState<EvidenceBundle | null>(null);

  const fetchAll = async () => {
    try {
      const res = await fetch('/api/admin/compliance');
      if (res.ok) {
        const d = await res.json();
        setPolicies(d.policies || []);
        setSummary(d.summary || null);
        setEvidence(d.evidence || []);
        setBundles(d.bundles || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const post = async (body: any) => {
    setMsg('');
    try {
      const res = await fetch('/api/admin/compliance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) { setMsg(j.error || 'Error'); return null; }
      setMsg(j.message || 'Done');
      await fetchAll();
      return j;
    } catch (e: any) { setMsg(e.message); return null; }
  };

  const seedPolicies = () => post({ action: 'seed-policies' });

  const buildBundle = async () => {
    if (!bbTargetType || !bbTargetId) { setMsg('Target type and ID required'); return; }
    await post({
      action: 'create-bundle', bundleType: bbType,
      targetType: bbTargetType, targetId: bbTargetId,
      records: [], summary: { note: 'Bundle created from compliance center' },
    });
  };

  const exportEvidence = (id: string) => window.open(`/api/admin/compliance?action=export-evidence&id=${id}`, '_blank');
  const exportBundle = (id: string) => window.open(`/api/admin/compliance?action=export-bundle&id=${id}`, '_blank');
  const exportPolicies = () => window.open('/api/admin/compliance?action=export-policies', '_blank');

  const navLinks = [
    { href: '/admin/operations-center', label: 'Ops Center' },
    { href: '/admin/change-control', label: 'Change Control' },
    { href: '/admin/security', label: 'Security' },
    { href: '/admin/compliance', label: 'Compliance', active: true },
  ];

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading compliance center...</div>;

  const topTypes = summary?.byType ? Object.entries(summary.byType).sort((a, b) => b[1] - a[1]).slice(0, 6) : [];

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      {/* Nav */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {navLinks.map(l => (
          <a key={l.href} href={l.href} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none', background: l.active ? '#6366f1' : '#334155', color: '#fff' }}>{l.label}</a>
        ))}
      </div>

      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Compliance + Retention + Evidence</h2>
      <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 16 }}>Record retention policies, immutable evidence trail, and compliance exports</p>

      {msg && <div style={{ ...card, background: '#1e3a5f', color: '#93c5fd', fontSize: 13 }}>{msg}</div>}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {(['overview', 'policies', 'evidence', 'bundles'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ ...btn(tab === t ? '#6366f1' : '#334155'), textTransform: 'capitalize' }}>{t}</button>
        ))}
      </div>

      {/* ═══════ OVERVIEW ═══════ */}
      {tab === 'overview' && summary && (
        <>
          <div style={grid4}>
            <div style={card}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.total}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Evidence Records</div>
            </div>
            <div style={{ ...card, borderLeft: '3px solid #3b82f6' }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.today}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Evidence Today</div>
            </div>
            <div style={{ ...card, borderLeft: '3px solid #8b5cf6' }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.bundles}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Bundles</div>
            </div>
            <div style={{ ...card, borderLeft: '3px solid #22c55e' }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{policies.length}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Retention Policies</div>
            </div>
            {topTypes.map(([type, count]) => (
              <div key={type} style={card}>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{count}</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>{type.replace(/_/g, ' ')}</div>
              </div>
            ))}
          </div>

          {/* Compliance notes */}
          <div style={{ ...card, borderLeft: '3px solid #f59e0b', background: '#1c1917' }}>
            <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Compliance Notes</h4>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>
              <p style={{ marginBottom: 4 }}>Retention policies are currently <strong>informational</strong> — they define intended retention periods but automatic purge is <strong>not active</strong>.</p>
              <p style={{ marginBottom: 4 }}>Evidence records are <strong>append-only and immutable</strong>. No update or delete functions exist for evidence.</p>
              <p>All exports produce downloadable JSON files suitable for external archival or regulatory review.</p>
            </div>
          </div>

          {/* Recent evidence */}
          <div style={card}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Recent Evidence</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>Time</th><th style={th}>Type</th><th style={th}>Title</th><th style={th}>Related</th><th style={th}>Actions</th></tr></thead>
                <tbody>
                  {evidence.slice(0, 10).map(ev => (
                    <tr key={ev.id}>
                      <td style={td}>{ev.createdAt.slice(0, 16).replace('T', ' ')}</td>
                      <td style={td}><span style={badge('#6366f1')}>{ev.evidenceType.replace(/_/g, ' ')}</span></td>
                      <td style={td}>{ev.title}</td>
                      <td style={td}>{ev.relatedIds?.length || 0}</td>
                      <td style={td}>
                        <button onClick={() => setViewEvidence(ev)} style={{ ...btn('#6366f1'), marginRight: 4 }}>View</button>
                        <button onClick={() => exportEvidence(ev.id)} style={btn('#334155')}>JSON</button>
                      </td>
                    </tr>
                  ))}
                  {evidence.length === 0 && <tr><td colSpan={5} style={{ ...td, color: '#64748b', textAlign: 'center' }}>No evidence records</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ═══════ POLICIES TAB ═══════ */}
      {tab === 'policies' && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600 }}>Retention Policies ({policies.length})</h3>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={seedPolicies} style={btn('#22c55e')}>Seed Defaults</button>
              <button onClick={exportPolicies} style={btn('#334155')}>Export JSON</button>
            </div>
          </div>
          {policies.length === 0 ? (
            <div style={{ color: '#64748b', fontSize: 13 }}>No policies. Click "Seed Defaults" to create.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>Family</th><th style={th}>Retention</th><th style={th}>Immutable</th><th style={th}>Exportable</th><th style={th}>Notes</th></tr></thead>
                <tbody>
                  {policies.map(p => (
                    <tr key={p.family}>
                      <td style={{ ...td, fontWeight: 600 }}>{p.family.replace(/_/g, ' ')}</td>
                      <td style={td}>{p.retentionDays} days</td>
                      <td style={td}>{p.immutable ? <span style={{ color: '#22c55e', fontWeight: 600 }}>Yes</span> : <span style={{ color: '#64748b' }}>No</span>}</td>
                      <td style={td}>{p.exportable ? <span style={{ color: '#22c55e' }}>Yes</span> : <span style={{ color: '#64748b' }}>No</span>}</td>
                      <td style={{ ...td, fontSize: 12, color: '#94a3b8' }}>{p.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══════ EVIDENCE TAB ═══════ */}
      {tab === 'evidence' && (
        <div style={card}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Evidence Records ({evidence.length})</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Time</th><th style={th}>Type</th><th style={th}>Title</th><th style={th}>Related</th><th style={th}>Immutable</th><th style={th}>Actions</th></tr></thead>
              <tbody>
                {evidence.map(ev => (
                  <tr key={ev.id}>
                    <td style={td}>{ev.createdAt.slice(0, 16).replace('T', ' ')}</td>
                    <td style={td}><span style={badge('#6366f1')}>{ev.evidenceType.replace(/_/g, ' ')}</span></td>
                    <td style={td}>{ev.title}</td>
                    <td style={td}>{ev.relatedIds?.length || 0}</td>
                    <td style={td}><span style={{ color: '#22c55e', fontWeight: 600 }}>Yes</span></td>
                    <td style={td}>
                      <button onClick={() => setViewEvidence(ev)} style={{ ...btn('#6366f1'), marginRight: 4 }}>View</button>
                      <button onClick={() => exportEvidence(ev.id)} style={btn('#334155')}>JSON</button>
                    </td>
                  </tr>
                ))}
                {evidence.length === 0 && <tr><td colSpan={6} style={{ ...td, color: '#64748b', textAlign: 'center' }}>No evidence records</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══════ BUNDLES TAB ═══════ */}
      {tab === 'bundles' && (
        <>
          {/* Bundle builder */}
          <div style={card}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Build Evidence Bundle</h3>
            <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 160 }}>
                <label style={{ fontSize: 11, color: '#94a3b8' }}>Bundle Type</label>
                <select value={bbType} onChange={e => setBbType(e.target.value)} style={inputStyle}>
                  <option value="approval_evidence">Approval Evidence</option>
                  <option value="incident_evidence">Incident Evidence</option>
                  <option value="release_evidence">Release Evidence</option>
                  <option value="signoff_evidence">Signoff Evidence</option>
                  <option value="live_order_evidence">Live Order Evidence</option>
                </select>
              </div>
              <div style={{ minWidth: 120 }}>
                <label style={{ fontSize: 11, color: '#94a3b8' }}>Target Type</label>
                <input value={bbTargetType} onChange={e => setBbTargetType(e.target.value)} placeholder="e.g. incident" style={inputStyle} />
              </div>
              <div style={{ minWidth: 160 }}>
                <label style={{ fontSize: 11, color: '#94a3b8' }}>Target ID</label>
                <input value={bbTargetId} onChange={e => setBbTargetId(e.target.value)} placeholder="e.g. inc-123..." style={inputStyle} />
              </div>
              <button onClick={buildBundle} style={btn('#8b5cf6')}>Build Bundle</button>
            </div>
          </div>

          {/* Bundles table */}
          <div style={card}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Evidence Bundles ({bundles.length})</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>Time</th><th style={th}>Type</th><th style={th}>Target</th><th style={th}>Records</th><th style={th}>Actions</th></tr></thead>
                <tbody>
                  {bundles.map(b => (
                    <tr key={b.id}>
                      <td style={td}>{b.createdAt.slice(0, 16).replace('T', ' ')}</td>
                      <td style={td}><span style={badge('#8b5cf6')}>{b.bundleType.replace(/_/g, ' ')}</span></td>
                      <td style={td}>{b.targetType}:{b.targetId.slice(0, 16)}</td>
                      <td style={td}>{b.records.length}</td>
                      <td style={td}>
                        <button onClick={() => setViewBundle(b)} style={{ ...btn('#6366f1'), marginRight: 4 }}>View</button>
                        <button onClick={() => exportBundle(b.id)} style={btn('#334155')}>JSON</button>
                      </td>
                    </tr>
                  ))}
                  {bundles.length === 0 && <tr><td colSpan={5} style={{ ...td, color: '#64748b', textAlign: 'center' }}>No bundles</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ═══════ EVIDENCE DETAIL MODAL ═══════ */}
      {viewEvidence && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#1e293b', borderRadius: 12, padding: 24, maxWidth: 650, width: '95%', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 12 }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700 }}>{viewEvidence.title}</h3>
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <span style={badge('#6366f1')}>{viewEvidence.evidenceType.replace(/_/g, ' ')}</span>
                  <span style={badge('#22c55e')}>immutable</span>
                </div>
              </div>
              <button onClick={() => setViewEvidence(null)} style={btn('#334155')}>Close</button>
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>
              Created: {viewEvidence.createdAt.slice(0, 19).replace('T', ' ')} | ID: {viewEvidence.id}
            </div>
            {viewEvidence.relatedIds && viewEvidence.relatedIds.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <h4 style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>Related IDs</h4>
                <div style={{ fontSize: 12 }}>{viewEvidence.relatedIds.join(', ')}</div>
              </div>
            )}
            <h4 style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>Payload</h4>
            <pre style={{ background: '#0f172a', borderRadius: 6, padding: 10, fontSize: 11, overflow: 'auto', maxHeight: 300, color: '#cbd5e1' }}>
              {JSON.stringify(viewEvidence.payload, null, 2)}
            </pre>
            <div style={{ marginTop: 12, textAlign: 'right' }}>
              <button onClick={() => exportEvidence(viewEvidence.id)} style={btn('#3b82f6')}>Export JSON</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ BUNDLE DETAIL MODAL ═══════ */}
      {viewBundle && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#1e293b', borderRadius: 12, padding: 24, maxWidth: 650, width: '95%', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 12 }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700 }}>{viewBundle.bundleType.replace(/_/g, ' ')}</h3>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>{viewBundle.targetType}:{viewBundle.targetId}</div>
              </div>
              <button onClick={() => setViewBundle(null)} style={btn('#334155')}>Close</button>
            </div>
            <h4 style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>Summary</h4>
            <pre style={{ background: '#0f172a', borderRadius: 6, padding: 10, fontSize: 11, overflow: 'auto', maxHeight: 150, color: '#cbd5e1' }}>
              {JSON.stringify(viewBundle.summary, null, 2)}
            </pre>
            <h4 style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', marginTop: 8, marginBottom: 4 }}>Records ({viewBundle.records.length})</h4>
            <pre style={{ background: '#0f172a', borderRadius: 6, padding: 10, fontSize: 11, overflow: 'auto', maxHeight: 300, color: '#cbd5e1' }}>
              {JSON.stringify(viewBundle.records, null, 2)}
            </pre>
            <div style={{ marginTop: 12, textAlign: 'right' }}>
              <button onClick={() => exportBundle(viewBundle.id)} style={btn('#3b82f6')}>Export JSON</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

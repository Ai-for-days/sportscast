import React, { useEffect, useState } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface ModelVersion {
  id: string;
  family: string;
  version: string;
  name: string;
  description?: string;
  createdAt: string;
  status: 'draft' | 'active' | 'archived';
  parameters?: any;
  notes?: string;
}

interface Experiment {
  id: string;
  createdAt: string;
  updatedAt: string;
  family: string;
  name: string;
  description?: string;
  baselineVersion: string;
  candidateVersion: string;
  status: 'draft' | 'running' | 'completed' | 'cancelled';
  notes?: string;
  results?: any;
}

interface ComparisonResult {
  family: string;
  baselineId: string;
  candidateId: string;
  baseline: ModelVersion | null;
  candidate: ModelVersion | null;
  metadataDiff: { field: string; baseline: any; candidate: any }[];
  parameterDiff: { field: string; baseline: any; candidate: any }[];
  summary: string;
}

interface GovernanceData {
  versions: ModelVersion[];
  activeVersions: Record<string, ModelVersion | null>;
  experiments: Experiment[];
  families: string[];
}

/* ------------------------------------------------------------------ */
/*  Styles                                                              */
/* ------------------------------------------------------------------ */

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const grid3: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginBottom: 16 };
const badge = (color: string): React.CSSProperties => ({
  display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: color, color: '#fff',
});
const btn = (bg: string): React.CSSProperties => ({
  padding: '6px 14px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600,
});
const input: React.CSSProperties = { padding: '6px 10px', borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', fontSize: 13, width: '100%' };
const select: React.CSSProperties = { ...input };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };

const STATUS_COLORS: Record<string, string> = {
  draft: '#6366f1', active: '#22c55e', archived: '#64748b',
  running: '#3b82f6', completed: '#22c55e', cancelled: '#ef4444',
};

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function ModelGovernance() {
  const [data, setData] = useState<GovernanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'registry' | 'active' | 'experiments' | 'compare'>('active');

  // Create model form
  const [newFamily, setNewFamily] = useState('');
  const [newVersion, setNewVersion] = useState('');
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newNotes, setNewNotes] = useState('');

  // Create experiment form
  const [expFamily, setExpFamily] = useState('');
  const [expName, setExpName] = useState('');
  const [expDesc, setExpDesc] = useState('');
  const [expBaseline, setExpBaseline] = useState('');
  const [expCandidate, setExpCandidate] = useState('');

  // Comparison
  const [cmpBaseline, setCmpBaseline] = useState('');
  const [cmpCandidate, setCmpCandidate] = useState('');
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);

  // Confirm modal
  const [confirmAction, setConfirmAction] = useState<{ type: string; id: string; label: string } | null>(null);

  const [msg, setMsg] = useState('');

  /* ---- fetch ---- */
  const fetchData = async () => {
    try {
      const res = await fetch('/api/admin/model-governance');
      if (res.ok) setData(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  /* ---- actions ---- */
  const post = async (body: any) => {
    setMsg('');
    try {
      const res = await fetch('/api/admin/model-governance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) { setMsg(j.error || 'Error'); return; }
      setMsg('Done');
      await fetchData();
    } catch (e: any) { setMsg(e.message); }
  };

  const handleCreateVersion = () => {
    if (!newFamily || !newVersion || !newName) { setMsg('Family, version, name required'); return; }
    post({ action: 'create-model-version', family: newFamily, version: newVersion, name: newName, description: newDesc, notes: newNotes });
    setNewVersion(''); setNewName(''); setNewDesc(''); setNewNotes('');
  };

  const handleCreateExperiment = () => {
    if (!expFamily || !expName || !expBaseline || !expCandidate) { setMsg('All experiment fields required'); return; }
    post({ action: 'create-experiment', family: expFamily, name: expName, description: expDesc, baselineVersion: expBaseline, candidateVersion: expCandidate });
    setExpName(''); setExpDesc('');
  };

  const handleCompare = async () => {
    if (!cmpBaseline || !cmpCandidate) { setMsg('Select both versions'); return; }
    try {
      const res = await fetch(`/api/admin/model-governance?action=compare&baselineId=${cmpBaseline}&candidateId=${cmpCandidate}`);
      if (res.ok) setComparison(await res.json());
    } catch { setMsg('Compare failed'); }
  };

  const confirmPromote = (id: string, label: string) => setConfirmAction({ type: 'promote', id, label });
  const confirmArchive = (id: string, label: string) => setConfirmAction({ type: 'archive', id, label });

  const executeConfirm = () => {
    if (!confirmAction) return;
    if (confirmAction.type === 'promote') post({ action: 'promote-model-version', id: confirmAction.id });
    else post({ action: 'archive-model-version', id: confirmAction.id });
    setConfirmAction(null);
  };

  /* ---- render ---- */
  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading model governance...</div>;
  if (!data) return <div style={{ color: '#ef4444', padding: 40 }}>Failed to load data</div>;

  const families = data.families || [];
  const versions = data.versions || [];
  const activeVersions = data.activeVersions || {};
  const experiments = data.experiments || [];

  const navLinks = [
    { href: '/admin/trading-desk', label: 'Trading Desk' },
    { href: '/admin/operator-dashboard', label: 'Operator' },
    { href: '/admin/reports', label: 'Reports' },
    { href: '/admin/model-governance', label: 'Model Governance', active: true },
  ];

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

      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Model Governance</h2>
      <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 16 }}>Model registry, versioning, experiments & comparison</p>

      {msg && <div style={{ ...card, background: '#1e3a5f', color: '#93c5fd', fontSize: 13 }}>{msg}</div>}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {(['active', 'registry', 'experiments', 'compare'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            ...btn(tab === t ? '#6366f1' : '#334155'), textTransform: 'capitalize',
          }}>{t === 'active' ? 'Active Models' : t === 'compare' ? 'Comparison' : t}</button>
        ))}
        <button onClick={() => post({ action: 'initialize-defaults' })} style={btn('#065f46')}>Initialize Defaults</button>
      </div>

      {/* ================================================================ */}
      {/* ACTIVE MODELS TAB                                                 */}
      {/* ================================================================ */}
      {tab === 'active' && (
        <div style={grid3}>
          {families.map(f => {
            const v = activeVersions[f];
            return (
              <div key={f} style={card}>
                <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>{f}</div>
                {v ? (
                  <>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{v.version}</div>
                    <div style={{ fontSize: 13, color: '#cbd5e1' }}>{v.name}</div>
                    {v.description && <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{v.description}</div>}
                    <div style={{ marginTop: 6 }}>
                      <span style={badge('#22c55e')}>ACTIVE</span>
                      <span style={{ fontSize: 11, color: '#64748b', marginLeft: 8 }}>{v.createdAt?.slice(0, 10)}</span>
                    </div>
                  </>
                ) : (
                  <div style={{ color: '#64748b', fontSize: 13 }}>No active version</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ================================================================ */}
      {/* REGISTRY TAB                                                      */}
      {/* ================================================================ */}
      {tab === 'registry' && (
        <>
          {/* Create form */}
          <div style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8, alignItems: 'end' }}>
            <div>
              <label style={{ fontSize: 11, color: '#94a3b8' }}>Family</label>
              <select value={newFamily} onChange={e => setNewFamily(e.target.value)} style={select}>
                <option value="">Select...</option>
                {families.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#94a3b8' }}>Version</label>
              <input value={newVersion} onChange={e => setNewVersion(e.target.value)} placeholder="v2.1" style={input} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#94a3b8' }}>Name</label>
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Improved Scoring" style={input} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#94a3b8' }}>Description</label>
              <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Optional" style={input} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#94a3b8' }}>Notes</label>
              <input value={newNotes} onChange={e => setNewNotes(e.target.value)} placeholder="Optional" style={input} />
            </div>
            <div>
              <button onClick={handleCreateVersion} style={btn('#6366f1')}>Create Version</button>
            </div>
          </div>

          {/* Table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Family</th>
                  <th style={th}>Version</th>
                  <th style={th}>Name</th>
                  <th style={th}>Status</th>
                  <th style={th}>Created</th>
                  <th style={th}>Notes</th>
                  <th style={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {versions.map(v => (
                  <tr key={v.id}>
                    <td style={td}>{v.family}</td>
                    <td style={td}>{v.version}</td>
                    <td style={td}>{v.name}</td>
                    <td style={td}><span style={badge(STATUS_COLORS[v.status] || '#64748b')}>{v.status.toUpperCase()}</span></td>
                    <td style={td}>{v.createdAt?.slice(0, 10)}</td>
                    <td style={{ ...td, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.notes || '—'}</td>
                    <td style={td}>
                      {v.status !== 'active' && (
                        <button onClick={() => confirmPromote(v.id, `${v.family} ${v.version}`)} style={{ ...btn('#22c55e'), marginRight: 4, fontSize: 11 }}>Promote</button>
                      )}
                      {v.status === 'draft' && (
                        <button onClick={() => confirmArchive(v.id, `${v.family} ${v.version}`)} style={{ ...btn('#64748b'), fontSize: 11 }}>Archive</button>
                      )}
                    </td>
                  </tr>
                ))}
                {versions.length === 0 && <tr><td colSpan={7} style={{ ...td, color: '#64748b', textAlign: 'center' }}>No versions. Click "Initialize Defaults" to seed.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ================================================================ */}
      {/* EXPERIMENTS TAB                                                    */}
      {/* ================================================================ */}
      {tab === 'experiments' && (
        <>
          {/* Create experiment form */}
          <div style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8, alignItems: 'end' }}>
            <div>
              <label style={{ fontSize: 11, color: '#94a3b8' }}>Family</label>
              <select value={expFamily} onChange={e => setExpFamily(e.target.value)} style={select}>
                <option value="">Select...</option>
                {families.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#94a3b8' }}>Name</label>
              <input value={expName} onChange={e => setExpName(e.target.value)} placeholder="Pricing V1 vs V2" style={input} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#94a3b8' }}>Baseline Version ID</label>
              <select value={expBaseline} onChange={e => setExpBaseline(e.target.value)} style={select}>
                <option value="">Select...</option>
                {versions.filter(v => !expFamily || v.family === expFamily).map(v => (
                  <option key={v.id} value={v.id}>{v.family} {v.version} ({v.name})</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#94a3b8' }}>Candidate Version ID</label>
              <select value={expCandidate} onChange={e => setExpCandidate(e.target.value)} style={select}>
                <option value="">Select...</option>
                {versions.filter(v => !expFamily || v.family === expFamily).map(v => (
                  <option key={v.id} value={v.id}>{v.family} {v.version} ({v.name})</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#94a3b8' }}>Description</label>
              <input value={expDesc} onChange={e => setExpDesc(e.target.value)} placeholder="Optional" style={input} />
            </div>
            <div>
              <button onClick={handleCreateExperiment} style={btn('#3b82f6')}>Create Experiment</button>
            </div>
          </div>

          {/* Experiments table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Name</th>
                  <th style={th}>Family</th>
                  <th style={th}>Baseline</th>
                  <th style={th}>Candidate</th>
                  <th style={th}>Status</th>
                  <th style={th}>Created</th>
                  <th style={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {experiments.map(exp => (
                  <tr key={exp.id}>
                    <td style={td}>{exp.name}</td>
                    <td style={td}>{exp.family}</td>
                    <td style={td}>{exp.baselineVersion.slice(0, 12)}</td>
                    <td style={td}>{exp.candidateVersion.slice(0, 12)}</td>
                    <td style={td}><span style={badge(STATUS_COLORS[exp.status] || '#64748b')}>{exp.status.toUpperCase()}</span></td>
                    <td style={td}>{exp.createdAt?.slice(0, 10)}</td>
                    <td style={td}>
                      {exp.status === 'draft' && (
                        <button onClick={() => post({ action: 'update-experiment-status', id: exp.id, status: 'running' })} style={{ ...btn('#3b82f6'), fontSize: 11, marginRight: 4 }}>Start</button>
                      )}
                      {exp.status === 'running' && (
                        <button onClick={() => post({ action: 'update-experiment-status', id: exp.id, status: 'completed' })} style={{ ...btn('#22c55e'), fontSize: 11, marginRight: 4 }}>Complete</button>
                      )}
                      {(exp.status === 'draft' || exp.status === 'running') && (
                        <button onClick={() => post({ action: 'update-experiment-status', id: exp.id, status: 'cancelled' })} style={{ ...btn('#ef4444'), fontSize: 11 }}>Cancel</button>
                      )}
                    </td>
                  </tr>
                ))}
                {experiments.length === 0 && <tr><td colSpan={7} style={{ ...td, color: '#64748b', textAlign: 'center' }}>No experiments yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ================================================================ */}
      {/* COMPARISON TAB                                                     */}
      {/* ================================================================ */}
      {tab === 'compare' && (
        <>
          <div style={{ ...card, display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
            <div>
              <label style={{ fontSize: 11, color: '#94a3b8' }}>Baseline</label>
              <select value={cmpBaseline} onChange={e => setCmpBaseline(e.target.value)} style={{ ...select, minWidth: 260 }}>
                <option value="">Select baseline...</option>
                {versions.map(v => <option key={v.id} value={v.id}>{v.family} {v.version} ({v.name})</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#94a3b8' }}>Candidate</label>
              <select value={cmpCandidate} onChange={e => setCmpCandidate(e.target.value)} style={{ ...select, minWidth: 260 }}>
                <option value="">Select candidate...</option>
                {versions.map(v => <option key={v.id} value={v.id}>{v.family} {v.version} ({v.name})</option>)}
              </select>
            </div>
            <button onClick={handleCompare} style={btn('#6366f1')}>Compare</button>
          </div>

          {comparison && (
            <div style={card}>
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Comparison Result</h3>
              <p style={{ fontSize: 13, color: '#93c5fd', marginBottom: 12 }}>{comparison.summary}</p>

              {comparison.metadataDiff.length > 0 && (
                <>
                  <h4 style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>Metadata Differences</h4>
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
                    <thead><tr><th style={th}>Field</th><th style={th}>Baseline</th><th style={th}>Candidate</th></tr></thead>
                    <tbody>
                      {comparison.metadataDiff.map((d, i) => (
                        <tr key={i}><td style={td}>{d.field}</td><td style={td}>{String(d.baseline)}</td><td style={td}>{String(d.candidate)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              {comparison.parameterDiff.length > 0 && (
                <>
                  <h4 style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>Parameter Differences</h4>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={th}>Parameter</th><th style={th}>Baseline</th><th style={th}>Candidate</th></tr></thead>
                    <tbody>
                      {comparison.parameterDiff.map((d, i) => (
                        <tr key={i}><td style={td}>{d.field}</td><td style={td}>{JSON.stringify(d.baseline)}</td><td style={td}>{JSON.stringify(d.candidate)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              {comparison.metadataDiff.length === 0 && comparison.parameterDiff.length === 0 && (
                <p style={{ color: '#64748b', fontSize: 13 }}>No differences found between the two versions.</p>
              )}
            </div>
          )}
        </>
      )}

      {/* ================================================================ */}
      {/* CONFIRMATION MODAL                                                */}
      {/* ================================================================ */}
      {confirmAction && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#1e293b', borderRadius: 12, padding: 24, maxWidth: 420, width: '90%' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
              {confirmAction.type === 'promote' ? 'Promote Version?' : 'Archive Version?'}
            </h3>
            <p style={{ fontSize: 13, color: '#cbd5e1', marginBottom: 16 }}>
              {confirmAction.type === 'promote'
                ? `This will set "${confirmAction.label}" as the active version for its family. The current active version will be demoted to draft.`
                : `This will archive "${confirmAction.label}". It cannot be the active version while archived.`}
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmAction(null)} style={btn('#334155')}>Cancel</button>
              <button onClick={executeConfirm} style={btn(confirmAction.type === 'promote' ? '#22c55e' : '#64748b')}>
                {confirmAction.type === 'promote' ? 'Confirm Promote' : 'Confirm Archive'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

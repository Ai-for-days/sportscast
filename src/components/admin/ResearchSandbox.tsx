import React, { useEffect, useState } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface ScenarioTypeInfo { type: string; label: string; description: string }

interface ScenarioInputs {
  vigAdjustment?: number;
  holdAdjustment?: number;
  meanShift?: number;
  stdDevShift?: number;
  edgeThreshold?: number;
  confidenceThreshold?: number;
  scoreThreshold?: number;
  tierThresholds?: { small: number; medium: number; large: number };
  maxStakeCents?: number;
  volatilityMultiplier?: number;
  maxExposureCents?: number;
  maxConcentrationPct?: number;
  sourceFilter?: string;
  confidenceFilter?: string;
}

interface ScenarioMetrics {
  signalCount: number;
  avgEdge: number;
  avgScore: number;
  avgConfidence: number;
  totalExposureCents: number;
  largeTradeCount: number;
  mediumTradeCount: number;
  smallTradeCount: number;
  avgProbability: number;
  avgModelLine: number;
  concentrationUtilization: number;
}

interface DetailRow {
  label: string;
  baselineValue: string | number;
  scenarioValue: string | number;
  delta: string | number;
  impact: 'positive' | 'negative' | 'neutral';
}

interface ScenarioResult {
  baseline: ScenarioMetrics;
  scenario: ScenarioMetrics;
  delta: ScenarioMetrics;
  details: DetailRow[];
}

interface SandboxRun {
  id: string;
  createdAt: string;
  name: string;
  description?: string;
  scenarioType: string;
  inputs: ScenarioInputs;
  results: ScenarioResult;
  modelTags?: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/*  Styles                                                              */
/* ------------------------------------------------------------------ */

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const grid2: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 };
const grid3: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({
  padding: '6px 14px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600,
});
const inputStyle: React.CSSProperties = { padding: '6px 10px', borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', fontSize: 13, width: '100%' };
const selectStyle: React.CSSProperties = { ...inputStyle };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };

const IMPACT_COLORS = { positive: '#22c55e', negative: '#ef4444', neutral: '#94a3b8' };

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function ResearchSandbox() {
  const [scenarioTypes, setScenarioTypes] = useState<ScenarioTypeInfo[]>([]);
  const [runs, setRuns] = useState<SandboxRun[]>([]);
  const [loading, setLoading] = useState(true);

  // Scenario builder
  const [selType, setSelType] = useState('');
  const [inputs, setInputs] = useState<ScenarioInputs>({});
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [running, setRunning] = useState(false);

  // Save
  const [saveName, setSaveName] = useState('');
  const [saveDesc, setSaveDesc] = useState('');

  // Loaded run
  const [loadedRun, setLoadedRun] = useState<SandboxRun | null>(null);

  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState<'builder' | 'saved'>('builder');

  const fetchData = async () => {
    try {
      const res = await fetch('/api/admin/research-sandbox');
      if (res.ok) {
        const d = await res.json();
        setScenarioTypes(d.scenarioTypes || []);
        setRuns(d.runs || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const setInput = (key: string, value: any) => setInputs(prev => ({ ...prev, [key]: value }));

  const handleRun = async () => {
    if (!selType) { setMsg('Select a scenario type'); return; }
    setRunning(true); setMsg(''); setResult(null); setLoadedRun(null);
    try {
      const res = await fetch('/api/admin/research-sandbox', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run-scenario', scenarioType: selType, inputs }),
      });
      const j = await res.json();
      if (!res.ok) { setMsg(j.error || 'Error'); setRunning(false); return; }
      setResult(j.results);
    } catch (e: any) { setMsg(e.message); }
    setRunning(false);
  };

  const handleSave = async () => {
    if (!saveName || !result || !selType) { setMsg('Run a scenario and enter a name first'); return; }
    try {
      const res = await fetch('/api/admin/research-sandbox', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save-run', name: saveName, scenarioType: selType, inputs, results: result, description: saveDesc }),
      });
      const j = await res.json();
      if (!res.ok) { setMsg(j.error || 'Error'); return; }
      setMsg('Run saved'); setSaveName(''); setSaveDesc('');
      await fetchData();
    } catch (e: any) { setMsg(e.message); }
  };

  const handleLoadRun = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/research-sandbox?action=get-run&id=${id}`);
      if (res.ok) {
        const run = await res.json();
        setLoadedRun(run);
        setResult(run.results);
        setSelType(run.scenarioType);
        setInputs(run.inputs);
        setTab('builder');
      }
    } catch { setMsg('Failed to load run'); }
  };

  const exportCSV = (id: string) => { window.open(`/api/admin/research-sandbox?action=export-csv&id=${id}`, '_blank'); };
  const exportJSON = (id: string) => { window.open(`/api/admin/research-sandbox?action=export-json&id=${id}`, '_blank'); };

  const displayResult = result;

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading research sandbox...</div>;

  const navLinks = [
    { href: '/admin/trading-desk', label: 'Trading Desk' },
    { href: '/admin/operator-dashboard', label: 'Operator' },
    { href: '/admin/reports', label: 'Reports' },
    { href: '/admin/model-governance', label: 'Model Governance' },
    { href: '/admin/research-sandbox', label: 'Research Sandbox', active: true },
  ];

  /* ---- input fields per scenario type ---- */
  const renderInputs = () => {
    switch (selType) {
      case 'pricing':
        return (
          <div style={grid3}>
            <div><label style={{ fontSize: 11, color: '#94a3b8' }}>Mean Shift</label>
              <input type="number" step="0.01" value={inputs.meanShift ?? ''} onChange={e => setInput('meanShift', parseFloat(e.target.value) || 0)} style={inputStyle} placeholder="0.02" /></div>
            <div><label style={{ fontSize: 11, color: '#94a3b8' }}>Std Dev Shift</label>
              <input type="number" step="0.01" value={inputs.stdDevShift ?? ''} onChange={e => setInput('stdDevShift', parseFloat(e.target.value) || 0)} style={inputStyle} placeholder="0.05" /></div>
            <div><label style={{ fontSize: 11, color: '#94a3b8' }}>Vig Adjustment</label>
              <input type="number" step="0.005" value={inputs.vigAdjustment ?? ''} onChange={e => setInput('vigAdjustment', parseFloat(e.target.value) || 0)} style={inputStyle} placeholder="0.02" /></div>
            <div><label style={{ fontSize: 11, color: '#94a3b8' }}>Hold Adjustment</label>
              <input type="number" step="0.005" value={inputs.holdAdjustment ?? ''} onChange={e => setInput('holdAdjustment', parseFloat(e.target.value) || 0)} style={inputStyle} placeholder="0.01" /></div>
          </div>
        );
      case 'signal_filtering':
        return (
          <div style={grid3}>
            <div><label style={{ fontSize: 11, color: '#94a3b8' }}>Edge Threshold</label>
              <input type="number" step="0.01" value={inputs.edgeThreshold ?? ''} onChange={e => setInput('edgeThreshold', parseFloat(e.target.value) || 0)} style={inputStyle} placeholder="0.03" /></div>
            <div><label style={{ fontSize: 11, color: '#94a3b8' }}>Confidence Threshold</label>
              <input type="number" step="0.05" value={inputs.confidenceThreshold ?? ''} onChange={e => setInput('confidenceThreshold', parseFloat(e.target.value) || 0)} style={inputStyle} placeholder="0.5" /></div>
            <div><label style={{ fontSize: 11, color: '#94a3b8' }}>Score Threshold</label>
              <input type="number" step="0.1" value={inputs.scoreThreshold ?? ''} onChange={e => setInput('scoreThreshold', parseFloat(e.target.value) || 0)} style={inputStyle} placeholder="5.0" /></div>
            <div><label style={{ fontSize: 11, color: '#94a3b8' }}>Source Filter</label>
              <input value={inputs.sourceFilter ?? ''} onChange={e => setInput('sourceFilter', e.target.value || undefined)} style={inputStyle} placeholder="Optional" /></div>
          </div>
        );
      case 'sizing':
        return (
          <div style={grid3}>
            <div><label style={{ fontSize: 11, color: '#94a3b8' }}>Max Stake (cents)</label>
              <input type="number" step="100" value={inputs.maxStakeCents ?? ''} onChange={e => setInput('maxStakeCents', parseInt(e.target.value) || 0)} style={inputStyle} placeholder="5000" /></div>
            <div><label style={{ fontSize: 11, color: '#94a3b8' }}>Small Tier Threshold</label>
              <input type="number" step="0.01" value={inputs.tierThresholds?.small ?? ''} onChange={e => setInput('tierThresholds', { ...(inputs.tierThresholds || { small: 0.03, medium: 0.06, large: 0.10 }), small: parseFloat(e.target.value) || 0.03 })} style={inputStyle} placeholder="0.03" /></div>
            <div><label style={{ fontSize: 11, color: '#94a3b8' }}>Medium Tier Threshold</label>
              <input type="number" step="0.01" value={inputs.tierThresholds?.medium ?? ''} onChange={e => setInput('tierThresholds', { ...(inputs.tierThresholds || { small: 0.03, medium: 0.06, large: 0.10 }), medium: parseFloat(e.target.value) || 0.06 })} style={inputStyle} placeholder="0.06" /></div>
            <div><label style={{ fontSize: 11, color: '#94a3b8' }}>Large Tier Threshold</label>
              <input type="number" step="0.01" value={inputs.tierThresholds?.large ?? ''} onChange={e => setInput('tierThresholds', { ...(inputs.tierThresholds || { small: 0.03, medium: 0.06, large: 0.10 }), large: parseFloat(e.target.value) || 0.10 })} style={inputStyle} placeholder="0.10" /></div>
          </div>
        );
      case 'volatility_shock':
        return (
          <div style={grid3}>
            <div><label style={{ fontSize: 11, color: '#94a3b8' }}>Volatility Multiplier</label>
              <input type="number" step="0.1" value={inputs.volatilityMultiplier ?? ''} onChange={e => setInput('volatilityMultiplier', parseFloat(e.target.value) || 1)} style={inputStyle} placeholder="1.5" /></div>
            <div><label style={{ fontSize: 11, color: '#94a3b8' }}>Source Filter</label>
              <input value={inputs.sourceFilter ?? ''} onChange={e => setInput('sourceFilter', e.target.value || undefined)} style={inputStyle} placeholder="Optional" /></div>
            <div><label style={{ fontSize: 11, color: '#94a3b8' }}>Confidence Filter</label>
              <input value={inputs.confidenceFilter ?? ''} onChange={e => setInput('confidenceFilter', e.target.value || undefined)} style={inputStyle} placeholder="Optional" /></div>
          </div>
        );
      case 'portfolio_constraint':
        return (
          <div style={grid3}>
            <div><label style={{ fontSize: 11, color: '#94a3b8' }}>Max Exposure (cents)</label>
              <input type="number" step="10000" value={inputs.maxExposureCents ?? ''} onChange={e => setInput('maxExposureCents', parseInt(e.target.value) || 0)} style={inputStyle} placeholder="500000" /></div>
            <div><label style={{ fontSize: 11, color: '#94a3b8' }}>Max Concentration %</label>
              <input type="number" step="1" value={inputs.maxConcentrationPct ?? ''} onChange={e => setInput('maxConcentrationPct', parseInt(e.target.value) || 0)} style={inputStyle} placeholder="20" /></div>
          </div>
        );
      default:
        return <p style={{ color: '#64748b', fontSize: 13 }}>Select a scenario type above.</p>;
    }
  };

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

      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Research Sandbox</h2>
      <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 16 }}>Test model assumptions and trading decisions safely — no production writes</p>

      {msg && <div style={{ ...card, background: '#1e3a5f', color: '#93c5fd', fontSize: 13 }}>{msg}</div>}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        <button onClick={() => setTab('builder')} style={btn(tab === 'builder' ? '#6366f1' : '#334155')}>Scenario Builder</button>
        <button onClick={() => setTab('saved')} style={btn(tab === 'saved' ? '#6366f1' : '#334155')}>Saved Runs ({runs.length})</button>
      </div>

      {/* ============================================================== */}
      {/* BUILDER TAB                                                      */}
      {/* ============================================================== */}
      {tab === 'builder' && (
        <>
          {/* Scenario type selector */}
          <div style={card}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Scenario Type</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              {scenarioTypes.map(st => (
                <button key={st.type} onClick={() => { setSelType(st.type); setResult(null); setInputs({}); }} style={{
                  ...btn(selType === st.type ? '#6366f1' : '#334155'), fontSize: 12,
                }}>
                  {st.label}
                </button>
              ))}
            </div>
            {selType && (
              <p style={{ fontSize: 12, color: '#94a3b8' }}>
                {scenarioTypes.find(s => s.type === selType)?.description}
              </p>
            )}
          </div>

          {/* Inputs */}
          {selType && (
            <div style={card}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Scenario Inputs</h3>
              {renderInputs()}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={handleRun} disabled={running} style={btn('#22c55e')}>
                  {running ? 'Running...' : 'Run Scenario'}
                </button>
              </div>
            </div>
          )}

          {/* Results */}
          {displayResult && (
            <>
              {/* Baseline vs Scenario cards */}
              <div style={grid2}>
                <div style={card}>
                  <h4 style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8', marginBottom: 8 }}>Baseline</h4>
                  <div style={grid3}>
                    <div><div style={{ fontSize: 20, fontWeight: 700 }}>{displayResult.baseline.signalCount}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>Signals</div></div>
                    <div><div style={{ fontSize: 20, fontWeight: 700 }}>{(displayResult.baseline.avgEdge * 100).toFixed(2)}%</div><div style={{ fontSize: 11, color: '#94a3b8' }}>Avg Edge</div></div>
                    <div><div style={{ fontSize: 20, fontWeight: 700 }}>{displayResult.baseline.avgScore.toFixed(1)}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>Avg Score</div></div>
                    <div><div style={{ fontSize: 20, fontWeight: 700 }}>${(displayResult.baseline.totalExposureCents / 100).toFixed(0)}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>Exposure</div></div>
                  </div>
                </div>
                <div style={card}>
                  <h4 style={{ fontSize: 13, fontWeight: 600, color: '#93c5fd', marginBottom: 8 }}>Scenario</h4>
                  <div style={grid3}>
                    <div><div style={{ fontSize: 20, fontWeight: 700 }}>{displayResult.scenario.signalCount}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>Signals</div></div>
                    <div><div style={{ fontSize: 20, fontWeight: 700 }}>{(displayResult.scenario.avgEdge * 100).toFixed(2)}%</div><div style={{ fontSize: 11, color: '#94a3b8' }}>Avg Edge</div></div>
                    <div><div style={{ fontSize: 20, fontWeight: 700 }}>{displayResult.scenario.avgScore.toFixed(1)}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>Avg Score</div></div>
                    <div><div style={{ fontSize: 20, fontWeight: 700 }}>${(displayResult.scenario.totalExposureCents / 100).toFixed(0)}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>Exposure</div></div>
                  </div>
                </div>
              </div>

              {/* Detailed comparison table */}
              <div style={card}>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Detailed Comparison</h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={th}>Metric</th>
                        <th style={th}>Baseline</th>
                        <th style={th}>Scenario</th>
                        <th style={th}>Delta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayResult.details.map((d, i) => (
                        <tr key={i}>
                          <td style={td}>{d.label}</td>
                          <td style={td}>{String(d.baselineValue)}</td>
                          <td style={td}>{String(d.scenarioValue)}</td>
                          <td style={{ ...td, color: IMPACT_COLORS[d.impact], fontWeight: 600 }}>{String(d.delta)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Model tags if loaded from saved run */}
              {loadedRun?.modelTags && Object.keys(loadedRun.modelTags).length > 0 && (
                <div style={card}>
                  <h4 style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>Model Tags at Run Time</h4>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {Object.entries(loadedRun.modelTags).map(([k, v]) => (
                      <span key={k} style={{ padding: '2px 8px', borderRadius: 9999, fontSize: 11, background: '#334155', color: '#cbd5e1' }}>{v}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Save controls */}
              <div style={{ ...card, display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <label style={{ fontSize: 11, color: '#94a3b8' }}>Run Name</label>
                  <input value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="My pricing test" style={inputStyle} />
                </div>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <label style={{ fontSize: 11, color: '#94a3b8' }}>Description</label>
                  <input value={saveDesc} onChange={e => setSaveDesc(e.target.value)} placeholder="Optional" style={inputStyle} />
                </div>
                <button onClick={handleSave} style={btn('#3b82f6')}>Save Run</button>
              </div>
            </>
          )}
        </>
      )}

      {/* ============================================================== */}
      {/* SAVED RUNS TAB                                                   */}
      {/* ============================================================== */}
      {tab === 'saved' && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Name</th>
                <th style={th}>Type</th>
                <th style={th}>Created</th>
                <th style={th}>Signals (B/S)</th>
                <th style={th}>Avg Edge (B/S)</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {runs.map(r => (
                <tr key={r.id}>
                  <td style={td}>
                    <div style={{ fontWeight: 600 }}>{r.name}</div>
                    {r.description && <div style={{ fontSize: 11, color: '#64748b' }}>{r.description}</div>}
                  </td>
                  <td style={td}><span style={{ padding: '2px 8px', borderRadius: 9999, fontSize: 11, background: '#334155', color: '#cbd5e1' }}>{r.scenarioType}</span></td>
                  <td style={td}>{r.createdAt?.slice(0, 16).replace('T', ' ')}</td>
                  <td style={td}>{r.results.baseline.signalCount} / {r.results.scenario.signalCount}</td>
                  <td style={td}>{(r.results.baseline.avgEdge * 100).toFixed(1)}% / {(r.results.scenario.avgEdge * 100).toFixed(1)}%</td>
                  <td style={td}>
                    <button onClick={() => handleLoadRun(r.id)} style={{ ...btn('#6366f1'), fontSize: 11, marginRight: 4 }}>Open</button>
                    <button onClick={() => exportJSON(r.id)} style={{ ...btn('#334155'), fontSize: 11, marginRight: 4 }}>JSON</button>
                    <button onClick={() => exportCSV(r.id)} style={{ ...btn('#334155'), fontSize: 11 }}>CSV</button>
                  </td>
                </tr>
              ))}
              {runs.length === 0 && <tr><td colSpan={6} style={{ ...td, color: '#64748b', textAlign: 'center' }}>No saved runs yet. Run a scenario and save it.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

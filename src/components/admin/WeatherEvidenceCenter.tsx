import React, { useEffect, useMemo, useState } from 'react';
import SystemNav from './SystemNav';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const tile: React.CSSProperties = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 12 };
const btn = (bg: string): React.CSSProperties => ({ padding: '6px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, textDecoration: 'none', display: 'inline-block' });
const input: React.CSSProperties = { background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', padding: '6px 8px', borderRadius: 6, fontSize: 12 };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (bg: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: bg, color: '#fff' });

const verdictColor: Record<string, string> = {
  strong_evidence: '#22c55e',
  mixed_evidence: '#f59e0b',
  insufficient_evidence: '#64748b',
  conflict_requires_review: '#ef4444',
};
const verdictLabel: Record<string, string> = {
  strong_evidence: 'Strong Evidence',
  mixed_evidence: 'Mixed Evidence',
  insufficient_evidence: 'Insufficient Evidence',
  conflict_requires_review: 'Conflict — Requires Review',
};
const useColor: Record<string, string> = {
  safe_for_manual_grading: '#22c55e',
  review_before_grading: '#f59e0b',
  do_not_grade_without_more_data: '#ef4444',
};
const useLabel: Record<string, string> = {
  safe_for_manual_grading: 'Safe for manual grading',
  review_before_grading: 'Review before grading',
  do_not_grade_without_more_data: 'Do not grade without more data',
};
const sourceConfColor: Record<string, string> = { high: '#22c55e', medium: '#3b82f6', low: '#f59e0b', unknown: '#64748b' };

const BANNER: React.CSSProperties = {
  background: 'linear-gradient(90deg, #0c4a6e, #0369a1)', color: '#fff',
  padding: '10px 14px', borderRadius: 8, marginBottom: 16,
  fontSize: 13, fontWeight: 600, display: 'flex', justifyContent: 'space-between',
  alignItems: 'center', gap: 12, flexWrap: 'wrap',
};

type Tab = 'overview' | 'create' | 'wager' | 'conflicts' | 'methodology';

const METRIC_OPTIONS = [
  'actual_temp', 'high_temp', 'low_temp',
  'actual_wind', 'actual_gust',
  'rain_in', 'snow_in', 'humidity_pct', 'pressure_in', 'cloud_cover_pct',
];

export default function WeatherEvidenceCenter() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<any>(null);
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<any>(null);
  const [wagerLookup, setWagerLookup] = useState('');
  const [wagerEvidence, setWagerEvidence] = useState<any[]>([]);

  useEffect(() => { reload(); }, []);

  async function get(action: string, params: Record<string, string> = {}) {
    const q = new URLSearchParams({ action, ...params });
    const res = await fetch(`/api/admin/system/weather-evidence?${q.toString()}`, { credentials: 'include' });
    const j = await res.json();
    if (!res.ok) throw new Error(j.message ?? j.error ?? 'failed');
    return j;
  }
  async function post(body: any) {
    const res = await fetch('/api/admin/system/weather-evidence', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.message ?? j.error ?? 'failed');
    return j;
  }

  async function reload() {
    setLoading(true); setError(null);
    try {
      const j = await get('summary');
      setSummary(j.summary);
      setRecords(j.records ?? []);
    } catch (e: any) { setError(e?.message ?? 'network'); }
    setLoading(false);
  }

  async function open(id: string) {
    setBusy(`open-${id}`); setError(null);
    try {
      const j = await get('get', { id });
      setActive(j.record);
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  async function lookupWager(id: string) {
    if (!id.trim()) { setWagerEvidence([]); return; }
    setBusy(`wager-${id}`); setError(null);
    try {
      const j = await get('get-by-wager', { wagerId: id.trim() });
      setWagerEvidence(j.records ?? []);
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  async function createEvidence(payload: any) {
    setBusy('create'); setError(null);
    try {
      const j = await post({ action: 'create-manual-evidence', ...payload });
      setActive(j.record);
      setTab('overview');
      await reload();
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  async function addNote(id: string, note: string) {
    if (!note.trim()) return;
    setBusy('note'); setError(null);
    try {
      const j = await post({ action: 'add-note', id, note });
      setActive(j.record);
      await reload();
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  async function link(id: string, wagerId: string) {
    if (!wagerId.trim()) return;
    setBusy('link'); setError(null);
    try {
      const j = await post({ action: 'link-to-wager', id, wagerId });
      setActive(j.record);
      await reload();
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading weather evidence…</div>;
  if (!summary) return null;

  const conflicts = useMemo(() => records.filter(r => r.verdict === 'conflict_requires_review'), [records]);

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}><SystemNav activeHref="/admin/system/weather-evidence" /></div>

      <div style={BANNER}>
        <span>🌦️ Weather Evidence supports human review only. It does <strong>not</strong> grade wagers, void markets, settle balances, or change outcomes.</span>
        <span style={{ fontSize: 11, opacity: 0.85 }}>Audit-logged · Advisory only</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Data Source Confidence & Weather Evidence</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', maxWidth: 820 }}>
            Capture observed values from multiple sources. The lib computes consensus (median), spread (max − min), confidence, and a verdict against metric-specific tolerances. Evidence supports manual grading; it never grades on its own.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a href="/admin/system/wager-resolution" style={btn('#0ea5e9')}>Wager Resolution →</a>
          <a href="/admin/system/dispute-workflow" style={btn('#0ea5e9')}>Disputes →</a>
          <a href="/admin/system/incident-management" style={btn('#0ea5e9')}>Incident Management →</a>
          <button type="button" onClick={() => setTab('create')} style={btn('#22c55e')}
            title="Open the manual evidence-entry form. Does not grade.">+ Create Evidence</button>
          <button type="button" onClick={reload} disabled={!!busy} style={btn('#6366f1')}>Refresh</button>
        </div>
      </div>

      {error && <div style={{ ...card, background: '#7f1d1d', color: '#fecaca' }}>{error}</div>}

      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
          <Stat label="Records" value={summary.total} />
          <Stat label="Strong" value={summary.byVerdict.strong_evidence} color={verdictColor.strong_evidence} />
          <Stat label="Mixed" value={summary.byVerdict.mixed_evidence} color={verdictColor.mixed_evidence} />
          <Stat label="Insufficient" value={summary.byVerdict.insufficient_evidence} color={verdictColor.insufficient_evidence} />
          <Stat label="Conflicts" value={summary.byVerdict.conflict_requires_review} color={verdictColor.conflict_requires_review} />
          <Stat label="Avg confidence" value={summary.averageConfidence == null ? '—' : `${summary.averageConfidence}`} color={(summary.averageConfidence ?? 0) >= 75 ? '#22c55e' : '#f59e0b'} />
          <Stat label="Linked to wagers" value={summary.linkedToWagers} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          ['overview', `Evidence Overview (${summary.total})`],
          ['create',   'Create Evidence'],
          ['wager',    'Wager Evidence'],
          ['conflicts', `Conflict Review (${conflicts.length})`],
          ['methodology', 'Methodology'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            style={{ ...btn(tab === t ? '#6366f1' : '#334155'), padding: '8px 14px', fontSize: 13 }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <OverviewView records={records} active={active} setActive={setActive} open={open} addNote={addNote} link={link} busy={busy} />
      )}
      {tab === 'create' && (
        <CreateView onSubmit={createEvidence} busy={busy === 'create'} />
      )}
      {tab === 'wager' && (
        <WagerEvidenceView wagerLookup={wagerLookup} setWagerLookup={setWagerLookup} lookupWager={lookupWager} wagerEvidence={wagerEvidence} open={open} busy={busy} />
      )}
      {tab === 'conflicts' && (
        <ConflictsView conflicts={conflicts} open={open} />
      )}
      {tab === 'methodology' && <MethodologyView />}
    </div>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────

function OverviewView({ records, active, setActive, open, addNote, link, busy }: any) {
  if (!records || records.length === 0) {
    return (
      <div style={{ ...card, color: '#94a3b8' }}>
        No evidence records yet. Use <strong>Create Evidence</strong> to capture observed values from multiple weather sources.
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16 }}>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Recent ({records.length})</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {records.slice(0, 50).map((r: any) => (
            <button key={r.id} type="button" onClick={() => open(r.id)}
              style={{
                ...tile, textAlign: 'left', cursor: 'pointer',
                border: r.id === active?.id ? '1px solid #6366f1' : '1px solid #1e293b',
                background: r.id === active?.id ? '#312e81' : '#0f172a',
              }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={badge(verdictColor[r.verdict])}>{r.verdict.replace(/_/g, ' ')}</span>
                <span style={{ fontSize: 11, fontWeight: 700 }}>conf {r.confidenceScore}</span>
              </div>
              <div style={{ fontSize: 12, color: '#cbd5e1' }}>{r.metric} · {r.location}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>{r.targetDate}{r.targetTime ? ` ${r.targetTime}` : ''} · {(r.sources ?? []).length} src</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>{new Date(r.createdAt).toLocaleString()}</div>
            </button>
          ))}
        </div>
      </div>
      <div>
        {active ? <DetailView record={active} addNote={addNote} link={link} busy={busy} /> : (
          <div style={{ ...card, color: '#94a3b8' }}>Pick a record on the left.</div>
        )}
      </div>
    </div>
  );
}

function DetailView({ record, addNote, link, busy }: any) {
  const [noteDraft, setNoteDraft] = useState('');
  const [linkDraft, setLinkDraft] = useState(record.wagerId ?? '');
  const r = record;

  return (
    <>
      <div style={{ ...card, borderLeft: `3px solid ${verdictColor[r.verdict]}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{r.metric} @ {r.location}</h2>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={badge(verdictColor[r.verdict])}>{verdictLabel[r.verdict]}</span>
            <span style={badge(useColor[r.recommendedUse])}>{useLabel[r.recommendedUse]}</span>
            <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'ui-monospace, Menlo, monospace' }}>conf {r.confidenceScore}</span>
          </div>
        </div>
        <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
          <Field label="Evidence id" value={r.id} mono />
          <Field label="Target date" value={`${r.targetDate}${r.targetTime ? ' ' + r.targetTime : ''}`} />
          <Field label="Created" value={`${new Date(r.createdAt).toLocaleString()} · ${r.createdBy}`} />
          <Field label="Linked wager" value={r.wagerId ?? '—'} mono />
          <Field label="Consensus" value={r.consensusValue == null ? '—' : `${r.consensusValue}`} />
          <Field label="Spread" value={r.sourceSpread == null ? '—' : `${r.sourceSpread.toFixed(2)}`} />
        </div>
      </div>

      {/* Sources */}
      <div style={card}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Sources ({(r.sources ?? []).length})</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Source</th><th style={th}>Observed</th><th style={th}>Unit</th>
                <th style={th}>Observed at</th><th style={th}>Station</th><th style={th}>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {(r.sources ?? []).map((s: any, idx: number) => (
                <tr key={idx}>
                  <td style={td}>{s.sourceName}</td>
                  <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontWeight: 700 }}>{s.observedValue}</td>
                  <td style={td}>{s.unit}</td>
                  <td style={td}>{s.observedAt ? new Date(s.observedAt).toLocaleString() : '—'}</td>
                  <td style={td}>{s.stationId ?? '—'}</td>
                  <td style={td}><span style={badge(sourceConfColor[s.confidence] ?? '#64748b')}>{s.confidence}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {(r.warnings ?? []).length > 0 && (
        <div style={{ ...card, background: '#3f1d1d', borderLeft: '3px solid #ef4444' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: '#fca5a5' }}>Warnings ({r.warnings.length})</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#fecaca' }}>
            {r.warnings.map((w: string, idx: number) => <li key={idx}>{w}</li>)}
          </ul>
        </div>
      )}

      {/* Notes */}
      <div style={card}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Notes ({(r.notes ?? []).length})</h3>
        {(r.notes ?? []).length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 13 }}>No notes yet.</div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#cbd5e1' }}>
            {r.notes.map((n: string, idx: number) => <li key={idx} style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{n}</li>)}
          </ul>
        )}
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <input style={{ ...input, flex: 1, minWidth: 240 }} placeholder="Add a note (e.g. 'verified against airport METAR')" value={noteDraft} onChange={e => setNoteDraft(e.target.value)} />
          <button type="button" onClick={() => { addNote(r.id, noteDraft); setNoteDraft(''); }} disabled={!!busy || !noteDraft.trim()} style={btn('#6366f1')}
            title="Append a timestamped note. Audit-logged.">Add note</button>
        </div>
      </div>

      {/* Link to wager */}
      <div style={card}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Link to wager</h3>
        <p style={{ margin: '0 0 8px', fontSize: 12, color: '#94a3b8' }}>
          Evidence can be linked to a wager but never grades it. Operators see linked evidence in Wager Resolution as a reference.
        </p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <input style={{ ...input, flex: 1, minWidth: 240 }} placeholder="Wager id" value={linkDraft} onChange={e => setLinkDraft(e.target.value)} />
          <button type="button" onClick={() => link(r.id, linkDraft)} disabled={!!busy || !linkDraft.trim()} style={btn('#0ea5e9')}
            title="Link this evidence to a wager id. Does not modify the wager.">
            {r.wagerId ? 'Update link' : 'Link to wager'}
          </button>
        </div>
      </div>
    </>
  );
}

// ── Create ───────────────────────────────────────────────────────────────────

function CreateView({ onSubmit, busy }: { onSubmit: (payload: any) => void; busy: boolean }) {
  const [location, setLocation] = useState('');
  const [metric, setMetric] = useState('actual_temp');
  const [customMetric, setCustomMetric] = useState('');
  const [targetDate, setTargetDate] = useState(new Date().toISOString().slice(0, 10));
  const [targetTime, setTargetTime] = useState('');
  const [wagerId, setWagerId] = useState('');
  const [overrideNote, setOverrideNote] = useState('');
  const [sources, setSources] = useState<any[]>([
    { sourceName: '', observedValue: '', unit: '°F', observedAt: new Date().toISOString().slice(0, 16), stationId: '', confidence: 'medium', notes: [] },
  ]);

  function addSource() {
    setSources(prev => [...prev, { sourceName: '', observedValue: '', unit: prev[0]?.unit ?? '', observedAt: new Date().toISOString().slice(0, 16), stationId: '', confidence: 'medium', notes: [] }]);
  }
  function removeSource(idx: number) {
    setSources(prev => prev.filter((_, i) => i !== idx));
  }
  function updateSource(idx: number, key: string, value: any) {
    setSources(prev => prev.map((s, i) => i === idx ? { ...s, [key]: value } : s));
  }

  const finalMetric = metric === '__custom' ? customMetric.trim() : metric;
  const canSubmit = !busy && !!location.trim() && !!finalMetric && !!targetDate && sources.length > 0
    && sources.every(s => s.sourceName.trim() && s.unit.trim() && s.observedAt && Number.isFinite(Number(s.observedValue)));

  function submit() {
    onSubmit({
      location: location.trim(),
      metric: finalMetric,
      targetDate,
      targetTime: targetTime.trim() || undefined,
      wagerId: wagerId.trim() || undefined,
      sources: sources.map(s => ({
        sourceName: s.sourceName.trim(),
        observedValue: Number(s.observedValue),
        unit: s.unit.trim(),
        observedAt: new Date(s.observedAt).toISOString(),
        stationId: s.stationId?.trim() || undefined,
        confidence: s.confidence,
      })),
      notes: overrideNote.trim() ? [overrideNote.trim()] : [],
    });
  }

  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Manual evidence entry</h3>
      <p style={{ margin: '0 0 12px', fontSize: 12, color: '#94a3b8' }}>
        Enter at least one source observation. The lib computes consensus, spread, and verdict against metric-specific tolerances.
        Manual entry only — never grades a wager.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, marginBottom: 8 }}>
        <Lbl label="Location *">
          <input style={{ ...input, width: '100%' }} placeholder="e.g. CLT, Charlotte NC" value={location} onChange={e => setLocation(e.target.value)} />
        </Lbl>
        <Lbl label="Metric *">
          <select style={{ ...input, width: '100%' }} value={metric} onChange={(e: any) => setMetric(e.target.value)}>
            {METRIC_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
            <option value="__custom">custom…</option>
          </select>
        </Lbl>
        {metric === '__custom' && (
          <Lbl label="Custom metric *">
            <input style={{ ...input, width: '100%' }} value={customMetric} onChange={e => setCustomMetric(e.target.value)} />
          </Lbl>
        )}
        <Lbl label="Target date *">
          <input type="date" style={{ ...input, width: '100%' }} value={targetDate} onChange={e => setTargetDate(e.target.value)} />
        </Lbl>
        <Lbl label="Target time (optional, HH:MM)">
          <input type="time" style={{ ...input, width: '100%' }} value={targetTime} onChange={e => setTargetTime(e.target.value)} />
        </Lbl>
        <Lbl label="Linked wager id (optional)">
          <input style={{ ...input, width: '100%' }} value={wagerId} onChange={e => setWagerId(e.target.value)} />
        </Lbl>
      </div>

      <div style={{ marginTop: 10, marginBottom: 6, fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>Sources</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sources.map((s, idx) => (
          <div key={idx} style={{ ...tile, padding: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 6 }}>
              <Lbl label="Source name *">
                <input style={{ ...input, width: '100%' }} value={s.sourceName} onChange={e => updateSource(idx, 'sourceName', e.target.value)} placeholder="e.g. NWS KCLT" />
              </Lbl>
              <Lbl label="Observed value *">
                <input style={{ ...input, width: '100%' }} inputMode="decimal" value={s.observedValue} onChange={e => updateSource(idx, 'observedValue', e.target.value)} />
              </Lbl>
              <Lbl label="Unit *">
                <input style={{ ...input, width: '100%' }} value={s.unit} onChange={e => updateSource(idx, 'unit', e.target.value)} placeholder="°F" />
              </Lbl>
              <Lbl label="Observed at *">
                <input type="datetime-local" style={{ ...input, width: '100%' }} value={s.observedAt} onChange={e => updateSource(idx, 'observedAt', e.target.value)} />
              </Lbl>
              <Lbl label="Station id (optional)">
                <input style={{ ...input, width: '100%' }} value={s.stationId} onChange={e => updateSource(idx, 'stationId', e.target.value)} />
              </Lbl>
              <Lbl label="Confidence">
                <select style={{ ...input, width: '100%' }} value={s.confidence} onChange={(e: any) => updateSource(idx, 'confidence', e.target.value)}>
                  <option value="high">high</option>
                  <option value="medium">medium</option>
                  <option value="low">low</option>
                  <option value="unknown">unknown</option>
                </select>
              </Lbl>
            </div>
            {sources.length > 1 && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                <button type="button" onClick={() => removeSource(idx)} style={btn('#475569')} title="Remove this source row">Remove</button>
              </div>
            )}
          </div>
        ))}
        <div>
          <button type="button" onClick={addSource} style={btn('#475569')} title="Add another source row">+ Add source</button>
        </div>
      </div>

      <Lbl label="Override note (optional — set 'override' or 'verified' to allow single-source strong verdict)" style={{ display: 'block', marginTop: 12 }}>
        <input style={{ ...input, width: '100%' }} value={overrideNote} onChange={e => setOverrideNote(e.target.value)} placeholder="" />
      </Lbl>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
        <button type="button" onClick={submit} disabled={!canSubmit} style={btn(canSubmit ? '#22c55e' : '#475569')}
          title="Persist the evidence record. Audit-logged. Does not grade or modify wagers.">
          {busy ? 'Creating…' : 'Create Evidence'}
        </button>
      </div>
    </div>
  );
}

function Lbl({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <label style={{ fontSize: 11, color: '#94a3b8', ...style }}>
      {label}
      <div style={{ marginTop: 4 }}>{children}</div>
    </label>
  );
}

// ── Wager Evidence ──────────────────────────────────────────────────────────

function WagerEvidenceView({ wagerLookup, setWagerLookup, lookupWager, wagerEvidence, open, busy }: any) {
  return (
    <>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Look up evidence by wager</h3>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <input style={{ ...input, flex: 1, minWidth: 280 }} placeholder="Wager id (e.g. wgr-...)" value={wagerLookup} onChange={e => setWagerLookup(e.target.value)} />
          <button type="button" onClick={() => lookupWager(wagerLookup)} disabled={!!busy || !wagerLookup.trim()} style={btn('#0ea5e9')}>
            Lookup
          </button>
        </div>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Evidence linked to wager ({wagerEvidence.length})</h3>
        {wagerEvidence.length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 13 }}>No linked evidence (or no lookup performed yet).</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Verdict</th><th style={th}>Conf</th><th style={th}>Metric</th>
                <th style={th}>Location</th><th style={th}>Target</th><th style={th}>Sources</th>
                <th style={th}>Created</th><th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {wagerEvidence.map((r: any) => (
                <tr key={r.id}>
                  <td style={td}><span style={badge(verdictColor[r.verdict])}>{verdictLabel[r.verdict]}</span></td>
                  <td style={td}>{r.confidenceScore}</td>
                  <td style={td}>{r.metric}</td>
                  <td style={td}>{r.location}</td>
                  <td style={td}>{r.targetDate}{r.targetTime ? ` ${r.targetTime}` : ''}</td>
                  <td style={td}>{(r.sources ?? []).length}</td>
                  <td style={td}>{new Date(r.createdAt).toLocaleString()}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <button type="button" onClick={() => open(r.id)} style={{ ...btn('#475569'), padding: '4px 10px' }}>Open</button>
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

// ── Conflict Review ──────────────────────────────────────────────────────────

function ConflictsView({ conflicts, open }: { conflicts: any[]; open: (id: string) => void }) {
  if (conflicts.length === 0) {
    return <div style={{ ...card, color: '#22c55e' }}>✓ No conflict-requiring-review records.</div>;
  }
  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Conflict review queue ({conflicts.length})</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Metric</th><th style={th}>Location</th><th style={th}>Target</th>
            <th style={th}>Spread</th><th style={th}>Sources</th><th style={th}>Linked wager</th>
            <th style={th}>Created</th><th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {conflicts.map((r: any) => (
            <tr key={r.id}>
              <td style={td}>{r.metric}</td>
              <td style={td}>{r.location}</td>
              <td style={td}>{r.targetDate}{r.targetTime ? ` ${r.targetTime}` : ''}</td>
              <td style={{ ...td, color: '#ef4444' }}>{r.sourceSpread == null ? '—' : r.sourceSpread.toFixed(2)}</td>
              <td style={td}>{(r.sources ?? []).length}</td>
              <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{r.wagerId ?? '—'}</td>
              <td style={td}>{new Date(r.createdAt).toLocaleString()}</td>
              <td style={{ ...td, whiteSpace: 'nowrap' }}>
                <button type="button" onClick={() => open(r.id)} style={{ ...btn('#475569'), padding: '4px 10px' }}>Open</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Methodology ──────────────────────────────────────────────────────────────

function MethodologyView() {
  return (
    <>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Tolerances</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li>temperature metrics → 1.5°F</li>
          <li>wind metrics → 3 mph</li>
          <li>gust metrics → 5 mph</li>
          <li>any other metric → 2 (units agnostic)</li>
        </ul>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Verdict rules</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li><strong>insufficient_evidence</strong> — fewer than 2 sources (unless override note signals manual verification).</li>
          <li><strong>conflict_requires_review</strong> — spread &gt; metric tolerance.</li>
          <li><strong>strong_evidence</strong> — ≥ 2 sources, spread ≤ half tolerance, no low-confidence sources, single unit.</li>
          <li><strong>mixed_evidence</strong> — anything else with ≥ 2 sources within tolerance.</li>
        </ul>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Confidence score (0–100)</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li>Single source: -30. Two sources: -10.</li>
          <li>Spread &gt; 2× tolerance: -50. &gt; tolerance: -25. &gt; half tolerance: -8.</li>
          <li>Each low/unknown-confidence source: -8 (capped at -20).</li>
          <li>Multiple unit labels among sources: -15. Unit mismatch with metric default: -5.</li>
          <li>Invalid observedAt: -5.</li>
        </ul>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Recommended use</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li><strong>safe_for_manual_grading</strong> — strong_evidence verdict.</li>
          <li><strong>review_before_grading</strong> — mixed_evidence.</li>
          <li><strong>do_not_grade_without_more_data</strong> — insufficient_evidence or conflict_requires_review.</li>
        </ul>
      </div>

      <div style={{ ...card, borderLeft: '3px solid #22c55e' }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Safety guarantees</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li>The lib only imports <code>getRedis</code> + <code>logAuditEvent</code>. No wager-store / wallet-store / pricing-engine imports.</li>
          <li>No wager grading, no wager mutation, no balance updates, no pricing changes.</li>
          <li>"Link to wager" is a pointer only — the wager record is not modified.</li>
          <li>Writes confined to <code>weather-evidence:&#123;id&#125;</code>, <code>weather-evidence:all</code>, <code>weather-evidence:wager:&#123;wagerId&#125;</code>, plus the audit log.</li>
          <li>Audit events: <code>weather_evidence_created</code>, <code>weather_evidence_note_added</code>, <code>weather_evidence_linked_to_wager</code>.</li>
        </ul>
      </div>
    </>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function Stat({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div style={tile}>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color ?? '#e2e8f0', fontFamily: 'ui-monospace, Menlo, monospace' }}>{value}</div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={tile}>
      <div style={{ fontSize: 11, color: '#94a3b8' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, fontFamily: mono ? 'ui-monospace, Menlo, monospace' : undefined, wordBreak: 'break-all' }}>{value}</div>
    </div>
  );
}

// ── Step 144 / 145 / 146: Weather Market Idea Generator (admin-only UI) ──
//
// Generates draft cross-location pointspread ideas from current forecast
// data and (Step 146) lets the admin save promising ones to a review
// queue. **Idea-only.** No publish button, no market creation. The
// only way to actually create a market is for the operator to follow
// the prefilled "Use this idea →" link to the existing wager-create
// form and click Create Wager themselves.
//
// Step 145: target-difference search workflow + assisted prefill link.
// Step 146: saved-idea review queue with statuses
//           (saved | reviewed | rejected | used), operator notes,
//           and duplicate detection.

import React, { useEffect, useMemo, useState } from 'react';
import SystemNav from './SystemNav';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const tile: React.CSSProperties = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 12 };
const btn = (bg: string): React.CSSProperties => ({ padding: '6px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const link = (bg: string): React.CSSProperties => ({ padding: '6px 12px', borderRadius: 6, background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, textDecoration: 'none', display: 'inline-block' });
const input: React.CSSProperties = { background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', padding: '6px 8px', borderRadius: 6, fontSize: 12 };
const textareaStyle: React.CSSProperties = { ...input, minHeight: 60, fontFamily: 'inherit', resize: 'vertical' };
const labelStyle: React.CSSProperties = { fontSize: 11, color: '#94a3b8', marginBottom: 4, display: 'block' };
const sectionHeader: React.CSSProperties = { fontSize: 16, fontWeight: 800, marginBottom: 8, color: '#e2e8f0' };
const muted: React.CSSProperties = { fontSize: 12, color: '#94a3b8' };

const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: '8px 14px',
  borderRadius: 6,
  border: 'none',
  background: active ? '#0e7490' : '#334155',
  color: '#fff',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
});

const BANNER: React.CSSProperties = {
  background: 'linear-gradient(90deg, #7f1d1d, #b91c1c)',
  color: '#fff',
  padding: '10px 14px',
  borderRadius: 8,
  marginBottom: 16,
  fontSize: 13,
  fontWeight: 600,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
};

interface SeedCity {
  id: string;
  label: string;
  lat: number;
  lon: number;
  region: string;
}

type IdeaMetric = 'daily_high' | 'daily_low';
type ConfidenceLabel = 'higher' | 'medium' | 'lower';
type MetricPairOption = 'high_vs_high' | 'low_vs_low' | 'high_vs_low' | 'any_temperature_pair';
type SavedIdeaStatus = 'saved' | 'reviewed' | 'rejected' | 'used';

const METRIC_PAIR_LABELS: Record<MetricPairOption, string> = {
  any_temperature_pair: 'Any temperature pair',
  high_vs_high: 'High vs High',
  low_vs_low: 'Low vs Low',
  high_vs_low: 'High vs Low (cross-metric)',
};

const STATUS_LABELS: Record<SavedIdeaStatus, string> = {
  saved: 'Saved',
  reviewed: 'Reviewed',
  rejected: 'Rejected',
  used: 'Used',
};

const STATUS_TONES: Record<SavedIdeaStatus, string> = {
  saved: '#0ea5e9',
  reviewed: '#a78bfa',
  rejected: '#94a3b8',
  used: '#22c55e',
};

interface IdeaLocation {
  id: string;
  label: string;
  lat: number;
  lon: number;
  region: string;
}

interface WeatherMarketIdea {
  id: string;
  title: string;
  description: string;
  kind: 'pointspread';
  locationA: IdeaLocation;
  locationB: IdeaLocation;
  metricA: IdeaMetric;
  metricB: IdeaMetric;
  targetDate: string;
  forecastValueA: number;
  forecastValueB: number;
  rawDifference: number;
  absDifference: number;
  suggestedSpread: number;
  suggestedOddsA: number;
  suggestedOddsB: number;
  confidenceLabel: ConfidenceLabel;
  rationale: string;
  warnings: string[];
  status: 'idea_only';
  setupNotes: string;
  interestingnessScore: number;
  closenessToTarget?: number;
  prefillQuery: string;
}

interface GenerateResult {
  generatedAt: string;
  targetDate: string;
  cityCount: number;
  ideas: WeatherMarketIdea[];
  warnings: string[];
  resolved: {
    metricPair: MetricPairOption;
    targetDifferenceF?: number;
    toleranceF?: number;
    candidateSet: string;
    cityIds: string[];
  };
}

interface SavedIdeaSearchContext {
  targetDifferenceF?: number;
  toleranceF?: number;
  dayOffset?: number;
  metricPair?: MetricPairOption;
}

interface SavedWeatherMarketIdea {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: SavedIdeaStatus;
  idea: WeatherMarketIdea;
  operatorNote?: string;
  source: 'generator';
  searchContext?: SavedIdeaSearchContext;
  prefillQuery: string;
  warningFlags: string[];
  fingerprint: string;
}

interface BootstrapResponse {
  seedCities: SeedCity[];
  metricPairOptions: MetricPairOption[];
  savedIdeaStatuses: SavedIdeaStatus[];
  limits: {
    targetDifferenceFMax: number;
    toleranceFMax: number;
    maxResultsCap: number;
    savedIdeasCap: number;
    operatorNoteMaxLen: number;
  };
}

const API = '/api/admin/system/weather-market-ideas';

const METRIC_LABELS: Record<IdeaMetric, string> = {
  daily_high: 'High',
  daily_low: 'Low',
};

function defaultTargetDate(daysAhead = 1): string {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

function copyToClipboard(text: string) {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return;
  void navigator.clipboard.writeText(text).catch(() => {});
}

function confidenceTone(label: ConfidenceLabel): string {
  if (label === 'higher') return '#22c55e';
  if (label === 'medium') return '#fbbf24';
  return '#94a3b8';
}

export default function WeatherMarketIdeaGenerator() {
  const [tab, setTab] = useState<'generate' | 'saved'>('generate');
  const [seedCities, setSeedCities] = useState<SeedCity[]>([]);
  const [metricPairOptions, setMetricPairOptions] = useState<MetricPairOption[]>([
    'any_temperature_pair', 'high_vs_high', 'low_vs_low', 'high_vs_low',
  ]);
  const [statusOptions, setStatusOptions] = useState<SavedIdeaStatus[]>([
    'saved', 'reviewed', 'rejected', 'used',
  ]);
  const [limits, setLimits] = useState<BootstrapResponse['limits']>({
    targetDifferenceFMax: 80,
    toleranceFMax: 20,
    maxResultsCap: 100,
    savedIdeasCap: 300,
    operatorNoteMaxLen: 1000,
  });
  const [targetDate, setTargetDate] = useState<string>(defaultTargetDate(1));
  const [selectedCityIds, setSelectedCityIds] = useState<Record<string, boolean>>({});
  const [metricPair, setMetricPair] = useState<MetricPairOption>('any_temperature_pair');
  const [useTargetDifference, setUseTargetDifference] = useState<boolean>(false);
  const [targetDifferenceF, setTargetDifferenceF] = useState<string>('20');
  const [toleranceF, setToleranceF] = useState<string>('3');
  const [maxResults, setMaxResults] = useState<string>('20');
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Step 146 — saved-idea queue state.
  const [savedIdeas, setSavedIdeas] = useState<SavedWeatherMarketIdea[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedFilter, setSavedFilter] = useState<SavedIdeaStatus | 'all'>('all');
  const [savedError, setSavedError] = useState<string | null>(null);
  const [savedBusyId, setSavedBusyId] = useState<string | null>(null);
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const [saveFlash, setSaveFlash] = useState<{ ideaId: string; isDuplicate: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(API);
        const j = (await r.json()) as BootstrapResponse & { message?: string };
        if (cancelled) return;
        if (!r.ok) throw new Error(j.message ?? 'load failed');
        setSeedCities(j.seedCities ?? []);
        if (Array.isArray(j.metricPairOptions) && j.metricPairOptions.length > 0) {
          setMetricPairOptions(j.metricPairOptions);
        }
        if (Array.isArray(j.savedIdeaStatuses) && j.savedIdeaStatuses.length > 0) {
          setStatusOptions(j.savedIdeaStatuses);
        }
        if (j.limits) setLimits(j.limits);
        const all: Record<string, boolean> = {};
        for (const c of j.seedCities ?? []) all[c.id] = true;
        setSelectedCityIds(all);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const cityIdsToInclude = useMemo(() => {
    return Object.entries(selectedCityIds)
      .filter(([, v]) => v)
      .map(([k]) => k);
  }, [selectedCityIds]);

  async function loadSavedIdeas(filter: SavedIdeaStatus | 'all') {
    setSavedLoading(true);
    setSavedError(null);
    try {
      const url = filter === 'all'
        ? `${API}?action=list-saved-ideas&limit=200`
        : `${API}?action=list-saved-ideas&status=${encodeURIComponent(filter)}&limit=200`;
      const r = await fetch(url);
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? j.error ?? 'load failed');
      setSavedIdeas(j.savedIdeas ?? []);
    } catch (e: any) {
      setSavedError(e?.message ?? 'load failed');
    } finally {
      setSavedLoading(false);
    }
  }

  // Refresh the saved list whenever the user switches into the tab or
  // changes the filter. A fresh fetch is cheap and avoids stale state
  // after the operator saves/changes status from the Generate tab.
  useEffect(() => {
    if (tab !== 'saved') return;
    loadSavedIdeas(savedFilter);
  }, [tab, savedFilter]);

  async function onGenerate() {
    setBusy(true);
    setError(null);
    try {
      const body: any = {
        action: 'generate',
        targetDate,
        cityIds: cityIdsToInclude.length === seedCities.length ? undefined : cityIdsToInclude,
        metricPair,
        maxResults: maxResults ? Number(maxResults) : undefined,
      };
      if (useTargetDifference) {
        body.targetDifferenceF = targetDifferenceF ? Number(targetDifferenceF) : undefined;
        body.toleranceF = toleranceF ? Number(toleranceF) : undefined;
      }
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? j.error ?? 'generate failed');
      setResult(j.result ?? null);
    } catch (e: any) {
      setError(e?.message ?? 'generate failed');
    } finally {
      setBusy(false);
    }
  }

  function buildSearchContext(): SavedIdeaSearchContext | undefined {
    const ctx: SavedIdeaSearchContext = {};
    if (useTargetDifference) {
      if (targetDifferenceF) ctx.targetDifferenceF = Number(targetDifferenceF);
      if (toleranceF) ctx.toleranceF = Number(toleranceF);
    }
    ctx.metricPair = metricPair;
    return Object.keys(ctx).length > 0 ? ctx : undefined;
  }

  async function onSaveGeneratedIdea(idea: WeatherMarketIdea) {
    setSavedError(null);
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save-idea',
          idea,
          searchContext: buildSearchContext(),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? j.error ?? 'save failed');
      setSaveFlash({ ideaId: idea.id, isDuplicate: !!j.isDuplicate });
      setTimeout(() => setSaveFlash(null), 2500);
      // Don't auto-switch tabs — operator may want to keep saving.
    } catch (e: any) {
      setSavedError(e?.message ?? 'save failed');
    }
  }

  async function onUpdateStatus(id: string, status: SavedIdeaStatus) {
    setSavedBusyId(id);
    setSavedError(null);
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update-saved-idea-status', id, status }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? j.error ?? 'update failed');
      setSavedIdeas((prev) => prev.map((s) => (s.id === id ? j.savedIdea : s)));
    } catch (e: any) {
      setSavedError(e?.message ?? 'update failed');
    } finally {
      setSavedBusyId(null);
    }
  }

  async function onUpdateNote(id: string) {
    const note = draftNotes[id] ?? '';
    setSavedBusyId(id);
    setSavedError(null);
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update-saved-idea-note', id, note }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? j.error ?? 'update failed');
      setSavedIdeas((prev) => prev.map((s) => (s.id === id ? j.savedIdea : s)));
      setDraftNotes((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (e: any) {
      setSavedError(e?.message ?? 'update failed');
    } finally {
      setSavedBusyId(null);
    }
  }

  async function onDeleteSaved(id: string) {
    if (typeof window !== 'undefined' && !window.confirm('Delete this saved idea? This cannot be undone.')) {
      return;
    }
    setSavedBusyId(id);
    setSavedError(null);
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete-saved-idea', id }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? j.error ?? 'delete failed');
      setSavedIdeas((prev) => prev.filter((s) => s.id !== id));
    } catch (e: any) {
      setSavedError(e?.message ?? 'delete failed');
    } finally {
      setSavedBusyId(null);
    }
  }

  function onCopy(field: string, text: string) {
    copyToClipboard(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  }

  function toggleCity(id: string) {
    setSelectedCityIds((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function selectAll() {
    const all: Record<string, boolean> = {};
    for (const c of seedCities) all[c.id] = true;
    setSelectedCityIds(all);
  }

  function selectNone() {
    setSelectedCityIds({});
  }

  return (
    <div style={{ background: '#0f172a', minHeight: '100vh', padding: 16, color: '#e2e8f0' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 12 }}>Weather Market Ideas</h1>

      <div style={BANNER}>
        <span>
          <strong>Saved ideas are not markets.</strong> Nothing is live until an admin manually creates and publishes a wager. Saving, marking reviewed/used, or following the prefilled link does not write to the wager / pricing / settlement / wallet stores.
        </span>
        <span style={{ fontSize: 11, fontWeight: 500 }}>ADMIN · IDEA-ONLY</span>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button style={tabBtn(tab === 'generate')} onClick={() => setTab('generate')}>
          Generate
        </button>
        <button style={tabBtn(tab === 'saved')} onClick={() => setTab('saved')}>
          Saved Ideas
        </button>
      </div>

      {error && (
        <div style={{ ...card, background: '#7f1d1d', color: '#fef2f2' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {tab === 'generate' && (
        <>
          <div style={card}>
            <h2 style={sectionHeader}>Generate ideas</h2>

            <div style={{ ...muted, marginBottom: 8 }}>
              {useTargetDifference
                ? `Find forecasted temperature differences near ${targetDifferenceF || '?'}°F (±${toleranceF || '?'}°F).`
                : 'Show the most interesting forecasted temperature spreads (legacy mode — |Δ| ≥ 8°F, ranked by interestingness).'}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, maxWidth: 920 }}>
              <div>
                <span style={labelStyle}>Target date (YYYY-MM-DD)</span>
                <input
                  style={{ ...input, width: '100%' }}
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  placeholder={defaultTargetDate(1)}
                />
              </div>
              <div>
                <span style={labelStyle}>Quick offsets</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      style={{ ...btn(targetDate === defaultTargetDate(n) ? '#0e7490' : '#334155'), opacity: 0.9 }}
                      onClick={() => setTargetDate(defaultTargetDate(n))}
                    >
                      +{n}d
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span style={labelStyle}>Metric pair</span>
                <select
                  style={{ ...input, width: '100%' }}
                  value={metricPair}
                  onChange={(e) => setMetricPair(e.target.value as MetricPairOption)}
                >
                  {metricPairOptions.map((opt) => (
                    <option key={opt} value={opt}>{METRIC_PAIR_LABELS[opt] ?? opt}</option>
                  ))}
                </select>
              </div>
              <div>
                <span style={labelStyle}>Max results (1–{limits.maxResultsCap})</span>
                <input
                  style={{ ...input, width: '100%' }}
                  value={maxResults}
                  onChange={(e) => setMaxResults(e.target.value)}
                  inputMode="numeric"
                />
              </div>
            </div>

            <div style={{ marginTop: 12, padding: 12, background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={useTargetDifference}
                  onChange={(e) => setUseTargetDifference(e.target.checked)}
                />
                Search by target temperature difference
              </label>
              {useTargetDifference && (
                <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, maxWidth: 720 }}>
                  <div>
                    <span style={labelStyle}>Find forecasted temperature differences near ___ °F (0–{limits.targetDifferenceFMax})</span>
                    <input
                      style={{ ...input, width: '100%' }}
                      value={targetDifferenceF}
                      onChange={(e) => setTargetDifferenceF(e.target.value)}
                      inputMode="numeric"
                      placeholder="20"
                    />
                  </div>
                  <div>
                    <span style={labelStyle}>Tolerance ± °F (0–{limits.toleranceFMax})</span>
                    <input
                      style={{ ...input, width: '100%' }}
                      value={toleranceF}
                      onChange={(e) => setToleranceF(e.target.value)}
                      inputMode="numeric"
                      placeholder="3"
                    />
                  </div>
                </div>
              )}
            </div>

            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <span style={muted}>Cities ({cityIdsToInclude.length} of {seedCities.length} selected):</span>
                <button style={btn('#475569')} onClick={selectAll}>All</button>
                <button style={btn('#475569')} onClick={selectNone}>None</button>
              </div>
              {loading ? (
                <div style={muted}>Loading seed cities…</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 6 }}>
                  {seedCities.map((c) => (
                    <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <input
                        type="checkbox"
                        checked={!!selectedCityIds[c.id]}
                        onChange={() => toggleCity(c.id)}
                      />
                      <span>{c.label}</span>
                      <span style={{ ...muted, fontSize: 10 }}>({c.region})</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div style={{ marginTop: 12 }}>
              <button
                style={{ ...btn('#0e7490'), opacity: busy || cityIdsToInclude.length < 2 ? 0.6 : 1 }}
                disabled={busy || cityIdsToInclude.length < 2}
                onClick={onGenerate}
              >
                {busy ? 'Generating…' : 'Generate ideas'}
              </button>
              {cityIdsToInclude.length < 2 && (
                <span style={{ ...muted, marginLeft: 8 }}>Pick at least 2 cities.</span>
              )}
            </div>
          </div>

          {result && (
            <div style={card}>
              <h2 style={sectionHeader}>
                {result.ideas.length} draft idea{result.ideas.length === 1 ? '' : 's'} for {result.targetDate}
              </h2>
              <div style={muted}>
                Generated {new Date(result.generatedAt).toLocaleString()} · {result.cityCount} city/cities forecasted ·
                metric pair: {METRIC_PAIR_LABELS[result.resolved.metricPair] ?? result.resolved.metricPair}
                {result.resolved.targetDifferenceF !== undefined && (
                  <> · target Δ {result.resolved.targetDifferenceF}°F ± {result.resolved.toleranceF ?? 3}°F</>
                )}
              </div>
              {result.warnings.length > 0 && (
                <ul style={{ marginTop: 8, color: '#fbbf24', fontSize: 12, paddingLeft: 16 }}>
                  {result.warnings.map((w, i) => (<li key={i}>{w}</li>))}
                </ul>
              )}

              {result.ideas.length === 0 ? (
                <div style={{ ...muted, marginTop: 12 }}>
                  No ideas surfaced. Try a different date, more cities, a wider tolerance, or a different metric pair.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12, marginTop: 12 }}>
                  {result.ideas.map((idea) => (
                    <div key={idea.id} style={tile}>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{idea.title}</div>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: confidenceTone(idea.confidenceLabel),
                          }}
                          title={`Score ${idea.interestingnessScore.toFixed(1)}`}
                        >
                          {idea.confidenceLabel} confidence
                        </span>
                      </div>
                      <div style={{ ...muted, marginTop: 4 }}>{idea.rationale}</div>

                      <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                        <div>
                          <div style={muted}>{idea.locationA.label} ({METRIC_LABELS[idea.metricA]})</div>
                          <div style={{ color: '#e2e8f0' }}>{idea.forecastValueA}°F</div>
                        </div>
                        <div>
                          <div style={muted}>{idea.locationB.label} ({METRIC_LABELS[idea.metricB]})</div>
                          <div style={{ color: '#e2e8f0' }}>{idea.forecastValueB}°F</div>
                        </div>
                        <div>
                          <div style={muted}>Raw difference (A − B)</div>
                          <div style={{ color: '#e2e8f0' }}>{idea.rawDifference > 0 ? '+' : ''}{idea.rawDifference}°F</div>
                        </div>
                        <div>
                          <div style={muted}>Suggested spread (A side)</div>
                          <div style={{ color: '#e2e8f0', fontWeight: 600 }}>
                            {idea.suggestedSpread >= 0 ? '+' : ''}{idea.suggestedSpread}°F
                          </div>
                        </div>
                        <div>
                          <div style={muted}>Default odds</div>
                          <div style={{ color: '#e2e8f0' }}>{idea.suggestedOddsA} / {idea.suggestedOddsB}</div>
                        </div>
                        {idea.closenessToTarget !== undefined && (
                          <div>
                            <div style={muted}>Closeness to target Δ</div>
                            <div style={{ color: '#e2e8f0' }}>{idea.closenessToTarget.toFixed(1)}°F off</div>
                          </div>
                        )}
                      </div>

                      {idea.warnings.length > 0 && (
                        <ul style={{ marginTop: 8, color: '#fbbf24', fontSize: 11, paddingLeft: 16 }}>
                          {idea.warnings.map((w, i) => (<li key={i}>{w}</li>))}
                        </ul>
                      )}

                      <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button
                          style={btn(copiedField === `${idea.id}-title` ? '#15803d' : '#475569')}
                          onClick={() => onCopy(`${idea.id}-title`, idea.title)}
                        >
                          {copiedField === `${idea.id}-title` ? 'Copied' : 'Copy title'}
                        </button>
                        <button
                          style={btn(copiedField === `${idea.id}-notes` ? '#15803d' : '#475569')}
                          onClick={() => onCopy(`${idea.id}-notes`, idea.setupNotes)}
                        >
                          {copiedField === `${idea.id}-notes` ? 'Copied' : 'Copy setup notes'}
                        </button>
                        {/* Step 146 — save to review queue. */}
                        <button
                          style={btn(saveFlash?.ideaId === idea.id ? (saveFlash.isDuplicate ? '#b45309' : '#15803d') : '#0ea5e9')}
                          onClick={() => onSaveGeneratedIdea(idea)}
                          title="Persist this idea to the admin review queue. Does not create or publish a wager."
                        >
                          {saveFlash?.ideaId === idea.id
                            ? (saveFlash.isDuplicate ? 'Already saved' : 'Saved ✓')
                            : 'Save idea'}
                        </button>
                        {/* Step 145 — assisted manual creation. */}
                        <a
                          style={link('#0e7490')}
                          href={`/admin/wagers?${idea.prefillQuery}`}
                          target="_blank"
                          rel="noreferrer"
                          title="Opens the wager-create form pre-filled. You still have to click Create Wager."
                        >
                          Use this idea →
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {tab === 'saved' && (
        <div style={card}>
          <h2 style={sectionHeader}>Saved idea queue</h2>
          <div style={{ ...muted, marginBottom: 8 }}>
            Up to {limits.savedIdeasCap} saved ideas. Saving, status changes, and notes are admin-only and never create or publish a wager.
          </div>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <span style={muted}>Filter:</span>
            <button
              style={btn(savedFilter === 'all' ? '#0e7490' : '#334155')}
              onClick={() => setSavedFilter('all')}
            >
              All
            </button>
            {statusOptions.map((s) => (
              <button
                key={s}
                style={btn(savedFilter === s ? '#0e7490' : '#334155')}
                onClick={() => setSavedFilter(s)}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
            <button
              style={{ ...btn('#475569'), marginLeft: 'auto' }}
              onClick={() => loadSavedIdeas(savedFilter)}
            >
              Refresh
            </button>
          </div>

          {savedError && (
            <div style={{ ...card, background: '#7f1d1d', color: '#fef2f2', marginTop: 0 }}>
              <strong>Error:</strong> {savedError}
            </div>
          )}

          {savedLoading ? (
            <div style={muted}>Loading saved ideas…</div>
          ) : savedIdeas.length === 0 ? (
            <div style={muted}>
              {savedFilter === 'all' ? 'No saved ideas yet.' : `No saved ideas with status "${STATUS_LABELS[savedFilter as SavedIdeaStatus]}".`}
              {' '}Generate some on the Generate tab and click <strong>Save idea</strong>.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 12 }}>
              {savedIdeas.map((s) => {
                const i = s.idea;
                const draft = draftNotes[s.id];
                const hasDraft = draft !== undefined && draft !== (s.operatorNote ?? '');
                const isBusy = savedBusyId === s.id;
                return (
                  <div key={s.id} style={tile}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{i.title}</div>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: STATUS_TONES[s.status],
                          textTransform: 'uppercase',
                        }}
                      >
                        {STATUS_LABELS[s.status]}
                      </span>
                    </div>
                    <div style={{ ...muted, marginTop: 4 }}>{i.rationale}</div>

                    <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                      <div>
                        <div style={muted}>{i.locationA.label} ({METRIC_LABELS[i.metricA]})</div>
                        <div>{i.forecastValueA}°F</div>
                      </div>
                      <div>
                        <div style={muted}>{i.locationB.label} ({METRIC_LABELS[i.metricB]})</div>
                        <div>{i.forecastValueB}°F</div>
                      </div>
                      <div>
                        <div style={muted}>Raw Δ (A − B)</div>
                        <div>{i.rawDifference > 0 ? '+' : ''}{i.rawDifference}°F</div>
                      </div>
                      <div>
                        <div style={muted}>Suggested spread</div>
                        <div style={{ fontWeight: 600 }}>
                          {i.suggestedSpread >= 0 ? '+' : ''}{i.suggestedSpread}°F
                        </div>
                      </div>
                    </div>

                    {s.warningFlags.length > 0 && (
                      <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {s.warningFlags.map((f) => (
                          <span
                            key={f}
                            style={{
                              fontSize: 10,
                              fontWeight: 600,
                              color: '#fbbf24',
                              border: '1px solid #b45309',
                              padding: '2px 6px',
                              borderRadius: 999,
                              textTransform: 'uppercase',
                            }}
                          >
                            {f.replace(/_/g, ' ')}
                          </span>
                        ))}
                      </div>
                    )}

                    <div style={{ marginTop: 10 }}>
                      <span style={labelStyle}>
                        Operator note (≤{limits.operatorNoteMaxLen} chars)
                      </span>
                      <textarea
                        style={{ ...textareaStyle, width: '100%' }}
                        value={draft ?? s.operatorNote ?? ''}
                        maxLength={limits.operatorNoteMaxLen}
                        onChange={(e) =>
                          setDraftNotes((prev) => ({ ...prev, [s.id]: e.target.value }))
                        }
                        placeholder="Why this is interesting, what to verify before publishing, etc."
                      />
                      {hasDraft && (
                        <div style={{ marginTop: 4, display: 'flex', gap: 6 }}>
                          <button
                            style={{ ...btn('#0ea5e9'), opacity: isBusy ? 0.6 : 1 }}
                            disabled={isBusy}
                            onClick={() => onUpdateNote(s.id)}
                          >
                            Save note
                          </button>
                          <button
                            style={btn('#475569')}
                            disabled={isBusy}
                            onClick={() =>
                              setDraftNotes((prev) => {
                                const next = { ...prev };
                                delete next[s.id];
                                return next;
                              })
                            }
                          >
                            Discard
                          </button>
                        </div>
                      )}
                    </div>

                    <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {statusOptions
                        .filter((opt) => opt !== s.status)
                        .map((opt) => (
                          <button
                            key={opt}
                            style={{ ...btn(opt === 'rejected' ? '#475569' : (opt === 'used' ? '#15803d' : '#7c3aed')), opacity: isBusy ? 0.6 : 1 }}
                            disabled={isBusy}
                            onClick={() => onUpdateStatus(s.id, opt)}
                            title={`Mark this saved idea as ${STATUS_LABELS[opt]}.`}
                          >
                            Mark {STATUS_LABELS[opt].toLowerCase()}
                          </button>
                        ))}
                      <a
                        style={link('#0e7490')}
                        href={`/admin/wagers?${s.prefillQuery}`}
                        target="_blank"
                        rel="noreferrer"
                        title="Opens the wager-create form pre-filled. You still have to click Create Wager."
                      >
                        Use this idea →
                      </a>
                      <button
                        style={{ ...btn('#7f1d1d'), marginLeft: 'auto', opacity: isBusy ? 0.6 : 1 }}
                        disabled={isBusy}
                        onClick={() => onDeleteSaved(s.id)}
                        title="Permanently remove this saved idea."
                      >
                        Delete
                      </button>
                    </div>

                    <div style={{ ...muted, fontSize: 10, marginTop: 8 }}>
                      Saved {new Date(s.createdAt).toLocaleString()} · updated {new Date(s.updatedAt).toLocaleString()} · id {s.id}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <SystemNav activeHref="/admin/system/weather-market-ideas" />
      </div>
    </div>
  );
}

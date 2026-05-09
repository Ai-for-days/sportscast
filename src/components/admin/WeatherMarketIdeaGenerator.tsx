// ── Step 144: Weather Market Idea Generator (admin-only UI) ────────────────
//
// Generates draft cross-location pointspread ideas from current forecast
// data. **Idea-only.** No publish button, no market creation. Operator
// copies the title + setup notes into the existing wager-creation form
// manually.

import React, { useEffect, useMemo, useState } from 'react';
import SystemNav from './SystemNav';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const tile: React.CSSProperties = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 12 };
const btn = (bg: string): React.CSSProperties => ({ padding: '6px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const input: React.CSSProperties = { background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', padding: '6px 8px', borderRadius: 6, fontSize: 12 };
const labelStyle: React.CSSProperties = { fontSize: 11, color: '#94a3b8', marginBottom: 4, display: 'block' };
const sectionHeader: React.CSSProperties = { fontSize: 16, fontWeight: 800, marginBottom: 8, color: '#e2e8f0' };
const muted: React.CSSProperties = { fontSize: 12, color: '#94a3b8' };

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
  suggestedSpread: number;
  suggestedOddsA: number;
  suggestedOddsB: number;
  confidenceLabel: ConfidenceLabel;
  rationale: string;
  warnings: string[];
  status: 'idea_only';
  setupNotes: string;
  interestingnessScore: number;
}

interface GenerateResult {
  generatedAt: string;
  targetDate: string;
  cityCount: number;
  ideas: WeatherMarketIdea[];
  warnings: string[];
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
  const [seedCities, setSeedCities] = useState<SeedCity[]>([]);
  const [targetDate, setTargetDate] = useState<string>(defaultTargetDate(1));
  const [selectedCityIds, setSelectedCityIds] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(API);
        const j = await r.json();
        if (cancelled) return;
        if (!r.ok) throw new Error(j.message ?? 'load failed');
        setSeedCities(j.seedCities ?? []);
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

  async function onGenerate() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate',
          targetDate,
          cityIds: cityIdsToInclude.length === seedCities.length ? undefined : cityIdsToInclude,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? 'generate failed');
      setResult(j.result ?? null);
    } catch (e: any) {
      setError(e?.message ?? 'generate failed');
    } finally {
      setBusy(false);
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
          <strong>Draft ideas only.</strong> No market is created until an admin manually creates and publishes one through the existing wager-creation form. Nothing here writes to the wager / pricing / settlement / wallet stores.
        </span>
        <span style={{ fontSize: 11, fontWeight: 500 }}>ADMIN · IDEA-ONLY</span>
      </div>

      {error && (
        <div style={{ ...card, background: '#7f1d1d', color: '#fef2f2' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      <div style={card}>
        <h2 style={sectionHeader}>Generate ideas</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, maxWidth: 720 }}>
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
            Generated {new Date(result.generatedAt).toLocaleString()} · {result.cityCount} city/cities forecasted
          </div>
          {result.warnings.length > 0 && (
            <ul style={{ marginTop: 8, color: '#fbbf24', fontSize: 12, paddingLeft: 16 }}>
              {result.warnings.map((w, i) => (<li key={i}>{w}</li>))}
            </ul>
          )}

          {result.ideas.length === 0 ? (
            <div style={{ ...muted, marginTop: 12 }}>
              No ideas surfaced. Try a different date, more cities, or a wider time horizon.
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
                      title={`Score ${idea.interestingnessScore}`}
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
                      <div style={muted}>Suggested spread (A side)</div>
                      <div style={{ color: '#e2e8f0', fontWeight: 600 }}>
                        {idea.suggestedSpread >= 0 ? '+' : ''}{idea.suggestedSpread}°F
                      </div>
                    </div>
                    <div>
                      <div style={muted}>Default odds</div>
                      <div style={{ color: '#e2e8f0' }}>{idea.suggestedOddsA} / {idea.suggestedOddsB}</div>
                    </div>
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
                  </div>
                </div>
              ))}
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

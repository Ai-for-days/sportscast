// ── Step 144 / Step 145: Weather Market Idea Generator (admin-only UI) ────
//
// Generates draft cross-location pointspread ideas from current forecast
// data. **Idea-only.** No publish button, no market creation. Operator
// copies the title + setup notes into the existing wager-creation form
// manually, or follows the "Use this idea" link to the form pre-filled
// via query params (the operator still has to click Create Wager).
//
// Step 145 added the target-difference search workflow: the operator
// can ask "find me a forecasted temperature difference around X °F"
// and the generator ranks pairs by closeness to that value.

import React, { useEffect, useMemo, useState } from 'react';
import SystemNav from './SystemNav';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const tile: React.CSSProperties = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 12 };
const btn = (bg: string): React.CSSProperties => ({ padding: '6px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const link = (bg: string): React.CSSProperties => ({ padding: '6px 12px', borderRadius: 6, background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, textDecoration: 'none', display: 'inline-block' });
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
type MetricPairOption = 'high_vs_high' | 'low_vs_low' | 'high_vs_low' | 'any_temperature_pair';

const METRIC_PAIR_LABELS: Record<MetricPairOption, string> = {
  any_temperature_pair: 'Any temperature pair',
  high_vs_high: 'High vs High',
  low_vs_low: 'Low vs Low',
  high_vs_low: 'High vs Low (cross-metric)',
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

interface BootstrapResponse {
  seedCities: SeedCity[];
  metricPairOptions: MetricPairOption[];
  limits: {
    targetDifferenceFMax: number;
    toleranceFMax: number;
    maxResultsCap: number;
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
  const [seedCities, setSeedCities] = useState<SeedCity[]>([]);
  const [metricPairOptions, setMetricPairOptions] = useState<MetricPairOption[]>([
    'any_temperature_pair', 'high_vs_high', 'low_vs_low', 'high_vs_low',
  ]);
  const [limits, setLimits] = useState<BootstrapResponse['limits']>({
    targetDifferenceFMax: 80,
    toleranceFMax: 20,
    maxResultsCap: 100,
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
          <strong>Draft ideas only.</strong> No market is created until an admin manually creates and publishes one through the existing wager-creation form (or follows the prefilled link below and clicks Create Wager). Nothing here writes to the wager / pricing / settlement / wallet stores.
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
                    {/* Step 145 — assisted manual creation. Opens the existing
                        wager-create form with prefill query params; the
                        operator must still click Create Wager to publish. */}
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

      <div style={{ marginTop: 24 }}>
        <SystemNav activeHref="/admin/system/weather-market-ideas" />
      </div>
    </div>
  );
}

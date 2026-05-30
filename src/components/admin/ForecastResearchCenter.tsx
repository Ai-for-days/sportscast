import React, { useState } from 'react';
import type { MarketResearch, MetricVolatility } from '../../lib/forecast-market-research';

// ── Theme ────────────────────────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: '#1e293b',
  border: '1px solid #334155',
  borderRadius: 12,
  padding: 16,
  marginBottom: 16,
};
const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 10px',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  color: '#94a3b8',
  borderBottom: '1px solid #334155',
  whiteSpace: 'nowrap',
};
const td: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 13,
  color: '#e2e8f0',
  borderBottom: '1px solid #1f2c3f',
  whiteSpace: 'nowrap',
};
const h2: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: '#f1f5f9', margin: '0 0 10px' };
const muted: React.CSSProperties = { color: '#94a3b8', fontSize: 12 };

function confColor(c: string): string {
  return c === 'high' ? '#22c55e' : c === 'moderate' ? '#eab308' : '#ef4444';
}
function stabilityColor(s: string): string {
  return s === 'firm' ? '#22c55e' : s === 'moving' ? '#eab308' : s === 'unsettled' ? '#ef4444' : '#64748b';
}

function Chip({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '8px 12px', minWidth: 110 }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, color: '#64748b' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: color || '#e2e8f0' }}>{value}</div>
    </div>
  );
}

export default function ForecastResearchCenter() {
  const [zip, setZip] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MarketResearch | null>(null);

  async function run(e?: React.FormEvent) {
    e?.preventDefault();
    const z = zip.trim();
    if (!z) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/system/forecast-research?action=research&zip=${encodeURIComponent(z)}`);
      const body = await res.json();
      if (!res.ok) {
        setError(body.error === 'zip_not_found' ? `No location found for "${z}".` : body.error || 'Request failed.');
        setData(null);
      } else {
        setData(body.research as MarketResearch);
      }
    } catch (err) {
      setError(String(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  // group volatility rows by date for compact display
  const volByDate = new Map<string, { dayLabel: string; high?: MetricVolatility; low?: MetricVolatility }>();
  if (data) {
    for (const v of data.volatility) {
      const e = volByDate.get(v.date) || { dayLabel: v.dayLabel };
      if (v.metric === 'high_temp') e.high = v;
      else e.low = v;
      volByDate.set(v.date, e);
    }
  }

  return (
    <div style={{ color: '#e2e8f0' }}>
      <div style={{ marginBottom: 8 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#f8fafc', margin: 0 }}>Forecast Market Research</h1>
        <p style={muted}>
          Operator-only forecast intelligence for setting markets. Enriched detail moved off the public ZIP pages
          (Forecast Outlook, Changes, History, Market Context) plus multi-day outlook, hourly detail, model
          volatility across captured runs, and suggested lines. Read-only — never customer-facing.
        </p>
      </div>

      <form onSubmit={run} style={{ ...card, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={zip}
          onChange={(e) => setZip(e.target.value)}
          placeholder="US ZIP code (e.g. 29201)"
          style={{
            background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '10px 12px',
            color: '#e2e8f0', fontSize: 14, width: 220,
          }}
        />
        <button
          type="submit"
          disabled={loading || !zip.trim()}
          style={{
            background: loading ? '#1d4ed8aa' : '#2563eb', color: '#fff', border: 'none', borderRadius: 8,
            padding: '10px 18px', fontSize: 14, fontWeight: 700, cursor: loading ? 'default' : 'pointer',
          }}
        >
          {loading ? 'Running…' : 'Run research'}
        </button>
        {error && <span style={{ color: '#f87171', fontSize: 13 }}>{error}</span>}
      </form>

      {data && (
        <>
          {/* Summary strip */}
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <h2 style={h2}>{data.location.label}</h2>
              <span style={muted}>
                {data.source ? `Source: ${data.source}` : ''} · {data.snapshotCount} captured run
                {data.snapshotCount === 1 ? '' : 's'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Chip label="Confidence" value={data.intelligence.confidence} color={confColor(data.intelligence.confidence)} />
              <Chip label="Volatility" value={data.intelligence.volatility} />
              <Chip label="Hi spread" value={`${data.tempStats.dailyHighSpreadF}°F`} />
              <Chip label="24h temp σ" value={`${data.tempStats.hourlyStdDevF}°`} />
              <Chip label="24h range" value={`${data.tempStats.hourlyMinF}–${data.tempStats.hourlyMaxF}°`} />
              {data.intelligence.freshness && <Chip label="Forecast" value={data.intelligence.freshness} />}
            </div>
          </div>

          {/* Suggested lines — the headline feature */}
          <div style={card}>
            <h2 style={h2}>Suggested market lines</h2>
            <p style={{ ...muted, marginTop: -4, marginBottom: 10 }}>
              Candidate over/under lines per day, with confidence blended from forecast stability and the model's
              run-to-run movement. Not a price — a starting point for the desk.
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr>
                    <th style={th}>Day</th>
                    <th style={th}>Metric</th>
                    <th style={th}>Forecast</th>
                    <th style={th}>Line</th>
                    <th style={th}>Push-proof</th>
                    <th style={th}>Conf.</th>
                    <th style={{ ...th, whiteSpace: 'normal' }}>Rationale</th>
                  </tr>
                </thead>
                <tbody>
                  {data.suggestedLines.map((s, i) => (
                    <tr key={i}>
                      <td style={td}>{s.dayLabel}</td>
                      <td style={td}>{s.metric === 'high_temp' ? 'High' : 'Low'}</td>
                      <td style={td}>{Math.round(s.forecastValueF)}°F</td>
                      <td style={{ ...td, fontWeight: 700 }}>{s.suggestedLine}</td>
                      <td style={td}>{s.pushProofLine}</td>
                      <td style={{ ...td, color: confColor(s.confidence), fontWeight: 700 }}>{s.confidence}</td>
                      <td style={{ ...td, whiteSpace: 'normal', color: '#cbd5e1', fontSize: 12, minWidth: 280 }}>{s.rationale}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Per-day model volatility */}
          <div style={card}>
            <h2 style={h2}>Model volatility (run-to-run)</h2>
            <p style={{ ...muted, marginTop: -4, marginBottom: 10 }}>
              How much the forecast high/low for each date has moved across the {data.snapshotCount} captured run
              {data.snapshotCount === 1 ? '' : 's'}. Wider range / higher σ = thinner edge, wider line.
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr>
                    <th style={th}>Day</th>
                    <th style={th}>Metric</th>
                    <th style={th}>Runs</th>
                    <th style={th}>Latest</th>
                    <th style={th}>Range</th>
                    <th style={th}>σ</th>
                    <th style={th}>Stability</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(volByDate.values()).flatMap((row) =>
                    [row.high, row.low].filter(Boolean).map((v, i) => {
                      const vol = v as MetricVolatility;
                      return (
                        <tr key={`${vol.date}-${vol.metric}`}>
                          {i === 0 ? <td style={{ ...td, fontWeight: 600 }} rowSpan={2}>{row.dayLabel}</td> : null}
                          <td style={td}>{vol.metric === 'high_temp' ? 'High' : 'Low'}</td>
                          <td style={td}>{vol.captures}</td>
                          <td style={td}>{vol.latest != null ? `${Math.round(vol.latest)}°F` : '—'}</td>
                          <td style={td}>{vol.min != null && vol.max != null ? `${Math.round(vol.min)}–${Math.round(vol.max)}°F` : '—'}</td>
                          <td style={td}>{vol.stdDevF != null ? `${vol.stdDevF}°` : '—'}</td>
                          <td style={{ ...td, color: stabilityColor(vol.stability), fontWeight: 700 }}>{vol.stability}</td>
                        </tr>
                      );
                    }),
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Multi-day outlook */}
          <div style={card}>
            <h2 style={h2}>Daily outlook ({data.dailyOutlook.length} days)</h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr>
                    <th style={th}>Day</th>
                    <th style={th}>High</th>
                    <th style={th}>Low</th>
                    <th style={th}>Precip</th>
                    <th style={th}>Wind</th>
                    <th style={th}>Gust</th>
                  </tr>
                </thead>
                <tbody>
                  {data.dailyOutlook.map((d) => (
                    <tr key={d.date}>
                      <td style={td}>{d.dayLabel}</td>
                      <td style={{ ...td, fontWeight: 600 }}>{d.highF}°</td>
                      <td style={td}>{d.lowF}°</td>
                      <td style={td}>{d.precipProbability}%</td>
                      <td style={td}>{d.windSpeedMph} mph</td>
                      <td style={td}>{d.windGustMph} mph</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Hourly next 24 */}
          <div style={card}>
            <h2 style={h2}>Next 24 hours</h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr>
                    <th style={th}>Hour</th>
                    <th style={th}>Temp</th>
                    <th style={th}>Precip</th>
                    <th style={th}>Wind</th>
                    <th style={th}>Gust</th>
                  </tr>
                </thead>
                <tbody>
                  {data.hourlyNext24.map((hr) => (
                    <tr key={hr.time}>
                      <td style={td}>{hr.hourLabel}</td>
                      <td style={{ ...td, fontWeight: 600 }}>{hr.tempF}°</td>
                      <td style={td}>{hr.precipProbability}%</td>
                      <td style={td}>{hr.windSpeedMph} mph</td>
                      <td style={td}>{hr.windGustMph} mph</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* The four formerly-public sections, full fidelity */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            <div style={card}>
              <h2 style={h2}>Forecast Outlook</h2>
              <p style={{ margin: '0 0 6px' }}>
                <span style={{ color: confColor(data.intelligence.confidence), fontWeight: 700 }}>
                  {data.intelligence.confidence} confidence
                </span>{' '}
                · {data.intelligence.volatility}
              </p>
              <p style={{ ...muted, marginTop: 0 }}>{data.intelligence.confidenceExplanation}</p>
              <p style={muted}>{data.intelligence.volatilityExplanation}</p>
              {data.intelligence.trends.length > 0 && (
                <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                  {data.intelligence.trends.map((t, i) => (
                    <li key={i} style={{ fontSize: 13, color: '#cbd5e1', marginBottom: 4 }}>{t.summary}</li>
                  ))}
                </ul>
              )}
            </div>

            <div style={card}>
              <h2 style={h2}>Forecast Changes</h2>
              {data.revision.isInitial ? (
                <p style={muted}>First capture for this location — no prior run to compare yet.</p>
              ) : data.revision.changes.length === 0 ? (
                <p style={muted}>{data.revision.headline || 'Forecast has remained relatively steady.'}</p>
              ) : (
                <>
                  {data.revision.headline && <p style={{ margin: '0 0 8px', fontWeight: 600 }}>{data.revision.headline}</p>}
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {data.revision.changes.map((c, i) => (
                      <li key={i} style={{ fontSize: 13, color: '#cbd5e1', marginBottom: 4 }}>{c.summary}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            <div style={card}>
              <h2 style={h2}>Forecast History</h2>
              {data.timeline.narrativeSummary && (
                <p style={{ ...muted, marginTop: 0 }}>{data.timeline.narrativeSummary}</p>
              )}
              {data.timeline.entries.length === 0 ? (
                <p style={muted}>Not enough captured runs yet for a revision timeline.</p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {data.timeline.entries.map((e) => (
                    <li key={e.id} style={{ fontSize: 13, color: '#cbd5e1', marginBottom: 6 }}>
                      {e.headline}
                      {e.detail.length > 0 && (
                        <span style={{ color: '#64748b' }}> — {e.detail.join('; ')}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div style={card}>
              <h2 style={h2}>Market Context</h2>
              {data.marketContext.isEmpty ? (
                <p style={muted}>Nothing notable — forecast is quiet for this location.</p>
              ) : (
                <>
                  <p style={{ margin: '0 0 8px', fontWeight: 600 }}>{data.marketContext.headline}</p>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {data.marketContext.bullets.map((b, i) => (
                      <li key={i} style={{ fontSize: 13, color: '#cbd5e1', marginBottom: 4 }}>{b}</li>
                    ))}
                  </ul>
                  {data.marketContext.affectedMarketKinds.length > 0 && (
                    <p style={{ ...muted, marginTop: 8 }}>
                      Affected: {data.marketContext.affectedMarketKinds.join(', ')}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

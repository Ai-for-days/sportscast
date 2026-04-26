import React, { useEffect, useState } from 'react';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({ padding: '5px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (bg: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: bg, color: '#fff' });

const evidenceColor: Record<string, string> = {
  stronger: '#22c55e',
  moderate: '#3b82f6',
  early: '#f59e0b',
  insufficient: '#64748b',
};

type Tab = 'summary' | 'probability' | 'edge' | 'confidence' | 'horizon' | 'segments' | 'notes';

export default function CalibrationLab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('summary');
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/system/calibration-lab');
      const j = await res.json();
      setData(j);
    } catch (e) {
      setData({ error: 'Failed to load' });
    }
    setLoading(false);
  }

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await fetch('/api/admin/system/calibration-lab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh' }),
      });
      const j = await res.json();
      setData(j);
    } catch (e) { /* ignore */ }
    setRefreshing(false);
  }

  const navLinks = [
    { href: '/admin/system/quant-review', label: 'Quant Review' },
    { href: '/admin/system/quant-edge-audit', label: 'Quant Edge Audit' },
    { href: '/admin/system/outcome-evaluation', label: 'Outcome Evaluation' },
    { href: '/admin/system/calibration-lab', label: 'Calibration Lab', active: true },
    { href: '/admin/system/execution-economics', label: 'Execution Economics' },
  ];

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading calibration report...</div>;
  if (!data || data.error) return <div style={{ color: '#ef4444', padding: 40 }}>Failed to load calibration data: {data?.error || 'unknown error'}</div>;

  const s = data.summary;
  const fmtPct = (v: number | null) => v == null ? '—' : `${(v * 100).toFixed(1)}%`;
  const fmtPctRaw = (v: number | null) => v == null ? '—' : `${v.toFixed(1)}%`;
  const fmtCents = (v: number | null) => v == null ? '—' : `$${(v / 100).toFixed(2)}`;
  const evBadge = (lvl: string) => <span style={badge(evidenceColor[lvl] ?? '#64748b')}>{lvl.toUpperCase()}</span>;

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {navLinks.map(l => (
          <a key={l.href} href={l.href}
            style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none', background: l.active ? '#6366f1' : '#334155', color: '#fff' }}>
            {l.label}
          </a>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Calibration Lab</h1>
          <p style={{ margin: '0 0 8px', fontSize: 14, color: '#94a3b8', maxWidth: 720 }}>
            Signal reliability and calibration analysis. Are predicted probabilities calibrated? Does edge correlate with outcomes? Does forecast skill decay with horizon? Which segments are unreliable?
          </p>
          <div style={{ marginTop: 4 }}>
            <span style={badge(evidenceColor[s.overallEvidence] ?? '#64748b')}>{s.overallEvidenceLabel.toUpperCase()}</span>
            {s.overallBrier != null && (
              <span style={{ marginLeft: 12, fontSize: 13, color: '#94a3b8' }}>
                Overall Brier: <strong style={{ color: '#e2e8f0' }}>{s.overallBrier.toFixed(4)}</strong>
                <span style={{ marginLeft: 6, fontSize: 11, color: '#64748b' }}>(lower is better; coin-flip baseline = 0.25)</span>
              </span>
            )}
          </div>
        </div>
        <button onClick={refresh} disabled={refreshing} style={btn('#3b82f6')}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          ['summary', 'Summary'],
          ['probability', 'Probability Calibration'],
          ['edge', 'Edge Correlation'],
          ['confidence', 'Confidence'],
          ['horizon', 'Horizon Decay'],
          ['segments', 'Segment Reliability'],
          ['notes', 'Notes'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} style={{ ...btn(tab === t ? '#6366f1' : '#334155'), padding: '8px 14px', fontSize: 13 }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'summary' && (
        <div>
          <div style={grid4}>
            <div style={card}>
              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Total Orders</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{s.totalOrders}</div>
            </div>
            <div style={card}>
              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Resolved Outcomes</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#22c55e' }}>{s.resolved}</div>
            </div>
            <div style={card}>
              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>With Model Probability</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{s.withModelProb}</div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>used for calibration</div>
            </div>
            <div style={card}>
              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>With Pre-trade Edge</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{s.withEdge}</div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>used for edge correlation</div>
            </div>
          </div>

          {s.resolved === 0 && (
            <div style={{ ...card, background: '#0f172a', padding: 20, color: '#94a3b8' }}>
              No resolved outcomes yet. Execute trades and run settlement to populate this report.
            </div>
          )}
          {s.resolved > 0 && s.overallEvidence === 'insufficient' && (
            <div style={{ ...card, background: '#0f172a', padding: 16, color: '#fbbf24', fontSize: 13 }}>
              <strong>Insufficient data.</strong> Fewer than 30 resolved outcomes — buckets and Brier scores are not yet meaningful. Treat all numbers as preliminary.
            </div>
          )}
        </div>
      )}

      {tab === 'probability' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>Probability Calibration</h3>
          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
            Predicted YES probability vs observed YES rate. Well-calibrated buckets have observed ≈ predicted.
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Predicted Prob</th>
                <th style={th}>Bucket midpoint</th>
                <th style={th}>Sample</th>
                <th style={th}>Predicted (avg)</th>
                <th style={th}>Observed YES rate</th>
                <th style={th}>Brier (bucket)</th>
                <th style={th}>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {data.probabilityCalibration.map((b: any) => (
                <tr key={b.bucket}>
                  <td style={td}><strong>{b.bucket}</strong></td>
                  <td style={td}>{(b.midpoint * 100).toFixed(0)}%</td>
                  <td style={td}>{b.count}</td>
                  <td style={td}>{fmtPct(b.predictedAvg)}</td>
                  <td style={td}>{fmtPct(b.observedYesRate)}</td>
                  <td style={td}>{b.brierContribution != null ? b.brierContribution.toFixed(4) : '—'}</td>
                  <td style={td}>{evBadge(b.evidence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'edge' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>Edge Correlation</h3>
          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
            Pre-trade edge (cents) vs realized hit rate and average P&L. Edge should monotonically correlate with hit rate.
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Edge bucket</th>
                <th style={th}>Sample</th>
                <th style={th}>With P&L</th>
                <th style={th}>Wins</th>
                <th style={th}>Hit rate</th>
                <th style={th}>Avg P&L</th>
                <th style={th}>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {data.edgeBuckets.map((b: any) => (
                <tr key={b.bucket}>
                  <td style={td}><strong>{b.bucket}</strong></td>
                  <td style={td}>{b.count}</td>
                  <td style={td}>{b.withPnl}</td>
                  <td style={td}>{b.wins}</td>
                  <td style={td}>{fmtPctRaw(b.hitRate)}</td>
                  <td style={td}>{fmtCents(b.avgPnlCents)}</td>
                  <td style={td}>{evBadge(b.evidence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'confidence' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>Confidence Calibration</h3>
          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
            Confidence label at signal time vs realized hit rate. "high" should win more than "medium" should win more than "low".
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Confidence</th>
                <th style={th}>Sample</th>
                <th style={th}>With P&L</th>
                <th style={th}>Wins</th>
                <th style={th}>Hit rate</th>
                <th style={th}>Avg P&L</th>
                <th style={th}>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {data.confidenceBuckets.map((b: any) => (
                <tr key={b.confidence}>
                  <td style={td}><strong style={{ textTransform: 'capitalize' }}>{b.confidence}</strong></td>
                  <td style={td}>{b.count}</td>
                  <td style={td}>{b.withPnl}</td>
                  <td style={td}>{b.wins}</td>
                  <td style={td}>{fmtPctRaw(b.hitRate)}</td>
                  <td style={td}>{fmtCents(b.avgPnlCents)}</td>
                  <td style={td}>{evBadge(b.evidence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'horizon' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>Horizon Decay</h3>
          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
            Lead time from order placement to event resolution vs realized hit rate. Forecast skill typically degrades with horizon.
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Horizon</th>
                <th style={th}>Sample</th>
                <th style={th}>With P&L</th>
                <th style={th}>Wins</th>
                <th style={th}>Hit rate</th>
                <th style={th}>Avg edge (¢)</th>
                <th style={th}>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {data.horizonBuckets.map((b: any) => (
                <tr key={b.bucket}>
                  <td style={td}><strong>{b.bucket}</strong></td>
                  <td style={td}>{b.count}</td>
                  <td style={td}>{b.withPnl}</td>
                  <td style={td}>{b.wins}</td>
                  <td style={td}>{fmtPctRaw(b.hitRate)}</td>
                  <td style={td}>{b.avgEdgeBps != null ? `${(b.avgEdgeBps / 100).toFixed(1)}¢` : '—'}</td>
                  <td style={td}>{evBadge(b.evidence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'segments' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>Segment Reliability</h3>
          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
            Brier score by location, metric, and forecast source. Sorted least reliable first (highest Brier). Use this to identify where the model has been most wrong.
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Segment Type</th>
                <th style={th}>Segment</th>
                <th style={th}>Total</th>
                <th style={th}>With Outcome</th>
                <th style={th}>Brier</th>
                <th style={th}>Hit rate</th>
                <th style={th}>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {data.segmentReliability.length === 0 && (
                <tr><td colSpan={7} style={{ ...td, color: '#64748b', textAlign: 'center' }}>No segment data yet.</td></tr>
              )}
              {data.segmentReliability.slice(0, 50).map((b: any, i: number) => (
                <tr key={`${b.segmentType}-${b.segment}-${i}`}>
                  <td style={td}><span style={{ textTransform: 'capitalize', color: '#94a3b8' }}>{b.segmentType}</span></td>
                  <td style={td}><strong>{b.segment}</strong></td>
                  <td style={td}>{b.count}</td>
                  <td style={td}>{b.withOutcome}</td>
                  <td style={td}>{b.brierScore != null ? b.brierScore.toFixed(4) : '—'}</td>
                  <td style={td}>{fmtPctRaw(b.hitRate)}</td>
                  <td style={td}>{evBadge(b.evidence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'notes' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Notes &amp; Methodology</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6, color: '#cbd5e1' }}>
            {data.notes.map((n: string, i: number) => <li key={i} style={{ marginBottom: 6 }}>{n}</li>)}
          </ul>
          <div style={{ marginTop: 16, fontSize: 11, color: '#64748b' }}>Generated: {data.generatedAt}</div>
        </div>
      )}
    </div>
  );
}

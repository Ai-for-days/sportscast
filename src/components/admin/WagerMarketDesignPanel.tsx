import React, { useState } from 'react';
import type { CreateWagerInput } from '../../lib/wager-types';

interface MarketDesignReview {
  id: string;
  generatedAt: string;
  generatedBy: string;
  wagerKind: string;
  metric: string;
  targetDate: string | null;
  targetTime?: string | null;
  locationSummary: string;
  fairnessScore: number;
  funScore: number;
  riskScore: number;
  houseEdgeEstimate: number;
  pricingNotes: string[];
  warnings: string[];
  recommendedAdjustments: string[];
  verdict: 'publishable' | 'needs_review' | 'not_recommended';
}

interface Props {
  /** Called on click to produce the current proposed input from the parent form. */
  getProposal: () => CreateWagerInput | null;
  /** Optional: clear the panel when the user changes form fields. Parent can pass a key to remount. */
  className?: string;
  /**
   * Optional: id of the most recent Step 96 pricing recommendation generated in this session.
   * Used purely as a soft cue — the Market Design Lab does not depend on the pricing engine.
   */
  latestPricingRecId?: string | null;
}

const verdictColor: Record<string, string> = {
  publishable: '#16a34a',
  needs_review: '#d97706',
  not_recommended: '#dc2626',
};
const verdictLabel: Record<string, string> = {
  publishable: 'Publishable',
  needs_review: 'Needs Review',
  not_recommended: 'Not Recommended',
};

const cardStyle: React.CSSProperties = {
  background: '#f1f5f9',
  border: '1px solid #cbd5e1',
  borderRadius: 8,
  padding: 14,
  marginTop: 12,
  marginBottom: 12,
};
const headerStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  flexWrap: 'wrap', gap: 8, marginBottom: 8,
};
const tile: React.CSSProperties = {
  background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: 10, minWidth: 110,
};
const sectionLabel: React.CSSProperties = { fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700, marginBottom: 4 };

function ScoreTile({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={tile}>
      <div style={{ fontSize: 11, color: '#64748b' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color ?? '#0f172a', fontFamily: 'ui-monospace, Menlo, monospace' }}>{value}</div>
    </div>
  );
}

export default function WagerMarketDesignPanel({ getProposal, latestPricingRecId }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<MarketDesignReview | null>(null);

  async function analyze() {
    setError(null);
    const proposal = getProposal();
    if (!proposal) {
      setError('Fill in the form fields above before analyzing.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/admin/wager-market-design', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'analyze', input: proposal }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message ?? j.error ?? 'analysis failed');
      setReview(j.review as MarketDesignReview);
    } catch (e: any) {
      setError(e?.message ?? 'analysis failed');
    } finally {
      setBusy(false);
    }
  }

  function clear() {
    setReview(null);
    setError(null);
  }

  return (
    <div style={cardStyle}>
      <div style={headerStyle}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>Market Design Lab</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>
            Advisory only. Does not publish or modify the wager — you still click <strong>Create Wager</strong> below.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {review && (
            <button
              type="button"
              onClick={clear}
              className="rounded bg-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-300"
            >Clear</button>
          )}
          <button
            type="button"
            onClick={analyze}
            disabled={busy}
            className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? 'Analyzing…' : 'Analyze Market Design'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 10px', borderRadius: 6, fontSize: 12, marginBottom: 8 }}>
          {error}
        </div>
      )}

      {!review && !error && (
        <div style={{ fontSize: 12, color: '#475569' }}>
          Click <em>Analyze Market Design</em> to see fairness / fun / risk / house-edge estimates plus pricing notes,
          warnings, and recommended adjustments. Reviews are audit-logged.
          {latestPricingRecId && (
            <div style={{ marginTop: 6, fontSize: 11, color: '#0369a1' }}>
              Pricing recommendation in this session: <code>{latestPricingRecId}</code>
            </div>
          )}
        </div>
      )}

      {review && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <span
              style={{
                background: verdictColor[review.verdict],
                color: '#fff', padding: '4px 10px', borderRadius: 9999,
                fontSize: 12, fontWeight: 700,
              }}
            >Verdict: {verdictLabel[review.verdict]}</span>
            <span style={{ fontSize: 11, color: '#64748b' }}>
              Review id <code>{review.id}</code> · {new Date(review.generatedAt).toLocaleString()} · {review.locationSummary}
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 12 }}>
            <ScoreTile label="Fairness"     value={review.fairnessScore}      color={review.fairnessScore >= 75 ? '#16a34a' : review.fairnessScore >= 50 ? '#d97706' : '#dc2626'} />
            <ScoreTile label="Fun"          value={review.funScore}           color={review.funScore >= 75 ? '#16a34a' : review.funScore >= 50 ? '#d97706' : '#dc2626'} />
            <ScoreTile label="Risk"         value={review.riskScore}          color={review.riskScore < 25 ? '#16a34a' : review.riskScore < 50 ? '#d97706' : '#dc2626'} />
            <ScoreTile label="House edge"   value={`${review.houseEdgeEstimate >= 0 ? '+' : ''}${review.houseEdgeEstimate.toFixed(1)}%`}
              color={review.houseEdgeEstimate >= 2 && review.houseEdgeEstimate <= 8 ? '#16a34a' : '#d97706'} />
          </div>

          {review.pricingNotes.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={sectionLabel}>Pricing notes</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#1e293b' }}>
                {review.pricingNotes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            </div>
          )}

          {review.warnings.length > 0 && (
            <div style={{ marginBottom: 10, background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 6, padding: 8 }}>
              <div style={{ ...sectionLabel, color: '#b45309' }}>Warnings ({review.warnings.length})</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#92400e' }}>
                {review.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          {review.recommendedAdjustments.length > 0 && (
            <div style={{ marginBottom: 6, background: '#e0f2fe', border: '1px solid #bae6fd', borderRadius: 6, padding: 8 }}>
              <div style={{ ...sectionLabel, color: '#075985' }}>Recommended adjustments</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#0c4a6e' }}>
                {review.recommendedAdjustments.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          )}

          <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>
            Reviewing this proposal does <strong>not</strong> create the wager. The wager is only created when you click
            <strong> Create Wager</strong> (or <em>Update Wager</em> when editing) below.
          </div>
        </>
      )}
    </div>
  );
}

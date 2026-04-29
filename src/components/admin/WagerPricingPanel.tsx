import React, { useState } from 'react';
import type { CreateWagerInput } from '../../lib/wager-types';

type PricingMode = 'fair' | 'standard_margin' | 'aggressive_margin' | 'custom_margin';
type Verdict = 'usable' | 'needs_review' | 'not_recommended';

interface SuggestedOutcome {
  label: string;
  suggestedOdds: number;
  impliedProbability: number;
  fairOdds: number;
  fairProbability: number;
}
interface SuggestedSide {
  suggestedOdds: number;
  impliedProbability: number;
  fairOdds: number;
  fairProbability: number;
}
interface PricingRecommendation {
  id: string;
  generatedAt: string;
  generatedBy: string;
  wagerKind: string;
  pricingMode: PricingMode;
  marginPct: number;
  estimatedHoldPct: number;
  notes: string[];
  warnings: string[];
  recommendedLineAdjustment?: string;
  verdict: Verdict;
  suggestion:
    | { kind: 'odds'; odds: { outcomes: SuggestedOutcome[] } }
    | { kind: 'over-under'; overUnder: { line: number; over: SuggestedSide; under: SuggestedSide } }
    | { kind: 'pointspread'; pointspread: { spread: number; locationA: SuggestedSide; locationB: SuggestedSide } }
    | { kind: 'unknown' };
}

/** Payload the parent uses to apply the suggestion back into form state. */
export type ApplySuggestion =
  | { kind: 'odds'; outcomes: { label: string; odds: number }[] }
  | { kind: 'over-under'; over: number; under: number }
  | { kind: 'pointspread'; locationA: number; locationB: number };

interface Props {
  /** Returns the current form proposal, or null if not ready. */
  getProposal: () => CreateWagerInput | null;
  /** Optional: caller receives the latest pricing rec id (for cross-panel cues). */
  onRecommendationGenerated?: (recId: string | null) => void;
  /** Optional: when present, the panel renders an "Apply Suggested Odds" button. */
  onApplySuggestedOdds?: (apply: ApplySuggestion) => void;
}

const verdictColor: Record<string, string> = {
  usable: '#16a34a',
  needs_review: '#d97706',
  not_recommended: '#dc2626',
};
const verdictLabel: Record<string, string> = {
  usable: 'Usable',
  needs_review: 'Needs Review',
  not_recommended: 'Not Recommended',
};

const cardStyle: React.CSSProperties = {
  background: '#eff6ff',
  border: '1px solid #bfdbfe',
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

const inputCls = 'rounded border border-slate-300 px-2 py-1 text-xs';
const selectCls = 'rounded border border-slate-300 px-2 py-1 text-xs bg-white';

function fmtOdds(odds: number): string {
  if (!Number.isFinite(odds) || odds === 0) return '—';
  return odds > 0 ? `+${odds}` : `${odds}`;
}
function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

export default function WagerPricingPanel({ getProposal, onRecommendationGenerated, onApplySuggestedOdds }: Props) {
  const [mode, setMode] = useState<PricingMode>('standard_margin');
  const [customMargin, setCustomMargin] = useState<string>('6');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rec, setRec] = useState<PricingRecommendation | null>(null);

  async function generate() {
    setError(null);
    const proposal = getProposal();
    if (!proposal) {
      setError('Fill in the form fields above before generating a pricing recommendation.');
      return;
    }
    let customMarginPct: number | undefined;
    if (mode === 'custom_margin') {
      const c = Number(customMargin);
      if (!Number.isFinite(c) || c < 0 || c > 20) {
        setError('Custom margin must be between 0 and 20.');
        return;
      }
      customMarginPct = c;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/admin/wager-pricing-engine', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate', input: proposal, pricingMode: mode, customMarginPct }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message ?? j.error ?? 'pricing failed');
      const r = j.recommendation as PricingRecommendation;
      setRec(r);
      if (onRecommendationGenerated) onRecommendationGenerated(r.id);
    } catch (e: any) {
      setError(e?.message ?? 'pricing failed');
    } finally {
      setBusy(false);
    }
  }

  function clear() {
    setRec(null);
    setError(null);
    if (onRecommendationGenerated) onRecommendationGenerated(null);
  }

  function applyToForm() {
    if (!rec || !onApplySuggestedOdds) return;
    if (rec.suggestion.kind === 'odds') {
      onApplySuggestedOdds({
        kind: 'odds',
        outcomes: rec.suggestion.odds.outcomes.map(o => ({ label: o.label, odds: o.suggestedOdds })),
      });
    } else if (rec.suggestion.kind === 'over-under') {
      onApplySuggestedOdds({
        kind: 'over-under',
        over: rec.suggestion.overUnder.over.suggestedOdds,
        under: rec.suggestion.overUnder.under.suggestedOdds,
      });
    } else if (rec.suggestion.kind === 'pointspread') {
      onApplySuggestedOdds({
        kind: 'pointspread',
        locationA: rec.suggestion.pointspread.locationA.suggestedOdds,
        locationB: rec.suggestion.pointspread.locationB.suggestedOdds,
      });
    }
  }

  return (
    <div style={cardStyle}>
      <div style={headerStyle}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>Pricing & Margin Engine</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>
            Converts true probabilities into suggested American odds with configurable margin.
            Advisory only — does not publish or modify the wager.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 11, color: '#475569' }}>
            Mode
            <select value={mode} onChange={e => setMode(e.target.value as PricingMode)} className={selectCls} style={{ marginLeft: 6 }}>
              <option value="fair">fair (0%)</option>
              <option value="standard_margin">standard (6%)</option>
              <option value="aggressive_margin">aggressive (10%)</option>
              <option value="custom_margin">custom…</option>
            </select>
          </label>
          {mode === 'custom_margin' && (
            <label style={{ fontSize: 11, color: '#475569' }}>
              Margin %
              <input
                value={customMargin}
                onChange={e => setCustomMargin(e.target.value)}
                inputMode="decimal"
                className={inputCls}
                style={{ width: 60, marginLeft: 6 }}
                placeholder="0–20"
              />
            </label>
          )}
          {rec && (
            <button type="button" onClick={clear}
              className="rounded bg-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-300">
              Clear
            </button>
          )}
          <button type="button" onClick={generate} disabled={busy}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            {busy ? 'Generating…' : 'Generate Pricing Recommendation'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 10px', borderRadius: 6, fontSize: 12, marginBottom: 8 }}>
          {error}
        </div>
      )}

      {!rec && !error && (
        <div style={{ fontSize: 12, color: '#475569' }}>
          Enter your current odds in the form above (or rely on the existing implied probabilities), pick a margin mode, then
          click <em>Generate Pricing Recommendation</em>. Recommendations are audit-logged.
        </div>
      )}

      {rec && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <span style={{
              background: verdictColor[rec.verdict], color: '#fff',
              padding: '4px 10px', borderRadius: 9999, fontSize: 12, fontWeight: 700,
            }}>Verdict: {verdictLabel[rec.verdict]}</span>
            <span style={{ fontSize: 11, color: '#64748b' }}>
              Rec id <code>{rec.id}</code> · mode <strong>{rec.pricingMode}</strong> · margin {rec.marginPct}%
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 12 }}>
            <Tile label="Margin" value={`${rec.marginPct}%`} />
            <Tile label="Est. hold" value={`${rec.estimatedHoldPct >= 0 ? '+' : ''}${rec.estimatedHoldPct.toFixed(1)}%`}
              color={rec.estimatedHoldPct >= 2 && rec.estimatedHoldPct <= 8 ? '#16a34a' : rec.estimatedHoldPct < 0 ? '#dc2626' : '#d97706'} />
            <Tile label="Outcomes priced" value={`${countOutcomes(rec)}`} />
          </div>

          {rec.suggestion.kind === 'odds' && (
            <SuggestionTable
              rows={rec.suggestion.odds.outcomes.map(o => ({
                label: o.label,
                fairOdds: o.fairOdds, fairProb: o.fairProbability,
                suggestedOdds: o.suggestedOdds, impliedProb: o.impliedProbability,
              }))}
            />
          )}
          {rec.suggestion.kind === 'over-under' && (
            <SuggestionTable
              rows={[
                { label: `Over ${rec.suggestion.overUnder.line}`,  fairOdds: rec.suggestion.overUnder.over.fairOdds,  fairProb: rec.suggestion.overUnder.over.fairProbability,  suggestedOdds: rec.suggestion.overUnder.over.suggestedOdds,  impliedProb: rec.suggestion.overUnder.over.impliedProbability },
                { label: `Under ${rec.suggestion.overUnder.line}`, fairOdds: rec.suggestion.overUnder.under.fairOdds, fairProb: rec.suggestion.overUnder.under.fairProbability, suggestedOdds: rec.suggestion.overUnder.under.suggestedOdds, impliedProb: rec.suggestion.overUnder.under.impliedProbability },
              ]}
            />
          )}
          {rec.suggestion.kind === 'pointspread' && (
            <SuggestionTable
              rows={[
                { label: `Location A (spread ${rec.suggestion.pointspread.spread > 0 ? '+' : ''}${rec.suggestion.pointspread.spread})`, fairOdds: rec.suggestion.pointspread.locationA.fairOdds, fairProb: rec.suggestion.pointspread.locationA.fairProbability, suggestedOdds: rec.suggestion.pointspread.locationA.suggestedOdds, impliedProb: rec.suggestion.pointspread.locationA.impliedProbability },
                { label: `Location B`, fairOdds: rec.suggestion.pointspread.locationB.fairOdds, fairProb: rec.suggestion.pointspread.locationB.fairProbability, suggestedOdds: rec.suggestion.pointspread.locationB.suggestedOdds, impliedProb: rec.suggestion.pointspread.locationB.impliedProbability },
              ]}
            />
          )}

          {rec.notes.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={sectionLabel}>Pricing notes</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#1e293b' }}>
                {rec.notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            </div>
          )}

          {rec.warnings.length > 0 && (
            <div style={{ marginTop: 10, background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 6, padding: 8 }}>
              <div style={{ ...sectionLabel, color: '#b45309' }}>Warnings ({rec.warnings.length})</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#92400e' }}>
                {rec.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          {rec.recommendedLineAdjustment && (
            <div style={{ marginTop: 10, background: '#e0f2fe', border: '1px solid #bae6fd', borderRadius: 6, padding: 8 }}>
              <div style={{ ...sectionLabel, color: '#075985' }}>Recommended line adjustment</div>
              <div style={{ fontSize: 12, color: '#0c4a6e' }}>{rec.recommendedLineAdjustment}</div>
            </div>
          )}

          {onApplySuggestedOdds && rec.verdict !== 'not_recommended' && rec.suggestion.kind !== 'unknown' && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed #cbd5e1' }}>
              <button type="button" onClick={applyToForm}
                className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">
                Apply Suggested Odds
              </button>
              <span style={{ fontSize: 11, color: '#64748b', marginLeft: 10 }}>
                Apply to form only — wager is not created until <strong>Create Wager</strong> is clicked.
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function countOutcomes(rec: PricingRecommendation): number {
  if (rec.suggestion.kind === 'odds') return rec.suggestion.odds.outcomes.length;
  if (rec.suggestion.kind === 'over-under' || rec.suggestion.kind === 'pointspread') return 2;
  return 0;
}

function Tile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={tile}>
      <div style={{ fontSize: 11, color: '#64748b' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color ?? '#0f172a', fontFamily: 'ui-monospace, Menlo, monospace' }}>{value}</div>
    </div>
  );
}

function SuggestionTable({ rows }: {
  rows: { label: string; fairOdds: number; fairProb: number; suggestedOdds: number; impliedProb: number }[];
}) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #cbd5e1', background: '#f8fafc' }}>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: '#475569' }}>Outcome</th>
            <th style={{ textAlign: 'right', padding: '6px 8px', color: '#475569' }}>Fair odds</th>
            <th style={{ textAlign: 'right', padding: '6px 8px', color: '#475569' }}>Fair %</th>
            <th style={{ textAlign: 'right', padding: '6px 8px', color: '#475569' }}>Suggested</th>
            <th style={{ textAlign: 'right', padding: '6px 8px', color: '#475569' }}>Implied %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #e2e8f0' }}>
              <td style={{ padding: '6px 8px' }}>{r.label}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'ui-monospace, Menlo, monospace' }}>{fmtOdds(r.fairOdds)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: '#64748b' }}>{pct(r.fairProb)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, fontFamily: 'ui-monospace, Menlo, monospace' }}>{fmtOdds(r.suggestedOdds)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: '#64748b' }}>{pct(r.impliedProb)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

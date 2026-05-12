// ── Step 157: Operator-facing explanation builder for generated ideas ───
//
// Pure function that consolidates the existing signals on a
// `WeatherMarketIdea` (target-difference closeness, smart preset / tag
// context, cross-metric warnings, Step-150 risk warnings, Step-156
// interestingness, Step-155 feedback rate when available) into a
// short, operator-facing "why this idea / what to check" explanation.
//
// **Operator workflow guidance only.** Never used on customer surfaces.
// Never references prohibited gambling vocabulary (`edge`, `profit`,
// `value bet`, `should bet`, `likely winner`, `easy money`, `lock`).
// The output is a plain data object the UI renders verbatim.

import type { WeatherMarketIdea } from './weather-market-idea-generator';
import type { WeatherMarketRiskWarning, RiskSeverity } from './weather-market-risk-warnings';

// ── Public types ────────────────────────────────────────────────────────────

export type ExplanationCautionLevel = 'low' | 'medium' | 'high';

export interface WeatherMarketIdeaExplanation {
  /** Short reasons the generator surfaced this idea. */
  whySuggested: string[];
  /** Why an operator might find it worth looking at. */
  whyInteresting: string[];
  /** Things to be aware of before publishing. */
  riskSummary: string[];
  /** Operator pre-flight checklist items. */
  preCreationChecklist: string[];
  /** One-sentence summary suitable for a collapsed-card header. */
  operatorSummary: string;
  /** Aggregate caution level driven by the present signals. */
  cautionLevel: ExplanationCautionLevel;
}

// ── Build inputs ────────────────────────────────────────────────────────────

export interface BuildExplanationOptions {
  /** Step 150 risk warnings keyed to this idea, if available. */
  riskWarnings?: WeatherMarketRiskWarning[];
  /** Step 154 — preset id that produced the run, when applicable. */
  presetId?: string;
  /** Step 154 — tag filter that produced the run, when applicable. */
  weatherTags?: string[];
  /** Step 145 — target-difference search context (if active). */
  targetDifferenceF?: number;
  toleranceF?: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function highestSeverity(
  warnings: readonly WeatherMarketRiskWarning[] | undefined,
): RiskSeverity | null {
  if (!warnings || warnings.length === 0) return null;
  let highest: RiskSeverity = 'info';
  for (const w of warnings) {
    if (w.severity === 'high') return 'high';
    if (w.severity === 'warning' && highest === 'info') highest = 'warning';
  }
  return highest;
}

function isCrossMetric(idea: WeatherMarketIdea): boolean {
  return idea.metricA !== idea.metricB;
}

function describeMetricPair(idea: WeatherMarketIdea): string {
  const labelA = idea.metricA === 'daily_high' ? 'high' : 'low';
  const labelB = idea.metricB === 'daily_high' ? 'high' : 'low';
  if (labelA === labelB) return `${labelA}-vs-${labelB}`;
  return `${labelA}-vs-${labelB}`;
}

function formatRate(rate: number | undefined): string {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return '';
  return `${Math.round(rate * 100)}%`;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Pure, never-throws builder. Returns a complete explanation object
 * even when the optional signals are missing — the resulting card just
 * has fewer bullets. **No I/O. No mutation. No imports beyond types.**
 */
export function buildIdeaExplanation(
  idea: WeatherMarketIdea,
  options: BuildExplanationOptions = {},
): WeatherMarketIdeaExplanation {
  const whySuggested: string[] = [];
  const whyInteresting: string[] = [];
  const riskSummary: string[] = [];
  const preCreationChecklist: string[] = [];

  // ── whySuggested ─────────────────────────────────────────────────────────
  if (options.presetId) {
    whySuggested.push(
      `Surfaced by the "${options.presetId}" smart-discovery preset.`,
    );
  }
  if (options.weatherTags && options.weatherTags.length > 0) {
    whySuggested.push(
      `Filtered by the ${options.weatherTags.length === 1 ? 'tag' : 'tags'} ` +
        `[${options.weatherTags.join(', ')}] across the approved city universe.`,
    );
  }
  if (typeof options.targetDifferenceF === 'number') {
    const tol = options.toleranceF ?? 3;
    if (idea.closenessToTarget !== undefined && idea.closenessToTarget <= tol) {
      whySuggested.push(
        `Forecasted difference is within ${idea.closenessToTarget.toFixed(1)}°F of your requested target of ${options.targetDifferenceF}°F.`,
      );
    } else {
      whySuggested.push(
        `Target-difference search around ${options.targetDifferenceF}°F (± ${tol}°F).`,
      );
    }
  }
  if (whySuggested.length === 0) {
    whySuggested.push(
      `Highest-interestingness ${describeMetricPair(idea)} contrast across the selected cities.`,
    );
  }

  // ── whyInteresting ───────────────────────────────────────────────────────
  if (idea.absDifference >= 20) {
    whyInteresting.push(
      `Large forecasted spread (${idea.absDifference}°F absolute) gives the market a clear shape.`,
    );
  } else if (idea.absDifference >= 10) {
    whyInteresting.push(
      `Moderate forecasted spread (${idea.absDifference}°F absolute) — clean but not extreme.`,
    );
  } else {
    whyInteresting.push(
      `Tight forecasted spread (${idea.absDifference}°F absolute) — operator may need to verify it's still interesting at this size.`,
    );
  }
  if (isCrossMetric(idea)) {
    whyInteresting.push(
      `Cross-metric pairing (${idea.metricA === 'daily_high' ? 'high' : 'low'} vs ${idea.metricB === 'daily_high' ? 'high' : 'low'}) is uncommon and may stand out to customers.`,
    );
  }
  if (idea.locationA.region !== idea.locationB.region) {
    whyInteresting.push(
      `Cross-region pair (${idea.locationA.region} vs ${idea.locationB.region}) — distinct climate signals on each side.`,
    );
  }
  const oi = idea.outcomeInterestingness;
  if (oi && oi.label !== 'insufficient_history') {
    const labelCopy = oi.label === 'high_interest'
      ? 'high interest'
      : oi.label === 'promising'
        ? 'promising'
        : oi.label === 'neutral'
          ? 'neutral'
          : 'low signal';
    whyInteresting.push(
      `Historical-outcome score ${oi.score}/100 (${labelCopy}, n=${oi.sampleCount}). Operator-only ranking — not betting advice.`,
    );
  }
  if (idea.confidenceLabel === 'higher') {
    whyInteresting.push(
      `Forecast-confidence label: higher (close-in target date + sizeable spread).`,
    );
  } else if (idea.confidenceLabel === 'lower') {
    whyInteresting.push(
      `Forecast-confidence label: lower — operator may want a closer target date.`,
    );
  }

  // ── riskSummary ──────────────────────────────────────────────────────────
  const sev = highestSeverity(options.riskWarnings);
  if (sev === 'high') {
    const count = options.riskWarnings?.filter((w) => w.severity === 'high').length ?? 0;
    riskSummary.push(
      `${count} high-severity duplicate/correlation warning(s) — review related markets before publishing.`,
    );
  } else if (sev === 'warning') {
    const count = options.riskWarnings?.filter((w) => w.severity === 'warning').length ?? 0;
    riskSummary.push(
      `${count} warning-severity correlation hint(s) — worth a glance before publishing.`,
    );
  }
  if (oi && oi.label === 'insufficient_history') {
    riskSummary.push(
      `Historical sample is below the 3-record threshold — interestingness is based mostly on forecast contrast, not history.`,
    );
  }
  if (idea.warnings && idea.warnings.length > 0) {
    for (const w of idea.warnings) {
      if (/horizon|beyond/i.test(w)) {
        riskSummary.push(
          `Target date is beyond the reliable forecast horizon — confidence will be lower.`,
        );
        break;
      }
    }
  }
  if (oi && oi.label !== 'insufficient_history') {
    for (const reason of oi.reasons) {
      if (/voided/i.test(reason)) {
        riskSummary.push(reason);
        break;
      }
    }
  }

  // ── preCreationChecklist ─────────────────────────────────────────────────
  preCreationChecklist.push(
    `Confirm the spread sign matches the intended side (${idea.suggestedSpread >= 0 ? `+${idea.suggestedSpread}` : idea.suggestedSpread}°F on the A side).`,
  );
  preCreationChecklist.push(
    `Verify both cities and the target date (${idea.targetDate}) are correct for the market you want to publish.`,
  );
  if (isCrossMetric(idea)) {
    preCreationChecklist.push(
      `Cross-metric idea — verify the wager preview renders metricA / metricB labels correctly before publishing.`,
    );
  }
  if (sev === 'high' || sev === 'warning') {
    preCreationChecklist.push(
      `Open the related markets surfaced by the duplicate/correlation warnings before publishing.`,
    );
  }
  if (oi && oi.label === 'insufficient_history') {
    preCreationChecklist.push(
      `Sample size is low — read the forecast values, not the score, when deciding whether to proceed.`,
    );
  }

  // ── caution level ────────────────────────────────────────────────────────
  let cautionLevel: ExplanationCautionLevel = 'low';
  if (sev === 'high') {
    cautionLevel = 'high';
  } else if (sev === 'warning') {
    cautionLevel = 'medium';
  } else if (
    (oi && oi.label === 'insufficient_history') ||
    (idea.warnings && idea.warnings.some((w) => /horizon|beyond/i.test(w))) ||
    isCrossMetric(idea)
  ) {
    cautionLevel = 'medium';
  }

  // ── operatorSummary (one-line collapsed-card header) ─────────────────────
  const oiHint =
    oi && oi.label !== 'insufficient_history'
      ? ` · interestingness ${oi.score}/100 (${oi.label.replace(/_/g, ' ')})`
      : oi
        ? ` · interestingness ${oi.score}/100 (insufficient history)`
        : '';
  const cautionHint =
    cautionLevel === 'high'
      ? ' · ⚠ high caution'
      : cautionLevel === 'medium'
        ? ' · medium caution'
        : '';
  const operatorSummary =
    `${describeMetricPair(idea)} contrast of ${idea.absDifference}°F between ${idea.locationA.label} and ${idea.locationB.label} on ${idea.targetDate}${oiHint}${cautionHint}.`;

  return {
    whySuggested,
    whyInteresting,
    riskSummary,
    preCreationChecklist,
    operatorSummary,
    cautionLevel,
  };
}

// ── Step 147: Pure mapper — saved weather market idea → CreateWagerInput ──
//
// Translates a `WeatherMarketIdea` (or a `SavedWeatherMarketIdea`'s
// `.idea`) into the `CreateWagerInput` shape the existing wager-create
// path expects. **Pure function. No I/O, no Redis, no fetch, no
// imports from wager-store / settlement / grading / wallet / pricing.**
// The only thing this file produces is a plain object. Whoever calls
// it is responsible for deciding whether to persist that object as a
// draft (Step 147 admin draft-wager store) or hand it to `createWager`
// (a published wager).
//
// Currently only emits `pointspread` inputs. The generator never
// produces other kinds.

import type { CreateWagerInput, WagerMetric } from './wager-types';
import type { WeatherMarketIdea } from './weather-market-idea-generator';

const IDEA_METRIC_TO_WAGER_METRIC: Record<'daily_high' | 'daily_low', WagerMetric> = {
  daily_high: 'high_temp',
  daily_low: 'low_temp',
};

const METRIC_LABELS: Record<'daily_high' | 'daily_low', string> = {
  daily_high: 'High',
  daily_low: 'Low',
};

export interface BuildDraftInputOptions {
  /**
   * Override the idea's title. Step 147's UI lets the operator edit
   * the title before persisting; pass it here when they did.
   */
  title?: string;
  /** Override the description. */
  description?: string;
}

export interface BuildDraftInputResult {
  /** Ready to hand to `createWager` (or to persist as a draft). */
  input: CreateWagerInput;
  /** Human-readable rules-card copy derived from the idea. */
  rulesCopy: string;
  /** Notes the mapper wants the operator to see before publishing. */
  warnings: string[];
}

/**
 * Map a generator-produced idea into a `CreateWagerInput`. Cross-metric
 * ideas (high vs low) are emitted with `metricA` / `metricB` set; same-
 * metric ideas leave them unset (so the saved record stays byte-
 * identical to a single-metric pointspread, per Step 145 guarantees).
 */
export function buildDraftWagerInputFromIdea(
  idea: WeatherMarketIdea,
  options: BuildDraftInputOptions = {},
): BuildDraftInputResult {
  const metricA = IDEA_METRIC_TO_WAGER_METRIC[idea.metricA];
  const metricB = IDEA_METRIC_TO_WAGER_METRIC[idea.metricB];
  const sharedMetric: WagerMetric =
    metricA === metricB ? metricA : metricA; // arbitrary when cross-metric — per-side overrides take effect

  const title = (options.title ?? idea.title).trim();
  const description = (options.description ?? idea.description ?? '').trim();

  const input: CreateWagerInput = {
    kind: 'pointspread',
    title,
    description: description || undefined,
    metric: sharedMetric,
    targetDate: idea.targetDate,
    locationA: {
      name: idea.locationA.label,
      lat: idea.locationA.lat,
      lon: idea.locationA.lon,
    },
    locationB: {
      name: idea.locationB.label,
      lat: idea.locationB.lat,
      lon: idea.locationB.lon,
    },
    spread: idea.suggestedSpread,
    locationAOdds: idea.suggestedOddsA,
    locationBOdds: idea.suggestedOddsB,
  };

  // Step 145 — only emit per-side overrides when they actually differ
  // from the shared metric, mirroring what the wager-create form does.
  if (metricA !== metricB) {
    input.metricA = metricA;
    input.metricB = metricB;
  }

  const rulesCopy = describeRulesForOperator(idea, metricA, metricB);
  const warnings: string[] = [];
  if (metricA !== metricB) {
    warnings.push(
      'Cross-metric pointspread — Location A grades on ' +
        `${METRIC_LABELS[idea.metricA]} and Location B grades on ${METRIC_LABELS[idea.metricB]}. ` +
        'Confirm the per-side metric labels render correctly in the wager preview before publishing.',
    );
  }
  if (idea.warnings.some((w) => /horizon|beyond/i.test(w))) {
    warnings.push(
      'Forecast target date is beyond the reliable 5-day horizon — ' +
        'the suggested spread is based on a degrading forecast. Re-check before publishing.',
    );
  }

  return { input, rulesCopy, warnings };
}

function describeRulesForOperator(
  idea: WeatherMarketIdea,
  metricA: WagerMetric,
  metricB: WagerMetric,
): string {
  // Operator-facing rules summary. Customer-facing copy is generated
  // separately by `public-wager-view.ts` once the wager actually exists,
  // so this string is for the admin's eyes only — it's persisted on the
  // draft as a convenience reminder of what the market is supposed to be.
  if (metricA !== metricB) {
    return (
      `Pointspread: ${idea.locationA.label} (${METRIC_LABELS[idea.metricA]}) ` +
      `vs ${idea.locationB.label} (${METRIC_LABELS[idea.metricB]}) on ${idea.targetDate}. ` +
      `Suggested spread ${formatSpread(idea.suggestedSpread)} (A side); odds ` +
      `A ${idea.suggestedOddsA} / B ${idea.suggestedOddsB}. Cross-metric — ` +
      `confirm wager preview shows per-side metric labels before publishing.`
    );
  }
  return (
    `Pointspread: ${idea.locationA.label} vs ${idea.locationB.label} on ${idea.targetDate}, ` +
    `daily ${metricA === 'high_temp' ? 'high' : 'low'} temperature. ` +
    `Suggested spread ${formatSpread(idea.suggestedSpread)} (A side); odds ` +
    `A ${idea.suggestedOddsA} / B ${idea.suggestedOddsB}.`
  );
}

function formatSpread(s: number): string {
  return `${s >= 0 ? '+' : ''}${s}°F`;
}

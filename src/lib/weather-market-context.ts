// ── Step 132: Weather market context from forecast intelligence ─────────────
//
// Derives a *neutral, non-advisory* customer-facing context summary from
// the existing Step 129/130/131 forecast intelligence outputs. Mounted
// above the weather-page market section so users understand when the
// underlying forecast has been shifting in ways that may matter for the
// markets shown — without ever telling them whether or how to bet.
//
// LANGUAGE GUARDRAILS — these are the rules this module enforces by
// construction. No string in this file (or downstream copy) should ever:
//
//   - say or imply the user should/shouldn't bet
//   - reference "edge", "profit", "value", "expected value", "mispriced"
//   - claim a market is more or less likely to win
//   - frame anything as advice
//
// Allowed framing: forecast context education ("Rain timing may matter
// for precipitation markets"). Always paired with a disclaimer.
//
// Pure functions, no side effects, no Redis. Same trust posture as
// forecast-intelligence.ts and forecast-timeline.ts.

import type { ForecastIntelligenceSummary } from './forecast-intelligence';
import type { ForecastRevisionSummary } from './forecast-revision-analysis';
import type { ForecastTimelineResult } from './forecast-timeline';

export type WeatherMarketContextTone = 'steady' | 'watch' | 'uncertain';

export type AffectedMarketKind = 'temperature' | 'precipitation' | 'wind' | 'severe';

export interface WeatherMarketContextSummary {
  /** True when nothing meaningful to surface — caller should render nothing. */
  isEmpty: boolean;
  /** Short user-facing headline. */
  headline: string;
  tone: WeatherMarketContextTone;
  /** 1–3 short bullets. */
  bullets: string[];
  /** Hint about which market kinds the context particularly applies to. */
  affectedMarketKinds: AffectedMarketKind[];
  /** Footer disclaimer. Always present so the card is unambiguous. */
  disclaimer: string;
}

const DISCLAIMER = 'This is forecast context, not betting advice.';

const EMPTY: WeatherMarketContextSummary = {
  isEmpty: true,
  headline: '',
  tone: 'steady',
  bullets: [],
  affectedMarketKinds: [],
  disclaimer: DISCLAIMER,
};

// ── Inputs ──────────────────────────────────────────────────────────────────

export interface BuildContextInputs {
  intelligence: ForecastIntelligenceSummary;
  revision: ForecastRevisionSummary;
  timeline: ForecastTimelineResult;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function hasKind(
  inputs: BuildContextInputs,
  kinds: ReadonlyArray<string>,
): boolean {
  if (inputs.revision.changes.some((c) => kinds.includes(c.kind))) return true;
  for (const e of inputs.timeline.entries) {
    if (e.changes.some((c) => kinds.includes(c.kind))) return true;
  }
  return false;
}

function dedupe<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

// ── Public entry point ──────────────────────────────────────────────────────

export function buildWeatherMarketContext(
  inputs: BuildContextInputs,
): WeatherMarketContextSummary {
  const { intelligence, revision, timeline } = inputs;

  // No history yet AND nothing notable about the current intelligence — give
  // the page a quiet fallback by rendering nothing.
  const isQuiet =
    revision.isInitial &&
    timeline.entries.length === 0 &&
    intelligence.confidence === 'high' &&
    intelligence.volatility === 'stable' &&
    !intelligence.hasActiveSevereAlert;
  if (isQuiet) return EMPTY;

  // Severe alert presence trumps everything.
  if (
    intelligence.hasActiveSevereAlert ||
    hasKind(inputs, ['severe_added'])
  ) {
    return {
      isEmpty: false,
      headline: 'Conditions may be changing quickly',
      tone: 'uncertain',
      bullets: [
        'A severe weather signal is part of the current forecast picture.',
        'Markets tied to this period may resolve on whatever is officially observed.',
      ],
      affectedMarketKinds: ['severe', 'temperature', 'precipitation', 'wind'],
      disclaimer: DISCLAIMER,
    };
  }

  // Volatility / low confidence drives an "uncertain" lead.
  if (intelligence.volatility === 'volatile' || intelligence.confidence === 'low') {
    const affected = dedupe<AffectedMarketKind>([
      ...(hasKind(inputs, ['wetter', 'drier']) ? ['precipitation'] as const : []),
      ...(hasKind(inputs, ['warming', 'cooling']) ? ['temperature'] as const : []),
      ...(hasKind(inputs, ['windier', 'calming']) ? ['wind'] as const : []),
    ]);
    return {
      isEmpty: false,
      headline: 'Forecast has been shifting',
      tone: 'uncertain',
      bullets: [
        'Recent updates show meaningful movement in the underlying forecast.',
        affected.length > 0
          ? `${affectedKindLabel(affected)} markets may be more sensitive while conditions are changing.`
          : 'Markets tied to these conditions may be more sensitive while the forecast is moving.',
      ],
      affectedMarketKinds: affected.length > 0 ? affected : ['temperature', 'precipitation', 'wind'],
      disclaimer: DISCLAIMER,
    };
  }

  // Targeted "watch" context when a single dimension is moving.
  const wetting = hasKind(inputs, ['wetter']);
  const drying = hasKind(inputs, ['drier']);
  const warming = hasKind(inputs, ['warming']);
  const cooling = hasKind(inputs, ['cooling']);
  const windier = hasKind(inputs, ['windier']);
  const calming = hasKind(inputs, ['calming']);

  if (wetting || drying) {
    return {
      isEmpty: false,
      headline: wetting ? 'Rain timing may matter' : 'Drier trend may matter',
      tone: 'watch',
      bullets: [
        wetting
          ? 'Precipitation chances have moved upward in recent updates.'
          : 'Precipitation chances have eased in recent updates.',
        'Rain-related markets can be sensitive to timing and the resolution rules each market documents.',
      ],
      affectedMarketKinds: ['precipitation'],
      disclaimer: DISCLAIMER,
    };
  }

  if (warming || cooling) {
    return {
      isEmpty: false,
      headline: warming ? 'Temperatures trending warmer' : 'Temperatures trending cooler',
      tone: 'watch',
      bullets: [
        warming
          ? 'Recent updates have nudged the forecast warmer.'
          : 'Recent updates have nudged the forecast cooler.',
        'Temperature markets may be more sensitive while the forecast is moving.',
      ],
      affectedMarketKinds: ['temperature'],
      disclaimer: DISCLAIMER,
    };
  }

  if (windier || calming) {
    return {
      isEmpty: false,
      headline: windier ? 'Wind forecast strengthening' : 'Wind forecast easing',
      tone: 'watch',
      bullets: [
        windier
          ? 'Recent updates show winds picking up across the forecast period.'
          : 'Recent updates show winds easing across the forecast period.',
        'Wind markets may be more sensitive while the forecast is shifting.',
      ],
      affectedMarketKinds: ['wind'],
      disclaimer: DISCLAIMER,
    };
  }

  // Default: steady. Surface a calm reassurance that recent updates have
  // been consistent — useful context even when nothing is moving.
  return {
    isEmpty: false,
    headline: 'Forecast has been relatively steady',
    tone: 'steady',
    bullets: [
      'Recent weather updates have not shown large swings.',
      'Market outcomes still depend on the final observed conditions and each market’s documented resolution rules.',
    ],
    affectedMarketKinds: [],
    disclaimer: DISCLAIMER,
  };
}

function affectedKindLabel(kinds: AffectedMarketKind[]): string {
  const lookup: Record<AffectedMarketKind, string> = {
    temperature: 'Temperature',
    precipitation: 'Precipitation',
    wind: 'Wind',
    severe: 'Severe-weather',
  };
  const labels = kinds.map((k) => lookup[k]);
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

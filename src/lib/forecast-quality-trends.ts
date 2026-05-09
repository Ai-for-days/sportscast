// ── Step 140: Forecast quality trend analytics ──────────────────────────────
//
// Pure aggregation over historical `BatchQualityReport` snapshots. Splits
// the chosen rolling window into earlier and later halves, computes
// per-provider mean absolute error / weak-bucket rate / unavailable rate
// for each half, and labels each axis `improving` / `stable` / `degrading`
// / `insufficient_data` based on the half-to-half delta.
//
// Strict framing:
//   - Heuristic. Sample sizes are surfaced everywhere so the operator
//     never reads a tiny sample as a verdict.
//   - "Improving / degrading" is half-to-half delta on rolling MAE,
//     **not** statistical significance. Two days of noisy data can flip
//     the badge; trust persistent multi-period direction, not single
//     readings.
//   - No provider is called "best". The dashboard is descriptive only.
//   - Settlement is unaffected — this layer only reads from
//     `forecast-quality-report-store.ts`. No grading code touched.
//
// Server-only consumers — but the module itself is pure data-in /
// data-out, so it is safe to import from server-side admin contexts. No
// Redis access here; the caller passes the report slice.

import type { BatchQualityReport, ProviderAggregateScore } from './forecast-quality-batch-runner';
import type {
  QualityField,
  QualityHorizon,
  QualityScoreBucket,
} from './forecast-quality-gates';

export type TrendWindow = '24h' | '7d' | '30d';
export type TrendDirection = 'improving' | 'stable' | 'degrading' | 'insufficient_data';

export interface AxisTrend {
  /** Mean (later-half) value. Null when the later half had no data. */
  current: number | null;
  /** Mean (earlier-half) value. Null when the earlier half had no data. */
  prior: number | null;
  direction: TrendDirection;
  /** Short human-readable note suitable for tooltips. */
  note: string;
}

export interface ProviderTrendSummary {
  provider: string;
  label: string;
  /** How many reports in the window included this provider. */
  reportCount: number;
  /** Total scored cells (good + acceptable + weak) over the window. */
  totalCells: number;
  /** Total cells where forecast/observation was unavailable. */
  totalUnavailable: number;
  /** Window-wide weak-bucket rate as percentage of totalCells. */
  weakRatePct: number;
  /** Window-wide unavailable-cell rate as percentage of (totalCells + totalUnavailable). */
  unavailableRatePct: number;
  /** Per-axis trend objects. */
  meanTempErrorTrend: AxisTrend;
  weakRateTrend: AxisTrend;
  unavailableRateTrend: AxisTrend;
  perField: Record<QualityField, AxisTrend>;
  perHorizon: Record<QualityHorizon, AxisTrend>;
}

export interface CityOutlier {
  cityId: string;
  cityLabel: string;
  /** Reports in window where this city's row.ok === false. */
  failureCount: number;
  /** Reports in window where this city appeared at all. */
  appearanceCount: number;
  failureRatePct: number;
}

export type InsightSeverity = 'info' | 'notice' | 'warning';

export interface TrendInsight {
  text: string;
  severity: InsightSeverity;
}

export interface QualityTrendDashboard {
  window: TrendWindow;
  windowStartIso: string;
  windowEndIso: string;
  /** Total reports inside the window. */
  reportCount: number;
  providers: ProviderTrendSummary[];
  cityOutliers: CityOutlier[];
  insights: TrendInsight[];
  warnings: string[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const WINDOW_MS: Record<TrendWindow, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

/** % delta below which a change is "stable" rather than improving/degrading. */
const STABLE_BAND_PCT = 5;
/** Absolute floor on |delta| in MAE units below which a change is stable
 *  even if the % delta crosses the band. Avoids "degraded 6%" verdicts on
 *  meaningless absolute differences. */
const STABLE_FLOOR_TEMP_F = 0.3;
const STABLE_FLOOR_PCT = 1.5;

const FIELDS: QualityField[] = ['temperature', 'windSpeed', 'windGust', 'precipitation'];
const HORIZONS: QualityHorizon[] = ['h0', 'h6', 'h12', 'h24'];

function avgOrNull(xs: Array<number | null | undefined>): number | null {
  const present = xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  if (present.length === 0) return null;
  return present.reduce((s, x) => s + x, 0) / present.length;
}

function rounded(n: number | null, digits = 1): number | null {
  if (n === null || !Number.isFinite(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function classifyTrend(
  prior: number | null,
  current: number | null,
  options: { lowerIsBetter: boolean; floor?: number },
): { direction: TrendDirection; note: string } {
  if (prior === null && current === null) {
    return { direction: 'insufficient_data', note: 'No samples in either half of the window.' };
  }
  if (prior === null || current === null) {
    return { direction: 'insufficient_data', note: 'Only one half of the window had data; trend not computable.' };
  }
  const delta = current - prior;
  const absDelta = Math.abs(delta);
  const denom = Math.abs(prior) > 0 ? Math.abs(prior) : 1;
  const pctDelta = (delta / denom) * 100;
  const floor = options.floor ?? 0;

  if (absDelta <= floor || Math.abs(pctDelta) <= STABLE_BAND_PCT) {
    return {
      direction: 'stable',
      note: `Held within ${STABLE_BAND_PCT}% (Δ=${rounded(delta, 2)}).`,
    };
  }

  // Lower is better → negative delta = improving.
  const movedBetter = options.lowerIsBetter ? delta < 0 : delta > 0;
  return {
    direction: movedBetter ? 'improving' : 'degrading',
    note: `Δ=${rounded(delta, 2)} (${rounded(pctDelta, 1)}% vs prior half).`,
  };
}

// ── Window slicing ──────────────────────────────────────────────────────────

interface SlicedWindow {
  reports: BatchQualityReport[];
  earlier: BatchQualityReport[];
  later: BatchQualityReport[];
  startMs: number;
  midMs: number;
  endMs: number;
}

function sliceWindow(reports: BatchQualityReport[], window: TrendWindow, nowMs: number): SlicedWindow {
  const endMs = nowMs;
  const startMs = nowMs - WINDOW_MS[window];
  const midMs = startMs + (endMs - startMs) / 2;
  const inWindow: Array<{ report: BatchQualityReport; t: number }> = [];
  for (const r of reports) {
    const t = Date.parse(r.runAt);
    if (!Number.isFinite(t)) continue;
    if (t >= startMs && t <= endMs) inWindow.push({ report: r, t });
  }
  const earlier = inWindow.filter((x) => x.t < midMs).map((x) => x.report);
  const later = inWindow.filter((x) => x.t >= midMs).map((x) => x.report);
  const allInWindow = inWindow.map((x) => x.report);
  return { reports: allInWindow, earlier, later, startMs, midMs, endMs };
}

// ── Provider aggregation ────────────────────────────────────────────────────

interface ProviderHalfStats {
  reportCount: number;
  cellsScored: number;
  unavailableCells: number;
  weakCells: number;
  meanTempErrorF: Array<number | null>;       // one per report (the value the report itself computed)
  fieldMeans: Record<QualityField, Array<number | null>>;
  horizonMeans: Record<QualityHorizon, Array<number | null>>;
}

function emptyHalfStats(): ProviderHalfStats {
  const fieldMeans = {} as Record<QualityField, Array<number | null>>;
  for (const f of FIELDS) fieldMeans[f] = [];
  const horizonMeans = {} as Record<QualityHorizon, Array<number | null>>;
  for (const h of HORIZONS) horizonMeans[h] = [];
  return {
    reportCount: 0,
    cellsScored: 0,
    unavailableCells: 0,
    weakCells: 0,
    meanTempErrorF: [],
    fieldMeans,
    horizonMeans,
  };
}

function ingestReport(half: ProviderHalfStats, agg: ProviderAggregateScore): void {
  half.reportCount += 1;
  // cellsScored from our type already excludes nothing — but `summary.unavailable`
  // is included in the .summary buckets, so we treat scored = good + accept + weak.
  const scored = agg.summary.good + agg.summary.acceptable + agg.summary.weak;
  half.cellsScored += scored;
  half.unavailableCells += agg.summary.unavailable;
  half.weakCells += agg.summary.weak;
  half.meanTempErrorF.push(agg.meanTempErrorF ?? null);
  for (const f of FIELDS) half.fieldMeans[f].push(agg.perField[f]?.meanAbsError ?? null);
  for (const h of HORIZONS) half.horizonMeans[h].push(agg.perHorizon[h]?.meanAbsError ?? null);
}

function summarizeHalf(half: ProviderHalfStats) {
  const meanTempErrorF = avgOrNull(half.meanTempErrorF);
  const totalDenominator = half.cellsScored + half.unavailableCells;
  const weakRatePct = half.cellsScored > 0 ? (half.weakCells / half.cellsScored) * 100 : null;
  const unavailableRatePct = totalDenominator > 0 ? (half.unavailableCells / totalDenominator) * 100 : null;
  return { meanTempErrorF, weakRatePct, unavailableRatePct };
}

function combineProviderTrend(
  provider: string,
  label: string,
  earlier: ProviderHalfStats,
  later: ProviderHalfStats,
): ProviderTrendSummary {
  const earlierSummary = summarizeHalf(earlier);
  const laterSummary = summarizeHalf(later);

  const reportCount = earlier.reportCount + later.reportCount;
  const totalCells = earlier.cellsScored + later.cellsScored;
  const totalUnavailable = earlier.unavailableCells + later.unavailableCells;
  const totalWeak = earlier.weakCells + later.weakCells;
  const weakRatePct = totalCells > 0 ? (totalWeak / totalCells) * 100 : 0;
  const unavailableRatePct =
    (totalCells + totalUnavailable) > 0
      ? (totalUnavailable / (totalCells + totalUnavailable)) * 100
      : 0;

  const meanTempErrorTrend: AxisTrend = {
    current: rounded(laterSummary.meanTempErrorF, 1),
    prior: rounded(earlierSummary.meanTempErrorF, 1),
    ...classifyTrend(earlierSummary.meanTempErrorF, laterSummary.meanTempErrorF, {
      lowerIsBetter: true,
      floor: STABLE_FLOOR_TEMP_F,
    }),
  };
  const weakRateTrend: AxisTrend = {
    current: rounded(laterSummary.weakRatePct, 1),
    prior: rounded(earlierSummary.weakRatePct, 1),
    ...classifyTrend(earlierSummary.weakRatePct, laterSummary.weakRatePct, {
      lowerIsBetter: true,
      floor: STABLE_FLOOR_PCT,
    }),
  };
  const unavailableRateTrend: AxisTrend = {
    current: rounded(laterSummary.unavailableRatePct, 1),
    prior: rounded(earlierSummary.unavailableRatePct, 1),
    ...classifyTrend(earlierSummary.unavailableRatePct, laterSummary.unavailableRatePct, {
      lowerIsBetter: true,
      floor: STABLE_FLOOR_PCT,
    }),
  };

  const perField = {} as Record<QualityField, AxisTrend>;
  for (const f of FIELDS) {
    const eVal = avgOrNull(earlier.fieldMeans[f]);
    const lVal = avgOrNull(later.fieldMeans[f]);
    perField[f] = {
      current: rounded(lVal, 1),
      prior: rounded(eVal, 1),
      ...classifyTrend(eVal, lVal, { lowerIsBetter: true, floor: STABLE_FLOOR_TEMP_F }),
    };
  }
  const perHorizon = {} as Record<QualityHorizon, AxisTrend>;
  for (const h of HORIZONS) {
    const eVal = avgOrNull(earlier.horizonMeans[h]);
    const lVal = avgOrNull(later.horizonMeans[h]);
    perHorizon[h] = {
      current: rounded(lVal, 1),
      prior: rounded(eVal, 1),
      ...classifyTrend(eVal, lVal, { lowerIsBetter: true, floor: STABLE_FLOOR_TEMP_F }),
    };
  }

  return {
    provider,
    label,
    reportCount,
    totalCells,
    totalUnavailable,
    weakRatePct: rounded(weakRatePct, 1) ?? 0,
    unavailableRatePct: rounded(unavailableRatePct, 1) ?? 0,
    meanTempErrorTrend,
    weakRateTrend,
    unavailableRateTrend,
    perField,
    perHorizon,
  };
}

// ── City outliers ───────────────────────────────────────────────────────────

function computeCityOutliers(reports: BatchQualityReport[]): CityOutlier[] {
  const byCity = new Map<string, { label: string; appear: number; fail: number }>();
  for (const r of reports) {
    for (const row of r.rows) {
      const e = byCity.get(row.cityId) ?? { label: row.cityLabel, appear: 0, fail: 0 };
      e.appear += 1;
      if (!row.ok) e.fail += 1;
      // Always prefer the latest non-empty label.
      if (row.cityLabel) e.label = row.cityLabel;
      byCity.set(row.cityId, e);
    }
  }
  const out: CityOutlier[] = [];
  for (const [cityId, v] of byCity) {
    if (v.appear === 0 || v.fail === 0) continue;
    out.push({
      cityId,
      cityLabel: v.label,
      failureCount: v.fail,
      appearanceCount: v.appear,
      failureRatePct: rounded((v.fail / v.appear) * 100, 1) ?? 0,
    });
  }
  out.sort((a, b) => b.failureRatePct - a.failureRatePct);
  return out.slice(0, 5);
}

// ── Insight generator ───────────────────────────────────────────────────────

function buildInsights(
  providers: ProviderTrendSummary[],
  cityOutliers: CityOutlier[],
  reportCount: number,
  window: TrendWindow,
): TrendInsight[] {
  const insights: TrendInsight[] = [];
  if (reportCount === 0) {
    insights.push({
      severity: 'notice',
      text: `No quality reports landed in the last ${window} window. Cron may not have fired yet, or the report store is empty.`,
    });
    return insights;
  }

  for (const p of providers) {
    if (p.reportCount === 0) {
      insights.push({
        severity: 'notice',
        text: `Insufficient ${p.label} data over the last ${window} (no reports included this provider).`,
      });
      continue;
    }
    if (p.reportCount < 3) {
      insights.push({
        severity: 'notice',
        text: `${p.label} has only ${p.reportCount} report(s) in the last ${window}; trend signal is weak.`,
      });
    }

    if (p.meanTempErrorTrend.direction === 'stable' && p.meanTempErrorTrend.current !== null) {
      insights.push({
        severity: 'info',
        text: `${p.label} temperature accuracy held steady at about ${p.meanTempErrorTrend.current}°F mean |error| over the last ${window}.`,
      });
    }
    if (p.meanTempErrorTrend.direction === 'improving') {
      insights.push({
        severity: 'info',
        text: `${p.label} temperature accuracy improved (${p.meanTempErrorTrend.prior}°F → ${p.meanTempErrorTrend.current}°F) over the last ${window}.`,
      });
    }
    if (p.meanTempErrorTrend.direction === 'degrading') {
      insights.push({
        severity: 'warning',
        text: `${p.label} temperature error grew (${p.meanTempErrorTrend.prior}°F → ${p.meanTempErrorTrend.current}°F) over the last ${window}.`,
      });
    }

    for (const h of HORIZONS) {
      const ht = p.perHorizon[h];
      if (ht.direction === 'degrading' && ht.current !== null && ht.prior !== null) {
        insights.push({
          severity: 'warning',
          text: `${p.label} ${h.toUpperCase()} forecast quality weakened (${ht.prior} → ${ht.current}) over the last ${window}.`,
        });
      }
    }

    if (p.weakRateTrend.direction === 'degrading') {
      insights.push({
        severity: 'warning',
        text: `${p.label} weak-bucket rate climbed (${p.weakRateTrend.prior}% → ${p.weakRateTrend.current}%) over the last ${window}.`,
      });
    }
    if (p.unavailableRateTrend.direction === 'degrading') {
      insights.push({
        severity: 'warning',
        text: `${p.label} unavailable-cell rate climbed (${p.unavailableRateTrend.prior}% → ${p.unavailableRateTrend.current}%) — possible upstream/observation reliability issue.`,
      });
    }
  }

  if (cityOutliers.length > 0) {
    const top = cityOutliers[0];
    if (top.failureRatePct >= 20 && top.appearanceCount >= 3) {
      insights.push({
        severity: 'warning',
        text: `${top.cityLabel} failed scoring in ${top.failureCount} of ${top.appearanceCount} reports (${top.failureRatePct}%) — investigate observation availability or upstream provider error for this location.`,
      });
    }
  }

  return insights.slice(0, 10);
}

// ── Public entry point ──────────────────────────────────────────────────────

export interface BuildTrendDashboardOptions {
  window: TrendWindow;
  /** Override "now" for tests. */
  nowMs?: number;
  /** Optional provider filter; when set, only that provider's trend is built. */
  provider?: string;
}

export function buildQualityTrendDashboard(
  reports: BatchQualityReport[],
  options: BuildTrendDashboardOptions,
): QualityTrendDashboard {
  const nowMs = options.nowMs ?? Date.now();
  const sliced = sliceWindow(reports, options.window, nowMs);

  // Collect all distinct providers across the window.
  const providerLabels = new Map<string, string>();
  for (const r of sliced.reports) {
    for (const a of r.providerAggregates) {
      if (options.provider && a.provider !== options.provider) continue;
      providerLabels.set(a.provider, a.label);
    }
  }

  const providers: ProviderTrendSummary[] = [];
  for (const [provider, label] of providerLabels) {
    const earlier = emptyHalfStats();
    const later = emptyHalfStats();
    for (const r of sliced.earlier) {
      const a = r.providerAggregates.find((x) => x.provider === provider);
      if (a) ingestReport(earlier, a);
    }
    for (const r of sliced.later) {
      const a = r.providerAggregates.find((x) => x.provider === provider);
      if (a) ingestReport(later, a);
    }
    providers.push(combineProviderTrend(provider, label, earlier, later));
  }

  // Sort providers by report count desc so the busiest provider leads.
  providers.sort((a, b) => b.reportCount - a.reportCount);

  const cityOutliers = computeCityOutliers(sliced.reports);
  const insights = buildInsights(providers, cityOutliers, sliced.reports.length, options.window);

  const warnings: string[] = [];
  if (sliced.reports.length < 2) {
    warnings.push(
      'Trend signal needs at least two reports in the window to compute a direction. Run more cron cycles or expand the window.',
    );
  }

  return {
    window: options.window,
    windowStartIso: new Date(sliced.startMs).toISOString(),
    windowEndIso: new Date(sliced.endMs).toISOString(),
    reportCount: sliced.reports.length,
    providers,
    cityOutliers,
    insights,
    warnings,
  };
}

export function isValidTrendWindow(s: string): s is TrendWindow {
  return s === '24h' || s === '7d' || s === '30d';
}

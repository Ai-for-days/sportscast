import { isKillSwitchActive } from './execution-config';

/* ------------------------------------------------------------------ */
/*  Hard Limits — all values in cents unless noted                     */
/* ------------------------------------------------------------------ */

export const HARD_LIMITS = {
  MAX_ORDER_SIZE_CENTS: 10_000,         // $100 per order
  MAX_DAILY_NOTIONAL_CENTS: 50_000,     // $500/day
  MAX_EXPOSURE_PER_CITY_CENTS: 20_000,  // $200/city
  MAX_EXPOSURE_PER_DATE_CENTS: 30_000,  // $300/date
  MAX_EXPOSURE_PER_METRIC_CENTS: 25_000,// $250/metric
  MAX_EXPOSURE_PER_SOURCE_CENTS: 50_000,// $500/source
  MAX_PORTFOLIO_EXPOSURE_CENTS: 100_000,// $1,000 total
  MAX_CONCURRENT_OPEN_TRADES: 25,
  MAX_LOSS_THRESHOLD_CENTS: -25_000,    // -$250 stop-loss
  MIN_EDGE_THRESHOLD: 0.02,            // 2% minimum edge
  MAX_SPREAD_THRESHOLD: 0.15,          // 15% max spread
};

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface RiskCheck {
  name: string;
  passed: boolean;
  message: string;
}

export interface PreTradeRiskResult {
  allowed: boolean;
  checks: RiskCheck[];
  reason?: string;
}

export interface PreTradeInput {
  orderSizeCents: number;
  edge: number;
  spread?: number;
  cityExposureCents?: number;
  dateExposureCents?: number;
  metricExposureCents?: number;
  sourceExposureCents?: number;
  portfolioExposureCents?: number;
  dailyNotionalCents?: number;
  openTradeCount?: number;
  unrealizedPnlCents?: number;
}

/* ------------------------------------------------------------------ */
/*  Risk Check Engine                                                  */
/* ------------------------------------------------------------------ */

export async function runPreTradeRiskChecks(input: PreTradeInput): Promise<PreTradeRiskResult> {
  const checks: RiskCheck[] = [];

  // Kill switch
  const killActive = await isKillSwitchActive();
  checks.push({
    name: 'kill_switch',
    passed: !killActive,
    message: killActive ? 'Kill switch is active — all execution blocked' : 'Kill switch off',
  });

  // Max order size
  checks.push({
    name: 'max_order_size',
    passed: input.orderSizeCents <= HARD_LIMITS.MAX_ORDER_SIZE_CENTS,
    message: input.orderSizeCents <= HARD_LIMITS.MAX_ORDER_SIZE_CENTS
      ? `Order $${(input.orderSizeCents / 100).toFixed(2)} within $${(HARD_LIMITS.MAX_ORDER_SIZE_CENTS / 100).toFixed(0)} limit`
      : `Order $${(input.orderSizeCents / 100).toFixed(2)} exceeds $${(HARD_LIMITS.MAX_ORDER_SIZE_CENTS / 100).toFixed(0)} limit`,
  });

  // Min edge
  checks.push({
    name: 'min_edge',
    passed: Math.abs(input.edge) >= HARD_LIMITS.MIN_EDGE_THRESHOLD,
    message: Math.abs(input.edge) >= HARD_LIMITS.MIN_EDGE_THRESHOLD
      ? `Edge ${(Math.abs(input.edge) * 100).toFixed(1)}% meets ${(HARD_LIMITS.MIN_EDGE_THRESHOLD * 100).toFixed(0)}% minimum`
      : `Edge ${(Math.abs(input.edge) * 100).toFixed(1)}% below ${(HARD_LIMITS.MIN_EDGE_THRESHOLD * 100).toFixed(0)}% minimum`,
  });

  // Max spread
  if (input.spread != null) {
    checks.push({
      name: 'max_spread',
      passed: input.spread <= HARD_LIMITS.MAX_SPREAD_THRESHOLD,
      message: input.spread <= HARD_LIMITS.MAX_SPREAD_THRESHOLD
        ? `Spread ${(input.spread * 100).toFixed(1)}% within limit`
        : `Spread ${(input.spread * 100).toFixed(1)}% exceeds ${(HARD_LIMITS.MAX_SPREAD_THRESHOLD * 100).toFixed(0)}% limit`,
    });
  }

  // City exposure
  if (input.cityExposureCents != null) {
    const newExp = input.cityExposureCents + input.orderSizeCents;
    checks.push({
      name: 'max_city_exposure',
      passed: newExp <= HARD_LIMITS.MAX_EXPOSURE_PER_CITY_CENTS,
      message: newExp <= HARD_LIMITS.MAX_EXPOSURE_PER_CITY_CENTS
        ? `City exposure $${(newExp / 100).toFixed(2)} within $${(HARD_LIMITS.MAX_EXPOSURE_PER_CITY_CENTS / 100).toFixed(0)} limit`
        : `City exposure $${(newExp / 100).toFixed(2)} exceeds $${(HARD_LIMITS.MAX_EXPOSURE_PER_CITY_CENTS / 100).toFixed(0)} limit`,
    });
  }

  // Date exposure
  if (input.dateExposureCents != null) {
    const newExp = input.dateExposureCents + input.orderSizeCents;
    checks.push({
      name: 'max_date_exposure',
      passed: newExp <= HARD_LIMITS.MAX_EXPOSURE_PER_DATE_CENTS,
      message: newExp <= HARD_LIMITS.MAX_EXPOSURE_PER_DATE_CENTS
        ? `Date exposure $${(newExp / 100).toFixed(2)} within limit`
        : `Date exposure $${(newExp / 100).toFixed(2)} exceeds $${(HARD_LIMITS.MAX_EXPOSURE_PER_DATE_CENTS / 100).toFixed(0)} limit`,
    });
  }

  // Metric exposure
  if (input.metricExposureCents != null) {
    const newExp = input.metricExposureCents + input.orderSizeCents;
    checks.push({
      name: 'max_metric_exposure',
      passed: newExp <= HARD_LIMITS.MAX_EXPOSURE_PER_METRIC_CENTS,
      message: newExp <= HARD_LIMITS.MAX_EXPOSURE_PER_METRIC_CENTS
        ? `Metric exposure within limit`
        : `Metric exposure exceeds $${(HARD_LIMITS.MAX_EXPOSURE_PER_METRIC_CENTS / 100).toFixed(0)} limit`,
    });
  }

  // Source exposure
  if (input.sourceExposureCents != null) {
    const newExp = input.sourceExposureCents + input.orderSizeCents;
    checks.push({
      name: 'max_source_exposure',
      passed: newExp <= HARD_LIMITS.MAX_EXPOSURE_PER_SOURCE_CENTS,
      message: newExp <= HARD_LIMITS.MAX_EXPOSURE_PER_SOURCE_CENTS
        ? `Source exposure within limit`
        : `Source exposure exceeds $${(HARD_LIMITS.MAX_EXPOSURE_PER_SOURCE_CENTS / 100).toFixed(0)} limit`,
    });
  }

  // Portfolio exposure
  if (input.portfolioExposureCents != null) {
    const newExp = input.portfolioExposureCents + input.orderSizeCents;
    checks.push({
      name: 'max_portfolio_exposure',
      passed: newExp <= HARD_LIMITS.MAX_PORTFOLIO_EXPOSURE_CENTS,
      message: newExp <= HARD_LIMITS.MAX_PORTFOLIO_EXPOSURE_CENTS
        ? `Portfolio exposure within limit`
        : `Portfolio exposure exceeds $${(HARD_LIMITS.MAX_PORTFOLIO_EXPOSURE_CENTS / 100).toFixed(0)} limit`,
    });
  }

  // Daily notional
  if (input.dailyNotionalCents != null) {
    const newNotional = input.dailyNotionalCents + input.orderSizeCents;
    checks.push({
      name: 'max_daily_notional',
      passed: newNotional <= HARD_LIMITS.MAX_DAILY_NOTIONAL_CENTS,
      message: newNotional <= HARD_LIMITS.MAX_DAILY_NOTIONAL_CENTS
        ? `Daily notional within $${(HARD_LIMITS.MAX_DAILY_NOTIONAL_CENTS / 100).toFixed(0)} limit`
        : `Daily notional exceeds $${(HARD_LIMITS.MAX_DAILY_NOTIONAL_CENTS / 100).toFixed(0)} limit`,
    });
  }

  // Open trades
  if (input.openTradeCount != null) {
    checks.push({
      name: 'max_concurrent_open',
      passed: input.openTradeCount < HARD_LIMITS.MAX_CONCURRENT_OPEN_TRADES,
      message: input.openTradeCount < HARD_LIMITS.MAX_CONCURRENT_OPEN_TRADES
        ? `${input.openTradeCount} open trades within ${HARD_LIMITS.MAX_CONCURRENT_OPEN_TRADES} limit`
        : `${input.openTradeCount} open trades at/exceeds ${HARD_LIMITS.MAX_CONCURRENT_OPEN_TRADES} limit`,
    });
  }

  // Loss threshold
  if (input.unrealizedPnlCents != null) {
    checks.push({
      name: 'max_loss_threshold',
      passed: input.unrealizedPnlCents > HARD_LIMITS.MAX_LOSS_THRESHOLD_CENTS,
      message: input.unrealizedPnlCents > HARD_LIMITS.MAX_LOSS_THRESHOLD_CENTS
        ? `Unrealized P&L within loss threshold`
        : `Unrealized P&L $${(input.unrealizedPnlCents / 100).toFixed(2)} exceeds -$${(Math.abs(HARD_LIMITS.MAX_LOSS_THRESHOLD_CENTS) / 100).toFixed(0)} stop-loss`,
    });
  }

  const failed = checks.filter(c => !c.passed);
  return {
    allowed: failed.length === 0,
    checks,
    reason: failed.length > 0 ? failed.map(f => f.name).join(', ') : undefined,
  };
}

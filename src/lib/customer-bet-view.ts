// ── Step 121 Part A / Step 122 Part C: Customer-safe bet view ───────────────
//
// **SafeCustomerBetView is the canonical customer-facing bet object.** It is
// the only bet shape that may cross the customer trust boundary — i.e., be
// returned from a `requireUser`-gated API, embedded in a server-rendered
// customer page, or consumed by a React component under `src/components/
// public/`, `src/components/player/`, or `src/components/account/`.
//
// Contract:
//   - Public/customer bet endpoints must never spread a raw EnrichedBet
//     (which carries a raw Wager). Run every response through
//     serializeCustomerBet(s) before JSON.stringify.
//   - The embedded `publicWagerView` field, when present, is a
//     PublicWagerView already cleaned by serializePublicWager.
//   - Raw Wager objects must NEVER enter customer UI directly. Customer
//     code should consume SafeCustomerBetView.publicWagerView instead.
//
// See docs/public-api-safety-audit.md for the full trust-boundary model.

import {
  toPublicWagerView,
  serializePublicWager,
  type PublicWagerView,
} from './public-wager-view';
import type { Bet, BetStatus, EnrichedBet } from './bet-types';

export type CustomerBetStatus = BetStatus;

export interface SafeCustomerBetView {
  id: string;
  ticketNumber?: string;
  wagerId: string;
  wagerTitle: string;
  /** Status of the underlying wager (open / locked / graded / void). */
  wagerStatus: 'open' | 'locked' | 'graded' | 'void';
  /** The outcome the user picked (raw stored label, e.g., "over"). */
  outcomeLabel: string;
  /** American odds at time of bet. */
  odds: number;
  stakeCents: number;
  potentialPayoutCents: number;
  placedAt: string;
  settledAt?: string;
  /** Bet status (pending/won/lost/push/void). */
  status: CustomerBetStatus;
  /** Public-safe view of the underlying wager, when available. */
  publicWagerView?: PublicWagerView;
  /** Wager's winning outcome label, if graded. Echoed for convenience. */
  resolvedOutcome?: string;
  /** A short, customer-facing result line (e.g., "You won $25.00"). */
  userVisibleResult?: string;
}

const PLACEHOLDER_STATUS: 'open' | 'locked' | 'graded' | 'void' = 'open';

function dollars(cents: number): string {
  return (Math.abs(cents) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function describeResult(bet: Bet): string {
  const profit = bet.potentialPayoutCents - bet.amountCents;
  switch (bet.status) {
    case 'won':
      return `Won — return $${dollars(bet.potentialPayoutCents)} (profit $${dollars(profit)})`;
    case 'lost':
      return `Lost — stake $${dollars(bet.amountCents)} not returned`;
    case 'push':
      return 'Push — stake returned';
    case 'void':
      return 'Cancelled — stake returned';
    case 'pending':
    default:
      return 'Pending';
  }
}

// Lightweight runtime guard: throws if a caller hands us an object that
// looks like a raw Wager (which carries admin-only fields). Cheap defence
// against accidental refactors that pass the wrong shape.
const ADMIN_WAGER_FIELDS = [
  'voidReason',
  'pricingSnapshot',
  'lineHistory',
  'openingLineSnapshot',
  'closingLineSnapshot',
  'internalName',
] as const;

export function assertNoAdminFields(o: Record<string, unknown> | null | undefined): void {
  if (!o) return;
  for (const f of ADMIN_WAGER_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(o, f)) {
      throw new Error(
        `customer-bet-view: refusing to serialize an object that contains admin-only field "${f}". ` +
          `Use toPublicWagerView() to sanitize the wager before passing it to the customer surface.`,
      );
    }
  }
}

/**
 * Build a customer-safe view from a Bet plus an optional already-built
 * PublicWagerView. Use this when you've sanitized the wager separately.
 */
export function buildCustomerBetView(
  bet: Bet,
  publicWagerView?: PublicWagerView,
): SafeCustomerBetView {
  assertNoAdminFields(publicWagerView as Record<string, unknown> | undefined);
  return {
    id: bet.id,
    ticketNumber: bet.ticketNumber,
    wagerId: bet.wagerId,
    wagerTitle: publicWagerView?.title ?? '',
    wagerStatus: publicWagerView?.status ?? PLACEHOLDER_STATUS,
    outcomeLabel: bet.outcomeLabel,
    odds: bet.odds,
    stakeCents: bet.amountCents,
    potentialPayoutCents: bet.potentialPayoutCents,
    placedAt: bet.createdAt,
    settledAt: bet.settledAt,
    status: bet.status,
    publicWagerView: publicWagerView ? serializePublicWager(publicWagerView) : undefined,
    resolvedOutcome: publicWagerView?.winningOutcome,
    userVisibleResult: describeResult(bet),
  };
}

/**
 * Convert an EnrichedBet (which carries a raw Wager) into a customer-safe
 * view. The raw Wager is replaced by a PublicWagerView via toPublicWagerView.
 * Never spread the input — every field is picked by name.
 */
export function serializeCustomerBet(enriched: EnrichedBet): SafeCustomerBetView {
  const view = enriched.wager ? toPublicWagerView(enriched.wager) : undefined;
  return buildCustomerBetView(enriched, view);
}

export function serializeCustomerBets(enriched: EnrichedBet[]): SafeCustomerBetView[] {
  return enriched.map(serializeCustomerBet);
}

// ── Step 121 Part A: client-side adapter for legacy bet consumers ───────────
//
// PlayerDashboard and BetHistory were originally written against EnrichedBet
// (with a raw Wager). Now that the API is sanitized, those components can
// pipe their fetch responses through this adapter to keep their existing
// helpers working without code changes. The adapter does NOT recover any
// admin-only field — it only re-shapes public-safe data so reads like
// `wager.location.name`, `(ou).line`, `(ow).outcomes[i].minValue`, and
// `(ps).locationA.name` resolve as expected.

export function adaptSafeBetToLegacyEnriched(
  safe: SafeCustomerBetView,
): {
  id: string;
  ticketNumber?: string;
  wagerId: string;
  outcomeLabel: string;
  odds: number;
  amountCents: number;
  potentialPayoutCents: number;
  status: CustomerBetStatus;
  createdAt: string;
  settledAt?: string;
  wager?: any;
} {
  const pwv = safe.publicWagerView;
  let wager: any;
  if (pwv) {
    wager = {
      id: '',
      ticketNumber: pwv.ticketNumber,
      title: pwv.title,
      description: pwv.description,
      kind: pwv.kind,
      status: pwv.status,
      metric: pwv.metric,
      targetDate: pwv.targetDate,
      targetTime: pwv.targetTime,
      lockTime: pwv.lockTime,
      observedValue: pwv.observedValue,
      observedValueA: pwv.observedValueA,
      observedValueB: pwv.observedValueB,
      winningOutcome: pwv.winningOutcome,
    };
    if (pwv.locationName) wager.location = { name: pwv.locationName };
    if (pwv.locationAName) wager.locationA = { name: pwv.locationAName };
    if (pwv.locationBName) wager.locationB = { name: pwv.locationBName };
    if (pwv.kind === 'odds' && Array.isArray(pwv.outcomeRanges)) {
      wager.outcomes = pwv.outcomeRanges.map((r, i) => ({
        label: r.label,
        minValue: r.minValue,
        maxValue: r.maxValue,
        odds: pwv.outcomes[i]?.displayedOdds ?? 0,
      }));
    }
    if (pwv.kind === 'over-under') {
      wager.line = pwv.line;
      wager.over = { odds: pwv.outcomes[0]?.displayedOdds ?? 0 };
      wager.under = { odds: pwv.outcomes[1]?.displayedOdds ?? 0 };
    }
    if (pwv.kind === 'pointspread') {
      wager.spread = pwv.spread;
      wager.locationAOdds = pwv.outcomes[0]?.displayedOdds ?? 0;
      wager.locationBOdds = pwv.outcomes[1]?.displayedOdds ?? 0;
    }
  }
  return {
    id: safe.id,
    ticketNumber: safe.ticketNumber,
    wagerId: safe.wagerId,
    outcomeLabel: safe.outcomeLabel,
    odds: safe.odds,
    amountCents: safe.stakeCents,
    potentialPayoutCents: safe.potentialPayoutCents,
    status: safe.status,
    createdAt: safe.placedAt,
    settledAt: safe.settledAt,
    wager,
  };
}

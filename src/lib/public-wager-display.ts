// ── Shared public wager display helpers ─────────────────────────────────────
//
// Reported live (2026-08-24): the /wagers cards (WagerCard.tsx) and the
// individual market detail page (WagerDetailPage.tsx) both showed each
// outcome as just a label + a big odds number — "Over" / "+132" — with no
// actual temperature/line/spread anywhere on the tile. Over/under's line and
// pointspread's per-side spread live on the wager as a whole (not per
// outcome), so this derives the number each outcome tile needs to show.
// Extracted once here so both components can't drift apart on the format,
// and so it's testable without rendering React.

import type { PublicWagerView } from './public-wager-view';

/**
 * The temperature/spread number an outcome tile should show alongside its
 * label and odds — e.g. "92°F" for an over/under's "Over"/"Under", or
 * "-34.5°F" for a pointspread side. `index` follows the same [A, B]
 * ordering toPublicWagerView uses for pointspread outcomes (0 = locationA,
 * 1 = locationB). Range-odds ("odds" kind) outcomes already embed their
 * range in the label (e.g. "60-62°F") and need nothing added — returns null.
 */
export function outcomeTarget(wager: PublicWagerView, index: number): string | null {
  const unit = wager.unit ?? '';
  if (wager.kind === 'over-under' && typeof wager.line === 'number') {
    return `${wager.line}${unit}`;
  }
  if (wager.kind === 'pointspread' && typeof wager.spread === 'number') {
    const val = index === 0 ? wager.spread : -wager.spread;
    return `${val > 0 ? '+' : ''}${val}${unit}`;
  }
  return null;
}

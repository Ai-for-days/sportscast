import type { Wager, WagerLocation } from './wager-types';
import { findVenueByCoords } from './venue-data';

export function cleanWagerTitle(title: string): string {
  return title.replace(/\bSpreLad\b/g, 'Spread');
}

/**
 * Per Derek (2026-08-25): "it needs to be venue vs. venue not town vs.
 * town" — reported live against a market titled "Arlington, TX High vs
 * Chicago, IL Low — Wager on Weather" that's really at Globe Life Field vs.
 * Rate Field. A wager's `title` is a plain string generated once at
 * creation (WagerFormModal.tsx's generateAutoTitle, auto-hvl-market.ts) and
 * never regenerated afterward, so a title baked with a city/state name
 * before the venue-naming convention (2026-08-24, auto-hvl-market.ts) stays
 * that way forever — the engine only ever re-prices `spread` on an existing
 * wager, never its title, and a locked/graded wager isn't touched at all.
 *
 * Rather than mutate stored records, this patches the DISPLAYED title: if a
 * location's exact stored name appears literally in the title, and a
 * tracked venue exists at that location's coordinates, swap in the venue's
 * own name. A manually-typed title that doesn't happen to contain the
 * stored location name is left untouched — this is a substitution, not a
 * rewrite, and self-heals every existing wager without a data migration.
 */
export function venueifyWagerTitle(title: string, wager: Wager): string {
  const locs: WagerLocation[] = [];
  if (wager.kind === 'pointspread') {
    if (wager.locationA) locs.push(wager.locationA);
    if (wager.locationB) locs.push(wager.locationB);
  } else if (wager.kind === 'over-under' || wager.kind === 'odds') {
    if (wager.location) locs.push(wager.location);
  }

  let out = title;
  // Longest name first so a shorter name can't partially clobber a longer one's replacement.
  for (const loc of [...locs].sort((a, b) => b.name.length - a.name.length)) {
    if (!loc.name || !out.includes(loc.name)) continue;
    const venue = findVenueByCoords(loc.lat, loc.lon);
    if (venue && venue.name !== loc.name) {
      out = out.split(loc.name).join(venue.name);
    }
  }
  return out;
}

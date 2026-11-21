import type { Wager, WagerLocation } from './wager-types';
import { findVenueByCoords, resolveVenueDisplayName, withCollegeSchool } from './venue-data';

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
    // A stored label that is already a tracked venue is the market's own
    // venue and must not be swapped for a neighbour that happens to be
    // within the coordinate tolerance. See resolveVenueDisplayName.
    const resolved = resolveVenueDisplayName(loc);
    if (resolved === loc.name) continue;
    const venue = findVenueByCoords(loc.lat, loc.lon);
    if (venue && venue.name !== loc.name) {
      out = out.split(loc.name).join(venue.name);
    }
  }
  return withCollegeSchools(out, locs);
}

/**
 * DBD 2026-11-21: college stadiums show their school, "Amon G. Carter
 * Stadium (TCU)". Applied after the venue swap above, to each location's
 * display name that appears in the title.
 */
function withCollegeSchools(title: string, locs: WagerLocation[]): string {
  return tagCollegeStadiums(title, locs.map((l) => resolveVenueDisplayName(l)));
}

/**
 * Add the school after each of `names` found in `text`. Matches are taken
 * longest first and never overlap, so "Memorial Stadium" (Nebraska) cannot
 * also tag the inside of "Kenan Memorial Stadium". A name already followed
 * by its tag is left alone, so this is safe to apply twice.
 */
export function tagCollegeStadiums(text: string, names: (string | undefined | null)[]): string {
  if (!text) return text;
  const uniq = [...new Set(names.filter((n): n is string => !!n))].sort((a, b) => b.length - a.length);
  const hits: { start: number; end: number; tagged: string }[] = [];
  for (const name of uniq) {
    const tagged = withCollegeSchool(name);
    if (tagged === name) continue;
    for (let i = text.indexOf(name); i >= 0; i = text.indexOf(name, i + 1)) {
      const end = i + name.length;
      if (hits.some((h) => i < h.end && end > h.start)) continue;
      if (text.startsWith(tagged, i)) { hits.push({ start: i, end: i + tagged.length, tagged }); continue; }
      hits.push({ start: i, end, tagged });
    }
  }
  hits.sort((a, b) => b.start - a.start);
  let out = text;
  for (const h of hits) out = out.slice(0, h.start) + h.tagged + out.slice(h.end);
  return out;
}

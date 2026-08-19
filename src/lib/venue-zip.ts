// Shared "which ZIP forecast page does this venue belong to" helper.
// Pulled out of [venue].astro (which already computed this) so venue
// browsing cards can link straight to the ZIP page instead of the
// per-venue detail page, without every venue-data.ts consumer eagerly
// importing the 2.7MB zip dataset that findNearestZip depends on.

import type { Venue } from './types';
import { buildLocationSlug } from './slug-utils';
import { findNearestZipWithin } from './zip-lookup';

/**
 * The canonical ZIP forecast page URL for a venue's coordinates, or null
 * if no US ZIP is genuinely nearby. Uses the radius-guarded lookup (not
 * the raw nearest-of-all-40,970 one) — international/far-flung venues
 * (Toronto Blue Jays, Vancouver Whitecaps, etc.) must resolve to null
 * rather than getting silently pinned to whatever US ZIP happens to be
 * least-far-away, which would be a wrong-location link.
 */
export function getVenueZipUrl(venue: Pick<Venue, 'lat' | 'lon' | 'city' | 'state'>): string | null {
  const nearest = findNearestZipWithin(venue.lat, venue.lon);
  if (!nearest) return null;
  return buildLocationSlug(nearest.zip, venue.city || nearest.city, venue.state || nearest.state, 'us');
}

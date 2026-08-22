// ── Manual retractable-roof override (admin: /admin/system/roof-status) ──
//
// No league has a live roof-status API except MLB (getRoofStatus, via the
// MLB Stats API's live game feed) — confirmed 2026-08-23 that ESPN's soccer
// scoreboard carries no roof/indoor field at all, and there's no equivalent
// for NFL/NCAA football either. For every retractable-roof venue outside
// MLB, the only signal available is a human who saw a team/venue
// announcement — this lets an admin flip that in seconds instead of asking
// for a code change every time.
//
// 'closed' or 'open' here takes priority over everything else (the
// season-long SEASON_CLOSED_ROOF_VENUES list in league-schedule.ts, and
// MLB's own live per-game check) — an explicit human call is always the
// most current information available. Unset (null) defers to that existing
// logic, unchanged.

import { getRedis } from './redis';

export type RoofOverride = 'open' | 'closed';

function overrideKey(venueId: string): string {
  return `roof-override:${venueId}`;
}

export async function getRoofOverride(venueId: string): Promise<RoofOverride | null> {
  try {
    const raw = await getRedis().get(overrideKey(venueId));
    return raw === 'open' || raw === 'closed' ? raw : null;
  } catch {
    return null;
  }
}

/** Batched lookup for a set of venues in one round trip — used by getScheduleGames, which needs this for every retractable venue in play, not just one. */
export async function getRoofOverrides(venueIds: string[]): Promise<Map<string, RoofOverride>> {
  const out = new Map<string, RoofOverride>();
  if (!venueIds.length) return out;
  try {
    const values = await getRedis().mget<(string | null)[]>(...venueIds.map(overrideKey));
    venueIds.forEach((id, i) => {
      const v = values[i];
      if (v === 'open' || v === 'closed') out.set(id, v);
    });
  } catch {
    /* best-effort — an unreadable override just means "defer to existing logic" for every venue this call */
  }
  return out;
}

/** `null` clears the override (back to "defer to existing logic"). */
export async function setRoofOverride(venueId: string, value: RoofOverride | null): Promise<void> {
  try {
    if (value === null) {
      await getRedis().del(overrideKey(venueId));
    } else {
      await getRedis().set(overrideKey(venueId), value);
    }
  } catch {
    /* best-effort */
  }
}

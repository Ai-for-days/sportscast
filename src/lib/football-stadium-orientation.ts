// Field orientation for NFL/NCAA football venues — the long axis (goal line
// to goal line), as a simple rule rather than per-venue survey data like
// MLB's stadium-orientations.json. Per Derek (2026-08-22): "all stadiums
// run east to west except these run north to south: Oklahoma State,
// Georgia, Kentucky, Minnesota, East Carolina." A deliberate simplification —
// real stadiums aren't perfectly grid-aligned, and we don't know which
// specific end zone faces which compass direction for any of them — so the
// wind/glare phrasing below stays in terms of the field's AXIS (lengthwise
// vs. crosswind) plus real compass bearings, never a specific named end zone
// or sideline.

import type { Venue } from './types';
import { windDirectionLabel } from './weather-utils';

export type FieldAxis = 'east-west' | 'north-south';

const NORTH_SOUTH_TEAMS = new Set([
  'Oklahoma State Cowboys',
  'Georgia Bulldogs',
  'Kentucky Wildcats',
  'Minnesota Golden Gophers',
  'East Carolina Pirates',
]);

/** East-west by default; north-south for the small exceptions list above. Only meaningful for NFL/NCAA football venues. */
export function getFootballFieldAxis(venue: Pick<Venue, 'team'>): FieldAxis {
  return venue.team && NORTH_SOUTH_TEAMS.has(venue.team) ? 'north-south' : 'east-west';
}

function circularDiff(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360;
  return raw > 180 ? 360 - raw : raw;
}

/** How closely `deg` aligns with the field's long axis: 0 = perfectly lengthwise, 90 = perfectly crosswise. The axis is a LINE (a stadium has no "positive end"), so its reciprocal bearing counts equally as on-axis. */
function axisAlignment(deg: number, axis: FieldAxis): number {
  const axisBearing = axis === 'east-west' ? 90 : 0;
  return Math.min(circularDiff(deg, axisBearing), circularDiff(deg, (axisBearing + 180) % 360));
}

/**
 * Wind direction relative to the field's long axis (goal line to goal
 * line) vs. its short axis (sideline to sideline). windDirectionDeg is the
 * compass bearing the wind blows FROM, matching the ForecastPoint /
 * windDirectionLabel convention elsewhere in this codebase.
 */
export function footballFieldWindLabel(windDirectionDeg: number, axis: FieldAxis): string {
  const towardDeg = (windDirectionDeg + 180) % 360;
  const alignment = axisAlignment(towardDeg, axis);
  const compass = windDirectionLabel(towardDeg);
  if (alignment <= 22.5) return `blowing lengthwise down the field toward the ${compass}`;
  if (alignment >= 67.5) return `blowing sideline to sideline (${compass} crosswind)`;
  return `blowing diagonally across the field toward the ${compass}`;
}

/**
 * Whether a low sun sits more along the field's length (glare for players
 * looking downfield) or across it (glare along one sideline).
 */
export function footballSunGlareLabel(sunAzimuthDeg: number, axis: FieldAxis): string {
  const alignment = axisAlignment(sunAzimuthDeg, axis);
  if (alignment <= 22.5) return 'low sun down the length of the field may cause glare for players looking downfield';
  if (alignment >= 67.5) return 'low sun off to the side may cause glare along one sideline';
  return 'low sun near the horizon may cause glare';
}

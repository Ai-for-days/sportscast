// Wind direction relative to a stadium's field orientation — the math behind
// the "is the wind blowing out to left/center/right" diagram on venue pages.
//
// A stadium's orientation is the real-world compass bearing from home plate
// through the pitcher's mound to straightaway center field (see
// src/data/stadium-orientations.json). The diagram is drawn with home plate
// at the bottom and center field at the top — the standard "behind home
// plate" view, same as a scorecard diamond — so an arrow pointing straight
// up means "blowing out to center" regardless of which way the stadium
// actually faces in the real world.
//
// windDirectionDeg follows the ForecastPoint / windDirectionLabel convention:
// the compass bearing the wind blows FROM (0 = a north wind). The diagram
// wants the bearing it blows TOWARD, rotated into the diamond's own frame.

export type FieldWindSector =
  | 'center'
  | 'right-center'
  | 'right'
  | 'in-right'
  | 'in-center'
  | 'in-left'
  | 'left'
  | 'left-center';

const SECTOR_LABELS: Record<FieldWindSector, string> = {
  center: 'Blowing out to center',
  'right-center': 'Blowing out to right-center',
  right: 'Blowing toward right field (crosswind)',
  'in-right': 'Blowing in, cutting toward right field',
  'in-center': 'Blowing in from center',
  'in-left': 'Blowing in, cutting toward left field',
  left: 'Blowing toward left field (crosswind)',
  'left-center': 'Blowing out to left-center',
};

/**
 * SVG rotation angle (degrees, clockwise from "up" = center field) for an
 * arrow that points in the direction the wind is blowing TOWARD, relative
 * to this stadium's real-world orientation.
 */
export function windArrowRotationDeg(windDirectionDeg: number, stadiumBearingDeg: number): number {
  const blowingToward = (windDirectionDeg + 180) % 360;
  return (blowingToward - stadiumBearingDeg + 360) % 360;
}

/** Which of 8 field sectors the wind is blowing toward, for the rotation angle above. */
export function fieldWindSector(rotationDeg: number): FieldWindSector {
  const sectors: FieldWindSector[] = ['center', 'right-center', 'right', 'in-right', 'in-center', 'in-left', 'left', 'left-center'];
  const idx = Math.round(rotationDeg / 45) % 8;
  return sectors[idx];
}

/** Short, factual, neutral label for the wind's effect on the field (no betting framing). */
export function fieldWindLabel(windDirectionDeg: number, stadiumBearingDeg: number): string {
  const rotation = windArrowRotationDeg(windDirectionDeg, stadiumBearingDeg);
  return SECTOR_LABELS[fieldWindSector(rotation)];
}

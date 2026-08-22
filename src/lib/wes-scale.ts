// WES (Weather Experience Score) presentation scale — maps a 0-100 score to
// a plain-English label and a color, shared by every place a WES badge
// renders (WeatherHero, DailyForecast, WeatherboardTable) so the label/color
// for a given score is identical everywhere. Per Derek's 21-band scale.
//
// Colors are computed (not hand-picked hex) across a red-to-green hue sweep
// so 21 bands stay visually distinct and consistently ordered worst-to-best,
// with separate light/dark lightness so text stays legible on both a white
// page and the site's navy dark theme (same reasoning as tempColorClass in
// TemperatureChart.tsx).

const BAND_LABELS: readonly { max: number; label: string }[] = [
  { max: 4, label: 'Unplayable' },
  { max: 9, label: 'Brutal' },
  { max: 14, label: 'Dangerous' },
  { max: 19, label: 'Severe' },
  { max: 24, label: 'Miserable' },
  { max: 29, label: 'Harsh' },
  { max: 34, label: 'Rough' },
  { max: 39, label: 'Difficult' },
  { max: 44, label: 'Uncomfortable' },
  { max: 49, label: 'Challenging' },
  { max: 54, label: 'Mixed' },
  { max: 59, label: 'Manageable' },
  { max: 64, label: 'Fair' },
  { max: 69, label: 'Decent' },
  { max: 74, label: 'Pleasant' },
  { max: 79, label: 'Good' },
  { max: 84, label: 'Great' },
  { max: 89, label: 'Excellent' },
  { max: 94, label: 'Ideal' },
  { max: 99, label: 'Outstanding' },
  { max: 100, label: 'Perfect' },
];

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

export interface WesBand {
  label: string;
  /** Hex, tuned for legibility on a white background. */
  light: string;
  /** Hex, tuned for legibility on the site's navy dark background. */
  dark: string;
}

/** Score -> {label, light, dark}. Score is clamped to 0-100 first (a raw WES can round outside that range). */
export function getWesBand(score: number): WesBand {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const idx = BAND_LABELS.findIndex((b) => clamped <= b.max);
  const i = idx === -1 ? BAND_LABELS.length - 1 : idx;
  // 0 = red (worst band), 140 = green (best band) — never reaches blue/purple,
  // which would misread as "cold" rather than "bad weather."
  const hue = (i / (BAND_LABELS.length - 1)) * 140;
  return {
    label: BAND_LABELS[i].label,
    light: hslToHex(hue, 78, 36),
    dark: hslToHex(hue, 85, 62),
  };
}

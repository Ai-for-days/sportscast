// WES (Weather Experience Score) presentation scale — maps a 0-100 score to a
// plain-English label and a color, shared by every place a WES number renders
// (WeatherHero, DailyForecast, both Weatherboard tables, and the admin WES
// Control table) so the label and color for a given score are identical
// everywhere.
//
// Per Derek (2026-08-29) the 21 bands below — their boundaries, labels and hex
// values — are EXACT and hand-picked. Do not re-derive them from a hue sweep
// the way this file used to, and do not give a band a light-theme and a
// dark-theme variant. One band, one color.
//
// That color is a FILL, not a text color, which is why a WES badge is a filled
// chip. As text these hexes are unreadable at both ends of the scale: deep
// maroon #5A0010 on the navy dark theme is 1.14:1, and yellow #C8C72A on a
// white page is 1.80:1 — both far under WCAG AA. As a chip background, with
// the ink picked per band below, the worst band in the scale still reads at
// 4.36:1 in either theme and on any sky gradient, so the hero no longer needs
// the special case it used to carry.
//
//   score    label          color name      hex
//   0-4      Unplayable     Deep Maroon     #5A0010
//   5-9      Brutal         Dark Red        #7A0018
//   10-14    Extreme        Crimson         #9E1024
//   15-19    Severe         Strong Red      #C52233
//   20-24    Miserable      Red-Orange      #E03A2F
//   25-29    Harsh          Burnt Orange    #E95B2B
//   30-34    Rough          Orange          #F47A24
//   35-39    Difficult      Amber Orange    #F59E0B
//   40-44    Uncomfortable  Deep Amber      #EAB308
//   45-49    Challenging    Golden Yellow   #D6B814
//   50-54    Mixed          Yellow          #C8C72A
//   55-59    Manageable     Yellow-Green    #A7C636
//   60-64    Fair           Lime Green      #86C440
//   65-69    Decent         Fresh Green     #63B946
//   70-74    Pleasant       Medium Green    #42A94D
//   75-79    Good           Strong Green    #249A55
//   80-84    Great          Emerald         #06A87C
//   85-89    Excellent      Jade            #02BA89
//   90-94    Ideal          Turquoise       #19CDAC
//   95-99    Outstanding    Aquamarine      #44DFCC
//   100      Perfect        Pale Aqua       #6EF0EB
//
// The top five bands were re-cut on 2026-08-31. As first specified they ran
// #118A5C -> #064E5A: five colors that get DARKER and lose more than half
// their chroma as conditions improve (C 0.145 at "Good" down to 0.066 at
// "Perfect"). Dark and desaturated is exactly where the eye discriminates
// worst, so on a summer MLB board, where nearly every game scores 85+, the
// whole column read as one dark green. Reported as "the new color schemes for
// WES are not being applied" — they were, they were just indistinguishable.
//
// They now hold chroma (0.13 to 0.15) and CLIMB in lightness, walking green to
// aqua, so the best conditions are the brightest thing on the page instead of
// the most muted. Measured in OKLab, an 87 and a 99 sit 0.128 apart where they
// used to be 0.090, and all five read dark ink at better than 5:1. The 0-79
// half of the scale is untouched.

const BAND_DEFS: readonly { min: number; max: number; label: string; hex: string }[] = [
  { min: 0, max: 4, label: 'Unplayable', hex: '#5A0010' },
  { min: 5, max: 9, label: 'Brutal', hex: '#7A0018' },
  { min: 10, max: 14, label: 'Extreme', hex: '#9E1024' },
  { min: 15, max: 19, label: 'Severe', hex: '#C52233' },
  { min: 20, max: 24, label: 'Miserable', hex: '#E03A2F' },
  { min: 25, max: 29, label: 'Harsh', hex: '#E95B2B' },
  { min: 30, max: 34, label: 'Rough', hex: '#F47A24' },
  { min: 35, max: 39, label: 'Difficult', hex: '#F59E0B' },
  { min: 40, max: 44, label: 'Uncomfortable', hex: '#EAB308' },
  { min: 45, max: 49, label: 'Challenging', hex: '#D6B814' },
  { min: 50, max: 54, label: 'Mixed', hex: '#C8C72A' },
  { min: 55, max: 59, label: 'Manageable', hex: '#A7C636' },
  { min: 60, max: 64, label: 'Fair', hex: '#86C440' },
  { min: 65, max: 69, label: 'Decent', hex: '#63B946' },
  { min: 70, max: 74, label: 'Pleasant', hex: '#42A94D' },
  { min: 75, max: 79, label: 'Good', hex: '#249A55' },
  { min: 80, max: 84, label: 'Great', hex: '#06A87C' },
  { min: 85, max: 89, label: 'Excellent', hex: '#02BA89' },
  { min: 90, max: 94, label: 'Ideal', hex: '#19CDAC' },
  { min: 95, max: 99, label: 'Outstanding', hex: '#44DFCC' },
  { min: 100, max: 100, label: 'Perfect', hex: '#6EF0EB' },
];

/** The two inks a chip can use: the site's light-mode body text, and white. */
const INK_DARK = '#0F172A';
const INK_LIGHT = '#FFFFFF';

function relativeLuminance(hex: string): number {
  const channel = (n: number) => {
    const c = n / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const r = channel(parseInt(hex.slice(1, 3), 16));
  const g = channel(parseInt(hex.slice(3, 5), 16));
  const b = channel(parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG relative-contrast ratio between two opaque hex colors. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export interface WesBand {
  /** Lowest score in the band, inclusive. */
  min: number;
  /** Highest score in the band, inclusive. */
  max: number;
  label: string;
  /** The band's exact fill color. Used as a background, never as text. */
  hex: string;
  /** Whichever of white / near-black reads better on `hex`. Computed, not chosen. */
  ink: string;
}

/** All 21 bands, worst to best. Exported so the /what-is-wes legend renders the real scale rather than a copy of it. */
export const WES_BANDS: readonly WesBand[] = BAND_DEFS.map((b) => ({
  ...b,
  ink: contrastRatio(b.hex, INK_LIGHT) >= contrastRatio(b.hex, INK_DARK) ? INK_LIGHT : INK_DARK,
}));

/**
 * Score -> band. The score is clamped to 0-100 first (a raw WES can round
 * outside that range).
 *
 * A non-finite score resolves to the WORST band, deliberately. NaN survives
 * both Math.round and Math.min/max, so it used to fall past every band and
 * land on the fallback at the end of the array — a missing score rendered as
 * a dark-teal "Perfect", the single most reassuring thing this scale can say.
 * Same family as the null forecast temperatures that priced markets at 0.5F
 * (see open-meteo.ts): bad data must never read as good news.
 */
export function getWesBand(score: number): WesBand {
  if (!Number.isFinite(score)) return WES_BANDS[0];
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const band = WES_BANDS.find((b) => clamped <= b.max);
  return band ?? WES_BANDS[WES_BANDS.length - 1];
}

/**
 * Inline custom properties that drive `.wes-chip` (see global.css). The color is
 * data-driven, so it can't be a Tailwind class — Tailwind's build-time scanner
 * never sees a runtime-computed class string. Usable directly as an Astro
 * `style` object, or cast to CSSProperties in React.
 */
export function wesChipVars(band: WesBand): Record<string, string> {
  return { '--wes-bg': band.hex, '--wes-ink': band.ink };
}

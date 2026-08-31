import test from 'node:test';
import assert from 'node:assert/strict';
import { WES_BANDS, getWesBand, contrastRatio, wesChipVars } from '../src/lib/wes-scale';

// The 21-band WES presentation scale (src/lib/wes-scale.ts). These bands are
// hand-picked by Derek, not derived, so the point of this file is to fail loudly
// if anyone "improves" a boundary, a label, or a hex — every WES number the site
// shows, public and admin, is colored from this one table.

/** Derek's scale, transcribed independently of the module so a typo in one shows up as a failure. */
const EXPECTED: readonly [number, number, string, string][] = [
  [0, 4, 'Unplayable', '#5A0010'],
  [5, 9, 'Brutal', '#7A0018'],
  [10, 14, 'Extreme', '#9E1024'],
  [15, 19, 'Severe', '#C52233'],
  [20, 24, 'Miserable', '#E03A2F'],
  [25, 29, 'Harsh', '#E95B2B'],
  [30, 34, 'Rough', '#F47A24'],
  [35, 39, 'Difficult', '#F59E0B'],
  [40, 44, 'Uncomfortable', '#EAB308'],
  [45, 49, 'Challenging', '#D6B814'],
  [50, 54, 'Mixed', '#C8C72A'],
  [55, 59, 'Manageable', '#A7C636'],
  [60, 64, 'Fair', '#86C440'],
  [65, 69, 'Decent', '#63B946'],
  [70, 74, 'Pleasant', '#42A94D'],
  [75, 79, 'Good', '#249A55'],
  [80, 84, 'Great', '#06A87C'],
  [85, 89, 'Excellent', '#02BA89'],
  [90, 94, 'Ideal', '#19CDAC'],
  [95, 99, 'Outstanding', '#44DFCC'],
  [100, 100, 'Perfect', '#6EF0EB'],
];

test('the scale is exactly the 21 bands Derek specified', () => {
  assert.equal(WES_BANDS.length, EXPECTED.length);
  EXPECTED.forEach(([min, max, label, hex], i) => {
    assert.deepEqual(
      { min: WES_BANDS[i].min, max: WES_BANDS[i].max, label: WES_BANDS[i].label, hex: WES_BANDS[i].hex },
      { min, max, label, hex },
      `band ${i} (${label})`,
    );
  });
});

test('the bands cover 0-100 with no gap and no overlap', () => {
  assert.equal(WES_BANDS[0].min, 0);
  assert.equal(WES_BANDS[WES_BANDS.length - 1].max, 100);
  for (let i = 1; i < WES_BANDS.length; i++) {
    assert.equal(WES_BANDS[i].min, WES_BANDS[i - 1].max + 1, `gap before band ${i}`);
  }
});

test('every score 0-100 lands in the band that contains it', () => {
  for (let n = 0; n <= 100; n++) {
    const band = getWesBand(n);
    assert.ok(n >= band.min && n <= band.max, `${n} landed in ${band.min}-${band.max}`);
  }
});

test('both edges of every band resolve to that band', () => {
  for (const band of WES_BANDS) {
    assert.equal(getWesBand(band.min).label, band.label);
    assert.equal(getWesBand(band.max).label, band.label);
  }
});

test('100 is Perfect on its own, not lumped in with Outstanding', () => {
  assert.equal(getWesBand(100).label, 'Perfect');
  assert.equal(getWesBand(99).label, 'Outstanding');
});

test('a score outside 0-100 clamps instead of falling off the scale', () => {
  assert.equal(getWesBand(-12).label, 'Unplayable');
  assert.equal(getWesBand(142).label, 'Perfect');
  assert.equal(getWesBand(Number.NaN).label, 'Unplayable', 'NaN must not produce an undefined band');
});

test('a fractional score rounds before it is banded', () => {
  // 74.6 rounds to 75, which is the first score in Good, not the last in Pleasant.
  assert.equal(getWesBand(74.4).label, 'Pleasant');
  assert.equal(getWesBand(74.6).label, 'Good');
});

// ── The reason a WES badge is a filled chip rather than colored text ──────
// These hexes are fills. As text they are unreadable at both ends of the
// scale; as a chip background with the ink this module picks, every band is
// legible. If a future hex breaks that, this fails rather than shipping an
// unreadable badge.

test('every band ink is readable on its own fill', () => {
  for (const band of WES_BANDS) {
    const ratio = contrastRatio(band.hex, band.ink);
    assert.ok(ratio >= 4.3, `${band.label} (${band.hex} on ${band.ink}) is only ${ratio.toFixed(2)}:1`);
  }
});

test('ink is always the better of the two choices, never just white', () => {
  const mixed = WES_BANDS.filter((b) => b.ink === '#0F172A');
  assert.ok(mixed.length > 0, 'the yellow middle of the scale must take dark ink');
  for (const band of WES_BANDS) {
    const other = band.ink === '#FFFFFF' ? '#0F172A' : '#FFFFFF';
    assert.ok(
      contrastRatio(band.hex, band.ink) >= contrastRatio(band.hex, other),
      `${band.label} picked the worse ink`,
    );
  }
});

test('these colors would NOT have been legible as text — the fill is load-bearing', () => {
  const onNavy = contrastRatio(getWesBand(2).hex, '#041E42'); // dark theme page background
  const onWhite = contrastRatio(getWesBand(52).hex, '#FFFFFF');
  assert.ok(onNavy < 3, `worst band as text on the dark theme is ${onNavy.toFixed(2)}:1`);
  assert.ok(onWhite < 3, `mid band as text on a white page is ${onWhite.toFixed(2)}:1`);
});

test('wesChipVars emits the custom properties .wes-chip reads', () => {
  const band = getWesBand(72);
  assert.deepEqual(wesChipVars(band), { '--wes-bg': '#42A94D', '--wes-ink': band.ink });
});

// ── The top of the scale has to be readable as a RANGE ────────────────────
//
// The first cut of these bands was correct by every check above and still
// failed in practice: 80 through 100 ran dark and desaturated, so a whole MLB
// board of 85+ scores rendered as one indistinguishable dark green. Adjacent
// bands will always be close; what has to survive is telling a good day from a
// great one at a glance. These pin that, in OKLab, where distance actually
// tracks what the eye does.

function oklab(hex: string): [number, number, number] {
  const ch = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = [ch(1), ch(3), ch(5)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}
const perceptualDistance = (a: string, b: string) => {
  const A = oklab(a), B = oklab(b);
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
};

test('a good day and a great one are visibly different colors', () => {
  // 87 "Excellent" against 99 "Outstanding" — the comparison a customer
  // actually makes on a board where everything is in the eighties and nineties.
  const d = perceptualDistance(getWesBand(87).hex, getWesBand(99).hex);
  assert.ok(d >= 0.11, `87 and 99 are only ${d.toFixed(3)} apart in OKLab; they read as the same badge`);
});

test('the top of the scale gets brighter, not darker', () => {
  // The failure being prevented: a ramp that dims toward the top puts the
  // scores we show most often in the range the eye separates worst.
  const lightness = [80, 85, 90, 95, 100].map((s) => oklab(getWesBand(s).hex)[0]);
  for (let i = 1; i < lightness.length; i++) {
    assert.ok(
      lightness[i] > lightness[i - 1],
      `band ${[80, 85, 90, 95, 100][i]} is darker than the one below it (${lightness[i].toFixed(3)} vs ${lightness[i - 1].toFixed(3)})`,
    );
  }
});

test('the top bands keep their chroma instead of washing out', () => {
  // Chroma collapse, not lightness, is what flattened the original top end.
  for (const score of [80, 85, 90, 95]) {
    const [, a, b] = oklab(getWesBand(score).hex);
    const chroma = Math.hypot(a, b);
    assert.ok(chroma >= 0.11, `band ${score} has chroma ${chroma.toFixed(3)}, too washed out to separate`);
  }
});

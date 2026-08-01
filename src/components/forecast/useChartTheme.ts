// Step 128: small client-side hook so the recharts SVG axis labels stay
// readable in both Tailwind themes. The previous hardcoded slate-800 /
// slate-600 / slate-200 palette became near-invisible against the dark
// theme's bg-surface-dark-alt.
//
// Returns the colors as a stable object — tooltip/grid/tick fills.

import { useEffect, useState } from 'react';

export interface ChartThemeColors {
  /** Primary tick label (day, large numbers). */
  tickPrimary: string;
  /** Secondary tick label (time, smaller numbers). */
  tickSecondary: string;
  /** Axis line stroke. */
  axis: string;
  /** Gridline stroke. */
  grid: string;
  /** Tooltip background. */
  tooltipBg: string;
  /** Tooltip text. */
  tooltipText: string;
}

const LIGHT: ChartThemeColors = {
  tickPrimary: '#1e293b',  // slate-800
  tickSecondary: '#475569', // slate-600
  axis: '#475569',
  grid: '#e2e8f0',          // slate-200
  tooltipBg: '#1e293b',
  tooltipText: '#f8fafc',
};

const DARK: ChartThemeColors = {
  tickPrimary: '#e2e8f0',   // slate-200
  tickSecondary: '#94a3b8', // slate-400
  axis: '#94a3b8',
  grid: '#334155',          // slate-700
  tooltipBg: '#0f172a',
  tooltipText: '#f8fafc',
};

/**
 * Recharts renders axis labels as SVG `fill` attributes, so they cannot use a
 * Tailwind `dark:` variant — the palette has to be chosen in JS.
 *
 * History matters here, because this function has now been wrong in both
 * directions. It originally checked for `.dark` on documentElement, but
 * global.css declared `@variant dark (&)`, which forced every `dark:` variant
 * on unconditionally and never added the class — so the check always failed and
 * charts drew slate-800 text on navy. The fix at the time was to hardcode DARK.
 *
 * Light mode is real now (`@variant dark (&:where(.dark, .dark *))`, plus a
 * header toggle that writes the class), so hardcoding DARK became the new bug:
 * slate-200 axis labels on a white card.
 *
 * So: read the class, and WATCH it. The toggle flips it at runtime with no
 * reload, and a chart that only sampled the theme on mount would keep the wrong
 * palette until the next navigation.
 */
function readTheme(): ChartThemeColors {
  if (typeof document === 'undefined') return DARK;
  return document.documentElement.classList.contains('dark') ? DARK : LIGHT;
}

export function useChartTheme(): ChartThemeColors {
  const [theme, setTheme] = useState<ChartThemeColors>(readTheme);

  useEffect(() => {
    // Re-read on mount: these are client:only islands, but the inline theme
    // script in BaseLayout may land either side of hydration.
    setTheme(readTheme());

    const observer = new MutationObserver(() => setTheme(readTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);

  return theme;
}

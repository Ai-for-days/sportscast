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

export function useChartTheme(): ChartThemeColors {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const update = () => setIsDark(root.classList.contains('dark'));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return isDark ? DARK : LIGHT;
}

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
  // The site renders against a navy background unconditionally
  // (global.css forces `dark:` Tailwind variants on via
  // `@variant dark (&)` and sets body background-color: #041E42). The
  // previous implementation checked for the `dark` class on
  // documentElement, which Tailwind never actually adds in this
  // configuration — so charts always rendered with the LIGHT palette
  // and produced near-invisible slate-800 axis labels on the navy
  // background. Return DARK unconditionally to fix.
  return DARK;
}

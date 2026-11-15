// ── Step 75: Reusable system / quant tool navigation ────────────────────────
//
// Drop-in component used on AdminDashboard, TradingDesk, OperatorDashboard,
// and SignalsDashboard so every system route is reachable in <=2 clicks
// from any operator-facing page.

import React from 'react';
import { SECTION_ORDER, entriesFor } from '../../lib/admin-nav-registry';

export interface NavItem {
  href: string;
  title: string;
  description: string;
  badge?: string;
  badgeColor?: string;
}

export interface NavSection {
  heading: string;
  items: NavItem[];
}

// Exported so the admin tool-search page (/admin/search) can search the same
// directory the admin menu renders. Since WOW-024 it is built from the admin
// nav registry's visible entries (hidden pages never appear in search).
export const SECTIONS: NavSection[] = SECTION_ORDER.map((s) => ({
  heading: s.title,
  items: entriesFor(s.id)
    .filter((x) => x.route !== '/admin')
    .map((x) => ({ href: x.route, title: x.title, description: x.description })),
}));

interface Props {
  /** When provided, the link matching this href is highlighted as the current page. */
  activeHref?: string;
  /** Defaults to "System / Quant Tools". */
  heading?: string;
}

/**
 * Since WOW-024 every admin tool lives in the menu bar at the top of each admin
 * page, so the old four-column link wall is gone. The component keeps its name,
 * props and signature so its 55 importers do not change.
 */
export default function SystemNav({ activeHref: _activeHref, heading: _heading }: Props) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs text-gray-600">
      All admin tools are in the menu at the top.{' '}
      <a href="/admin/search" className="text-blue-600 hover:underline">Search</a>
      {' · '}
      <a href="/admin" className="text-blue-600 hover:underline">Admin Home</a>
    </div>
  );
}

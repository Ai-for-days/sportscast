// ── Step 121 Part C: Closed-beta informational strip ────────────────────────
//
// Customer-safe transparency message. Lightweight, non-intrusive, not
// gambling-heavy or legalistic.

import React from 'react';

interface Props {
  /** Optional custom message; defaults to the platform-wide beta line. */
  message?: string;
  /** Tighter padding when used inside a content area instead of as a top strip. */
  compact?: boolean;
}

const DEFAULT_MESSAGE =
  'Weather markets are in active beta. Rules and resolutions are documented on every market. Thanks for testing with us.';

export default function BetaBanner({ message = DEFAULT_MESSAGE, compact = false }: Props) {
  return (
    <div
      className={`rounded-lg border border-blue-200 bg-blue-50 ${
        compact ? 'px-3 py-2' : 'px-4 py-3'
      } text-sm text-blue-900`}
      role="status"
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className="mt-0.5 inline-flex h-5 shrink-0 items-center rounded-md bg-blue-600 px-1.5 text-[10px] font-bold uppercase tracking-wide text-white"
        >
          Beta
        </span>
        <span className="leading-snug">{message}</span>
      </div>
    </div>
  );
}

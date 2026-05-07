// ── Step 119C Part D: Why-trust customer trust panel ────────────────────────
//
// Public-safe trust narrative for a market detail page. No internal
// evidence systems, no disputes/incidents, no hedge logic, no Kalshi.

import React from 'react';
import type { PublicWagerView } from '../../lib/public-wager-view';

interface Props {
  view: PublicWagerView;
}

export default function WhyTrustThisMarket({ view }: Props) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <h3 className="text-base font-semibold text-slate-900">Why you can trust this market</h3>
      <ul className="mt-4 space-y-4 text-sm leading-relaxed text-slate-700">
        <li>
          <div className="font-semibold text-slate-900">Documented weather data</div>
          <p className="mt-0.5 text-slate-600">{view.resolutionSourceSummary}</p>
        </li>
        <li>
          <div className="font-semibold text-slate-900">Transparent rules</div>
          <p className="mt-0.5 text-slate-600">
            The market&apos;s win conditions, tie-handling, lock time, and resolution source are all shown on this page
            before you participate.
          </p>
        </li>
        <li>
          <div className="font-semibold text-slate-900">Predictable lifecycle</div>
          <p className="mt-0.5 text-slate-600">
            Markets move through clear stages: Open → Locked → Awaiting Resolution → Resolved (or Cancelled). The
            timeline above shows exactly where this market is.
          </p>
        </li>
        <li>
          <div className="font-semibold text-slate-900">Resolution process</div>
          <p className="mt-0.5 text-slate-600">
            Once authoritative observations for the target date are available, the matching outcome wins. If the result
            is unclear or contested, the market may be reviewed and cancelled per platform rules and stakes are returned.
          </p>
        </li>
        <li>
          <div className="font-semibold text-slate-900">Locked market protection</div>
          <p className="mt-0.5 text-slate-600">
            After the lock time, no new participation is accepted. The result is decided by observed weather, not by an
            after-the-fact call.
          </p>
        </li>
      </ul>
    </div>
  );
}

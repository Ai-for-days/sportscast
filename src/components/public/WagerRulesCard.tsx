// Step 116: Public-safe Market Rules card. Renders only fields already
// sanitized into PublicWagerView — no admin data, no mutation surface.

import React from 'react';
import type { PublicWagerView } from '../../lib/public-wager-view';

interface Props {
  view: PublicWagerView;
}

const RESPONSIBLE_PLAY_NOTE_RULES =
  'Only participate if you understand the rules and the risk. Weather outcomes can be uncertain.';

export default function WagerRulesCard({ view }: Props) {
  const isVoid = view.status === 'void';

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <h3 className="text-base font-semibold text-slate-900">Market Rules</h3>
      <ul className="mt-3 space-y-3 text-sm text-slate-700">
        <li>
          <div className="font-semibold text-slate-900">What must happen to win</div>
          <p className="mt-0.5 text-slate-600">{view.winConditionSummary}</p>
        </li>
        <li>
          <div className="font-semibold text-slate-900">Exact ties / pushes</div>
          <p className="mt-0.5 text-slate-600">{view.tieOrPushSummary}</p>
        </li>
        <li>
          <div className="font-semibold text-slate-900">When the market locks</div>
          <p className="mt-0.5 text-slate-600">{view.lockSummary}</p>
        </li>
        <li>
          <div className="font-semibold text-slate-900">How results are determined</div>
          <p className="mt-0.5 text-slate-600">{view.resolutionSourceSummary}</p>
        </li>
        {isVoid && (
          <li>
            <div className="font-semibold text-slate-900">Cancellation</div>
            <p className="mt-0.5 text-slate-600">
              This market was cancelled before resolution.
            </p>
          </li>
        )}
        <li>
          <div className="font-semibold text-slate-900">Responsible play</div>
          <p className="mt-0.5 text-slate-600">{RESPONSIBLE_PLAY_NOTE_RULES}</p>
        </li>
      </ul>
    </div>
  );
}

// Step 117: Public-safe FAQ / help panel for /wagers/[id]. No admin
// APIs, no internal data — copy is fixed and platform-agnostic.

import React from 'react';

interface FaqItem {
  q: string;
  a: string;
}

const ITEMS: FaqItem[] = [
  {
    q: 'What does "lock time" mean?',
    a:
      'Lock time is the deadline for participation. After lock, no new wagers are accepted and the market awaits authoritative weather observations before being resolved.',
  },
  {
    q: 'How is the weather result determined?',
    a:
      'Outcomes are determined from authoritative weather observations recorded for the target date at the weather station(s) shown on this page.',
  },
  {
    q: 'What happens if the result is unclear?',
    a:
      'If observations are missing, contested, or cannot determine a single winning outcome, the market may be reviewed and cancelled per platform rules.',
  },
  {
    q: 'What does "voided" or "cancelled" mean?',
    a:
      'The market was cancelled before resolution. No outcome was determined, and stakes are returned to participants per platform terms.',
  },
  {
    q: 'Can the market change after it is created?',
    a:
      'The terms shown on this page reflect the current published version of the market. Review the displayed rules and outcomes before participating.',
  },
  {
    q: 'What should I do before participating?',
    a:
      'Read the Market Rules, understand that weather outcomes can be uncertain, and participate responsibly. Wager only what you can afford to lose. If wagering is causing harm, seek help at 1-800-GAMBLER.',
  },
];

export default function WagerFAQ() {
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <ul className="divide-y divide-slate-100">
        {ITEMS.map((item, idx) => (
          <li key={idx}>
            <details className="group p-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-slate-900">
                <span>{item.q}</span>
                <span
                  aria-hidden
                  className="text-slate-400 transition group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                {item.a}
              </p>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}

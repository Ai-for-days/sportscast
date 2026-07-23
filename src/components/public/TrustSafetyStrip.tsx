// ── Step 119C Part A: Trust / safety / responsible-play strip ───────────────

import React from 'react';

const ITEMS = [
  {
    title: 'Documented observations',
    body: 'Outcomes are determined from authoritative weather observations for the target date. Sources are stated on every market.',
  },
  {
    title: 'Transparent rules',
    body: 'Every market shows its win conditions, tie/push behaviour, lock time, and how results are determined. Nothing is hidden.',
  },
  {
    title: 'Locked = locked',
    body: 'Once a market locks, no new participation is accepted. The result is decided by observed weather, not by anyone making a call.',
  },
  {
    title: 'Responsible play',
    body: 'Only participate if you understand the rules and the risk. Weather outcomes can be uncertain. Help is available at 1-800-GAMBLER.',
  },
];

export default function TrustSafetyStrip() {
  return (
    <section className="px-4 py-10">
      <div className="mx-auto max-w-6xl">
        <h2 className="text-center text-xl font-semibold text-slate-900 dark:text-text-dark sm:text-2xl">
          Built on transparent rules
        </h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ITEMS.map((it) => (
            <li key={it.title} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="text-sm font-semibold text-slate-900">{it.title}</div>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">{it.body}</p>
            </li>
          ))}
        </ul>
        <div className="mt-6 text-center">
          <a
            href="/wagers"
            className="inline-flex items-center rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Browse all markets
          </a>
        </div>
      </div>
    </section>
  );
}

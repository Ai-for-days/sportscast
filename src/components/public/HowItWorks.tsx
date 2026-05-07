// ── Step 119C Part A: How weather markets work ──────────────────────────────

import React from 'react';

const STEPS = [
  {
    n: 1,
    title: 'Markets open',
    body: 'Each market poses a clear yes/no or range question about a weather outcome — high temperature, wind speed, daily low — at a specific location and date.',
  },
  {
    n: 2,
    title: 'You participate',
    body: 'Pick the outcome you think is most likely. Markets show fixed odds and a clearly stated lock time. Once a market locks, no new participation is accepted.',
  },
  {
    n: 3,
    title: 'Weather is observed',
    body: 'After the target date, authoritative weather observations are recorded for the location.',
  },
  {
    n: 4,
    title: 'Market resolves',
    body: 'The matching outcome wins. If the result is unclear or contested, the market may be reviewed and cancelled per platform rules — stakes are returned in that case.',
  },
];

export default function HowItWorks() {
  return (
    <section className="bg-slate-50 px-4 py-12">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-center text-2xl font-bold text-slate-900 sm:text-3xl">How weather markets work</h2>
        <p className="mx-auto mt-2 max-w-2xl text-center text-sm text-slate-600">
          Four simple steps. No hidden rules.
        </p>
        <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <li key={s.n} className="rounded-lg border border-slate-200 bg-white p-5">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
                {s.n}
              </div>
              <h3 className="mt-3 text-base font-semibold text-slate-900">{s.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

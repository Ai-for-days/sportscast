// ── Step 119C Part A: Weather-markets hero ──────────────────────────────────
//
// Public marketing block for the weather-markets product. Read-only,
// no admin/Kalshi data, no settlement language. Mobile-first.

import React from 'react';

export default function HomeHero() {
  return (
    <section className="bg-gradient-to-b from-sky-50 to-white px-4 py-12 sm:py-16">
      <div className="mx-auto max-w-4xl text-center">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-sky-700">
          Weather Markets
        </p>
        <h2 className="text-3xl font-bold text-slate-900 sm:text-4xl md:text-5xl">
          Forecasts become markets.
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
          Predict tomorrow&apos;s weather with simple, transparent markets that resolve on documented observations. No
          guesswork about how the result is decided — every market shows its rules up front.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <a
            href="/wagers"
            className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Browse weather markets
          </a>
          <a
            href="/wagers?status=open"
            className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            View open markets
          </a>
        </div>
      </div>
    </section>
  );
}

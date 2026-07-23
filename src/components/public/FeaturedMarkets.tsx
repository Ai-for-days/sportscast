// ── Step 119C Part A: Featured open markets (client island) ─────────────────
//
// Step 120 Part D: consumes only PublicWagerView-shaped objects from the
// hardened /api/wagers endpoint. Never reads raw Wager fields.

import React, { useEffect, useState } from 'react';
import type { PublicWagerView } from '../../lib/public-wager-view';

function formatAmericanOdds(odds: number | undefined): string {
  if (odds == null || !Number.isFinite(odds)) return '—';
  return odds > 0 ? `+${odds}` : String(odds);
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'locking now';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h >= 1) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function FeaturedMarkets() {
  const [wagers, setWagers] = useState<PublicWagerView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/wagers?status=open&limit=6')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Failed to load markets'))))
      .then((j) => {
        if (cancelled) return;
        const list = Array.isArray(j?.wagers) ? (j.wagers as PublicWagerView[]) : [];
        setWagers(list);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? 'Failed to load.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="px-4 py-12">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-text-dark sm:text-3xl">Open weather markets</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-text-dark-muted">A few markets accepting participation right now.</p>
          </div>
          <a
            href="/wagers?status=open"
            className="text-sm font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
          >
            See all →
          </a>
        </div>

        {error && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Markets couldn&apos;t load right now. <a href="/wagers" className="underline">Browse all markets</a> instead.
          </div>
        )}

        {!error && wagers === null && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-44 animate-pulse rounded-lg border border-slate-200 bg-slate-50" />
            ))}
          </div>
        )}

        {!error && wagers && wagers.length === 0 && (
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
            No open markets at the moment. <a href="/wagers" className="font-semibold text-blue-600 hover:underline">Browse all markets</a> to see resolved and upcoming ones.
          </div>
        )}

        {!error && wagers && wagers.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {wagers.map((w) => {
              const ms = new Date(w.lockTime).getTime() - Date.now();
              const outcomes = (w.outcomes ?? []).slice(0, 3);
              return (
                <a
                  key={w.id}
                  href={`/wagers/${w.id}`}
                  className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200">
                      Open
                    </span>
                    <span className="text-xs text-slate-500">Locks in {formatCountdown(ms)}</span>
                  </div>
                  <h3 className="text-base font-semibold text-slate-900 line-clamp-2">{w.title}</h3>
                  <div className="flex flex-wrap gap-2">
                    {outcomes.map((o, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs"
                      >
                        <span className="text-slate-700 line-clamp-1">{o.label}</span>
                        <span className="font-mono font-bold text-slate-900">{formatAmericanOdds(o.displayedOdds)}</span>
                      </span>
                    ))}
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

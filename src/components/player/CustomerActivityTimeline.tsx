// ── Step 121 Part D: Customer-facing activity timeline ──────────────────────
//
// Renders the lifecycle events relevant to a single customer bet:
//   - bet placed
//   - wager locked
//   - wager resolved (or cancelled)
// Uses only customer-safe / public-safe fields. No admin notes, no audit
// log entries, no disputes/incidents, no hedge data.

import React from 'react';

interface PublicWagerViewMini {
  status: 'open' | 'locked' | 'graded' | 'void';
  lockTime: string;
  resolvedAt?: string;
  voidedAt?: string;
  winningOutcome?: string;
}

interface SafeBetMini {
  placedAt: string;
  status: 'pending' | 'won' | 'lost' | 'push' | 'void';
  outcomeLabel: string;
  publicWagerView?: PublicWagerViewMini;
}

interface Props {
  bet: SafeBetMini;
}

type StageState = 'complete' | 'current' | 'upcoming';

interface Stage {
  key: string;
  label: string;
  description: string;
  when?: string;
  state: StageState;
}

function fmt(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString();
}

export default function CustomerActivityTimeline({ bet }: Props) {
  const pwv = bet.publicWagerView;
  const now = Date.now();
  const lockTs = pwv ? new Date(pwv.lockTime).getTime() : NaN;
  const lockReached = !!pwv && now >= lockTs;
  const isOpen = pwv?.status === 'open';
  const isLocked = pwv?.status === 'locked';
  const isGraded = pwv?.status === 'graded';
  const isVoid = pwv?.status === 'void';

  const stages: Stage[] = [];

  stages.push({
    key: 'placed',
    label: 'Bet placed',
    description: `Your pick: ${bet.outcomeLabel}.`,
    when: bet.placedAt,
    state: 'complete',
  });

  stages.push({
    key: 'locked',
    label: 'Market locked',
    description: lockReached
      ? 'No new participation accepted. Awaiting authoritative weather observations.'
      : `Locks at ${fmt(pwv?.lockTime)}.`,
    when: pwv?.lockTime,
    state: isLocked ? 'current' : lockReached || isGraded || isVoid ? 'complete' : 'upcoming',
  });

  if (isVoid) {
    stages.push({
      key: 'cancelled',
      label: 'Market cancelled',
      description: 'Cancelled before resolution. Your stake is returned per platform terms.',
      when: pwv?.voidedAt,
      state: 'current',
    });
  } else {
    stages.push({
      key: 'resolved',
      label: 'Market resolved',
      description: isGraded
        ? `Winning outcome: ${pwv?.winningOutcome ?? '—'}.`
        : 'Will resolve once authoritative observations are recorded.',
      when: isGraded ? pwv?.resolvedAt : undefined,
      state: isGraded ? 'current' : 'upcoming',
    });
  }

  if (isGraded) {
    const yourResult =
      bet.status === 'won'
        ? 'You won.'
        : bet.status === 'lost'
          ? 'You did not win this market.'
          : bet.status === 'push'
            ? 'Push — your stake was returned.'
            : 'Resolved.';
    stages.push({
      key: 'your-result',
      label: 'Your result',
      description: yourResult,
      when: pwv?.resolvedAt,
      state: 'current',
    });
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <ol className="divide-y divide-slate-100" aria-label="Customer activity">
        {stages.map((s, idx) => {
          const isLast = idx === stages.length - 1;
          return (
            <li key={s.key} className="flex gap-3 p-4">
              <div className="flex flex-col items-center">
                <span
                  aria-hidden
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ring-2 ${
                    s.state === 'complete'
                      ? 'bg-emerald-500 text-white ring-emerald-100'
                      : s.state === 'current'
                        ? 'bg-blue-600 text-white ring-blue-100'
                        : 'bg-white text-slate-400 ring-slate-200'
                  }`}
                >
                  {idx + 1}
                </span>
                {!isLast && (
                  <span
                    aria-hidden
                    className={`mt-1 w-0.5 grow ${
                      s.state === 'upcoming' ? 'bg-slate-200' : 'bg-emerald-300'
                    }`}
                  />
                )}
              </div>
              <div className="flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <h3
                    className={`text-sm font-semibold ${
                      s.state === 'upcoming' ? 'text-slate-400' : 'text-slate-900'
                    }`}
                  >
                    {s.label}
                  </h3>
                  {s.when && <span className="text-xs text-slate-500">{fmt(s.when)}</span>}
                </div>
                <p
                  className={`mt-1 text-xs ${
                    s.state === 'upcoming' ? 'text-slate-400' : 'text-slate-600'
                  }`}
                >
                  {s.description}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

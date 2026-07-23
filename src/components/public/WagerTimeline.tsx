// Step 115: Public, read-only market lifecycle timeline. Receives the
// already-sanitized PublicWagerView — never touches admin fields.

import React from 'react';
import type { PublicWagerView } from '../../lib/public-wager-view';
import { formatDMYTime } from '../../lib/date-format';

interface Props {
  view: PublicWagerView;
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
  return formatDMYTime(iso);
}

function buildStages(view: PublicWagerView): Stage[] {
  const now = Date.now();
  const lockTs = new Date(view.lockTime).getTime();
  const lockReached = now >= lockTs;
  const isOpen = view.status === 'open';
  const isLocked = view.status === 'locked';
  const isGraded = view.status === 'graded';
  const isVoid = view.status === 'void';
  const terminal = isGraded || isVoid;

  const stages: Stage[] = [];

  stages.push({
    key: 'created',
    label: 'Market Created',
    description: 'Posted to the public board.',
    when: view.createdAt,
    state: 'complete',
  });

  stages.push({
    key: 'open',
    label: 'Open for Trading',
    description: isOpen
      ? 'This market is currently open.'
      : 'Wagering window is closed.',
    state: isOpen ? 'current' : 'complete',
  });

  stages.push({
    key: 'locked',
    label: 'Locked',
    description: isLocked
      ? 'No further wagers accepted.'
      : lockReached || (terminal && lockReached)
        ? 'No further wagers accepted.'
        : `Locks at ${fmt(view.lockTime)}.`,
    when: view.lockTime,
    state: isLocked
      ? 'current'
      : lockReached || (terminal && lockReached)
        ? 'complete'
        : 'upcoming',
  });

  stages.push({
    key: 'awaiting',
    label: 'Awaiting Resolution',
    description: isLocked
      ? 'This market is locked and awaiting resolution.'
      : terminal && lockReached
        ? 'Authoritative observations received.'
        : 'Pending lock and observations.',
    state: isLocked
      ? 'current'
      : terminal && lockReached
        ? 'complete'
        : 'upcoming',
  });

  if (isVoid) {
    stages.push({
      key: 'cancelled',
      label: 'Cancelled',
      description: 'This market was cancelled before resolution.',
      when: view.voidedAt,
      state: 'current',
    });
  } else {
    stages.push({
      key: 'resolved',
      label: 'Resolved',
      description: isGraded
        ? 'This market has been resolved.'
        : 'Will be graded once authoritative observations are recorded.',
      when: isGraded ? view.resolvedAt : undefined,
      state: isGraded ? 'current' : 'upcoming',
    });
  }

  return stages;
}

function dotClasses(state: StageState): string {
  if (state === 'complete') {
    return 'bg-emerald-500 text-white ring-emerald-100';
  }
  if (state === 'current') {
    return 'bg-blue-600 text-white ring-blue-100';
  }
  return 'bg-white text-slate-400 ring-slate-200';
}

function labelClasses(state: StageState): string {
  return state === 'upcoming' ? 'text-slate-400' : 'text-slate-900';
}

function descClasses(state: StageState): string {
  return state === 'upcoming' ? 'text-slate-400' : 'text-slate-600';
}

export default function WagerTimeline({ view }: Props) {
  const stages = buildStages(view);

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <ol className="divide-y divide-slate-100" aria-label="Market lifecycle">
        {stages.map((s, idx) => {
          const isLast = idx === stages.length - 1;
          const connectorClass =
            s.state === 'upcoming' ? 'bg-slate-200' : 'bg-emerald-300';
          return (
            <li key={s.key} className="flex gap-3 p-4">
              <div className="flex flex-col items-center">
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ring-2 ${dotClasses(s.state)}`}
                  aria-hidden
                >
                  {idx + 1}
                </span>
                {!isLast && (
                  <span
                    className={`mt-1 w-0.5 grow ${connectorClass}`}
                    aria-hidden
                  />
                )}
              </div>
              <div className="flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <h3 className={`text-sm font-semibold ${labelClasses(s.state)}`}>
                    {s.label}
                  </h3>
                  {s.when && (
                    <span className="text-xs text-slate-500">{fmt(s.when)}</span>
                  )}
                </div>
                <p className={`mt-1 text-xs ${descClasses(s.state)}`}>
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

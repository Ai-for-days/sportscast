// Public, read-only market detail page. Receives a fully sanitized
// PublicWagerView from the SSR Astro page — does NOT call any admin API
// and does NOT have any mutation surface.
//
// Step 119C: beginner-friendly redesign. Outcomes promoted near the top,
// a Quick Summary card, plain-language "if you're right" examples, a
// short glossary, a Why-Trust panel, sticky mobile CTA, and non-functional
// Track / Share / View-similar placeholders.

import React from 'react';
import type { PublicWagerView } from '../../lib/public-wager-view';
import WagerTimeline from './WagerTimeline';
import WagerRulesCard from './WagerRulesCard';
import WagerFAQ from './WagerFAQ';
import WhyTrustThisMarket from './WhyTrustThisMarket';
import BetaBanner from './BetaBanner';

interface Props {
  view: PublicWagerView;
}

const STATUS_BADGE: Record<string, string> = {
  open: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  locked: 'bg-amber-100 text-amber-800 ring-amber-200',
  graded: 'bg-blue-100 text-blue-800 ring-blue-200',
  void: 'bg-slate-200 text-slate-700 ring-slate-300',
};

const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  locked: 'Locked',
  graded: 'Resolved',
  void: 'Cancelled',
};

const KIND_LABEL: Record<string, string> = {
  odds: 'Range odds',
  'over-under': 'Over / under',
  pointspread: 'Pointspread',
};

const GLOSSARY: { term: string; def: string }[] = [
  {
    term: 'Odds',
    def: 'A number that shows how much you would win if the outcome happens. American odds: a positive number like +135 means a $100 wager wins $135; a negative number like -110 means you wager $110 to win $100.',
  },
  {
    term: 'Lock time',
    def: 'The deadline for participation. After lock time, no new wagers are accepted and the market waits for authoritative weather observations.',
  },
  {
    term: 'Resolution',
    def: 'The point when the market is decided based on documented weather observations for the target date. Resolved markets show the winning outcome.',
  },
  {
    term: 'Void / Cancelled',
    def: 'A market that was cancelled before a winning outcome was determined. Stakes are returned to participants per platform terms.',
  },
];

function formatCountdown(ms: number): string {
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  if (days >= 1) return `${days}d ${hours}h`;
  if (hours >= 1) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatAmericanOdds(odds: number): string {
  if (!Number.isFinite(odds)) return '—';
  return odds > 0 ? `+${odds}` : String(odds);
}

function americanToReturn(odds: number, stake: number): number {
  if (!Number.isFinite(odds) || odds === 0) return 0;
  if (odds > 0) return Math.round(stake * (odds / 100));
  return Math.round(stake * (100 / Math.abs(odds)));
}

export default function WagerDetailPage({ view }: Props) {
  const lockDate = new Date(view.lockTime);
  const locked = view.status !== 'open';
  const ms = lockDate.getTime() - Date.now();
  const lockCountdown = !locked && ms > 0 ? formatCountdown(ms) : null;

  // Step 120 Part E: use the first-listed outcome (with concrete odds) for
  // the "if you're right" example. Avoids highlighting the highest-payout
  // outcome and the manipulative framing that comes with that.
  const exampleOutcome =
    view.outcomes.find((o) => typeof o.displayedOdds === 'number') ?? null;
  const exampleStake = 10;
  const exampleReturn =
    exampleOutcome && typeof exampleOutcome.displayedOdds === 'number'
      ? americanToReturn(exampleOutcome.displayedOdds, exampleStake)
      : null;

  return (
    <div className="mx-auto max-w-4xl px-4 pt-6 pb-28 sm:pb-8">
      <div className="mb-4">
        <BetaBanner compact />
      </div>
      {/* Header */}
      <div className="mb-4">
        <div className="mb-2 flex items-center gap-2 text-xs text-slate-500">
          <a href="/wagers" className="hover:text-slate-700 hover:underline">All markets</a>
          <span>/</span>
          <span className="font-mono">{view.ticketNumber}</span>
        </div>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">{view.title}</h1>
        {view.description && (
          <p className="mt-2 text-slate-600">{view.description}</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 ${STATUS_BADGE[view.status] ?? 'bg-slate-100 text-slate-700 ring-slate-200'}`}>
            {STATUS_LABEL[view.status] ?? view.status}
          </span>
          <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
            {KIND_LABEL[view.kind] ?? view.kind}
          </span>
          {lockCountdown && (
            <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200">
              Locks in {lockCountdown}
            </span>
          )}
        </div>
        {/* Future-ready placeholders */}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled
            title="Coming soon"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 cursor-not-allowed"
          >
            ☆ Track this market
          </button>
          <button
            type="button"
            disabled
            title="Coming soon"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 cursor-not-allowed"
          >
            ⤴ Share market
          </button>
          <a
            href="/wagers"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            View similar markets
          </a>
        </div>
      </div>

      {/* Status-driven banner */}
      {view.status === 'graded' && (
        <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4 text-blue-900">
          <div className="text-sm font-semibold">Resolved</div>
          <div className="mt-1 text-sm">
            Winning outcome: <strong>{view.winningOutcome ?? '—'}</strong>
            {typeof view.observedValue === 'number' && (
              <>{' · '}Observed value: <strong>{view.observedValue}</strong></>
            )}
            {(typeof view.observedValueA === 'number' || typeof view.observedValueB === 'number') && (
              <>{' · '}A: <strong>{view.observedValueA ?? '—'}</strong>, B: <strong>{view.observedValueB ?? '—'}</strong></>
            )}
          </div>
        </div>
      )}
      {view.status === 'void' && (
        <div className="mb-6 rounded-lg border border-slate-300 bg-slate-100 p-4 text-slate-800">
          <div className="text-sm font-semibold">This market was cancelled before resolution.</div>
          <div className="mt-1 text-xs text-slate-600">Stakes on a cancelled market are not paid out and are returned to participants per platform terms.</div>
        </div>
      )}
      {view.status === 'locked' && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">
          <div className="text-sm font-semibold">This market is locked and awaiting resolution.</div>
          <div className="mt-1 text-xs">
            No additional action is accepted. The market is graded once authoritative weather observations for the
            target date are available and reviewed.
          </div>
        </div>
      )}

      {/* Step 119C: Quick Summary */}
      <div className="mb-6 rounded-xl border border-blue-100 bg-blue-50/40 p-4 sm:p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-blue-700">Quick summary</h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium text-slate-500">What is being predicted</dt>
            <dd className="mt-0.5 text-sm text-slate-800">{view.termsSummary}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">When the market locks</dt>
            <dd className="mt-0.5 text-sm text-slate-800">
              {lockDate.toLocaleString()}
              {lockCountdown ? <span className="text-emerald-700"> · in {lockCountdown}</span> : null}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">How it resolves</dt>
            <dd className="mt-0.5 text-sm text-slate-800">{view.resolutionSourceSummary}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">Current outcomes</dt>
            <dd className="mt-0.5 text-sm text-slate-800">{view.displayedOdds || '—'}</dd>
          </div>
        </dl>
      </div>

      {/* Outcomes — promoted to top per Step 119C visual hierarchy */}
      <Section title="Outcomes">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {view.outcomes.map((o, i) => (
            <div
              key={i}
              className={`rounded-lg border p-4 ${o.isWinner ? 'border-blue-400 bg-blue-50 ring-2 ring-blue-200' : 'border-slate-200 bg-white'}`}
            >
              <div className="text-sm font-semibold text-slate-900">{o.label}</div>
              <div className="mt-1 font-mono text-3xl font-bold text-slate-900">
                {typeof o.displayedOdds === 'number' ? formatAmericanOdds(o.displayedOdds) : '—'}
              </div>
              {o.isWinner && (
                <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-blue-700">Winning outcome</div>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* "What happens if I'm right?" example */}
      {exampleOutcome && exampleReturn !== null && (
        <Section title="What happens if you're right">
          <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-700">
            If you wager <strong>${exampleStake}</strong> on{' '}
            <strong>{exampleOutcome.label}</strong> at{' '}
            <span className="font-mono font-bold">{formatAmericanOdds(exampleOutcome.displayedOdds!)}</span> and the
            outcome happens, you would win <strong>${exampleReturn}</strong> on top of your stake. If the result
            doesn&apos;t match this outcome, you don&apos;t receive a payout for this entry.
            <span className="mt-2 block text-xs text-slate-500">Example only — actual amounts depend on what you wager.</span>
          </div>
        </Section>
      )}

      {/* Market timeline (Step 115 placement preserved per Step 115 decision 4) */}
      <Section title="Market timeline">
        <WagerTimeline view={view} />
      </Section>

      {/* Market Rules (Step 116) */}
      <Section title="Market Rules">
        <WagerRulesCard view={view} />
      </Section>

      {/* Why trust this market (Step 119C Part D) */}
      <Section title="Why you can trust this market">
        <WhyTrustThisMarket view={view} />
      </Section>

      {/* Glossary */}
      <Section title="Plain-language glossary">
        <dl className="rounded-lg border border-slate-200 bg-white">
          {GLOSSARY.map((g, i) => (
            <div
              key={g.term}
              className={`p-4 ${i < GLOSSARY.length - 1 ? 'border-b border-slate-100' : ''}`}
            >
              <dt className="text-sm font-semibold text-slate-900">{g.term}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-slate-600">{g.def}</dd>
            </div>
          ))}
        </dl>
      </Section>

      {/* Key facts (kept lower per visual hierarchy) */}
      <Section title="Key facts">
        <dl className="grid gap-3 sm:grid-cols-2">
          <Fact label="Location">{view.locationSummary}</Fact>
          <Fact label="Target date">{view.targetDate}{view.targetTime ? ` at ${view.targetTime}` : ''}</Fact>
          <Fact label="Lock time">{lockDate.toLocaleString()}</Fact>
          <Fact label="Displayed odds">{view.displayedOdds || '—'}</Fact>
        </dl>
      </Section>

      {/* Methodology (lower per Step 119C visual hierarchy) */}
      <Section title="How this market resolves">
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-700">
          {view.resolutionRules}
        </div>
      </Section>

      <Section title="Weather data used">
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-700">
          {view.weatherDataExplanation}
        </div>
      </Section>

      {/* FAQ (Step 117) */}
      <Section title="Questions about this market">
        <WagerFAQ />
      </Section>

      {/* Responsible play */}
      <Section title="Responsible play">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          {view.responsiblePlayNote}
        </div>
      </Section>

      <div className="mt-8 text-center text-xs text-slate-400">
        Market <span className="font-mono">{view.ticketNumber}</span> · ID <span className="font-mono">{view.id}</span>
      </div>

      {/* Sticky mobile CTA — hidden on sm+ where the page header already provides actions */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:hidden">
        <div className="mx-auto flex max-w-4xl items-center gap-2">
          <a
            href="#outcomes"
            onClick={(e) => {
              e.preventDefault();
              const target = document.querySelector('h2');
              target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-center text-sm font-semibold text-white"
          >
            View outcomes
          </a>
          <a
            href="/wagers"
            className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-center text-sm font-semibold text-slate-700"
          >
            Browse markets
          </a>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm text-slate-800">{children}</dd>
    </div>
  );
}

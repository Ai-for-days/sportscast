// Public, read-only market detail page. Receives a fully sanitized
// PublicWagerView from the SSR Astro page — does NOT call any admin API
// and does NOT have any mutation surface.

import React from 'react';
import type { PublicWagerView } from '../../lib/public-wager-view';

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
  open: 'Open for play',
  locked: 'Locked — awaiting resolution',
  graded: 'Resolved',
  void: 'Void',
};

const KIND_LABEL: Record<string, string> = {
  odds: 'Range odds',
  'over-under': 'Over / under',
  pointspread: 'Pointspread',
};

export default function WagerDetailPage({ view }: Props) {
  const lockDate = new Date(view.lockTime);
  const locked = view.status !== 'open';
  const ms = lockDate.getTime() - Date.now();
  const lockCountdown = !locked && ms > 0 ? formatCountdown(ms) : null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <div className="mb-2 flex items-center gap-2 text-xs text-slate-500">
          <a href="/wagers" className="hover:text-slate-700 hover:underline">All markets</a>
          <span>/</span>
          <span className="font-mono">{view.ticketNumber}</span>
        </div>
        <h1 className="text-3xl font-bold text-slate-900">{view.title}</h1>
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
          <span className="text-xs text-slate-500">
            Last updated {new Date(view.lastUpdatedAt).toLocaleString()}
          </span>
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
          <div className="text-sm font-semibold">This market is void.</div>
          {view.voidReason && <div className="mt-1 text-sm">Reason: {view.voidReason}</div>}
          <div className="mt-1 text-xs text-slate-600">Stakes on a void market are not paid out and are returned to participants per platform terms.</div>
        </div>
      )}
      {view.status === 'open' && lockCountdown && (
        <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
          <div className="text-sm font-semibold">Locks in {lockCountdown}</div>
          <div className="mt-1 text-xs">Wager closes at {lockDate.toLocaleString()}.</div>
        </div>
      )}
      {view.status === 'locked' && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">
          <div className="text-sm font-semibold">Locked — awaiting resolution.</div>
          <div className="mt-1 text-xs">No more action can be taken until weather observations are available and the market is graded.</div>
        </div>
      )}

      {/* Terms summary */}
      <Section title="What this market is asking">
        <p className="text-slate-700">{view.termsSummary}</p>
      </Section>

      {/* Outcomes */}
      <Section title="Outcomes">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {view.outcomes.map((o, i) => (
            <div
              key={i}
              className={`rounded-lg border p-4 ${o.isWinner ? 'border-blue-400 bg-blue-50 ring-2 ring-blue-200' : 'border-slate-200 bg-white'}`}
            >
              <div className="text-sm font-semibold text-slate-900">{o.label}</div>
              <div className="mt-1 font-mono text-2xl font-bold text-slate-800">
                {typeof o.displayedOdds === 'number' ? formatAmericanOdds(o.displayedOdds) : '—'}
              </div>
              {o.isWinner && (
                <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-blue-700">Winning outcome</div>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* Key facts grid */}
      <Section title="Key facts">
        <dl className="grid gap-3 sm:grid-cols-2">
          <Fact label="Location">{view.locationSummary}</Fact>
          <Fact label="Target date">{view.targetDate}{view.targetTime ? ` at ${view.targetTime}` : ''}</Fact>
          <Fact label="Lock time">{lockDate.toLocaleString()}</Fact>
          <Fact label="Displayed odds">{view.displayedOdds || '—'}</Fact>
        </dl>
      </Section>

      {/* Resolution rules */}
      <Section title="How this market resolves">
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-700">
          {view.resolutionRules}
        </div>
      </Section>

      {/* Weather data explanation */}
      <Section title="Weather data used">
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-700">
          {view.weatherDataExplanation}
        </div>
        <p className="mt-3 text-xs italic text-slate-500">
          This market is weather-dependent; outcomes are resolved using documented weather observations.
        </p>
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

function formatAmericanOdds(odds: number): string {
  if (!Number.isFinite(odds)) return '—';
  return odds > 0 ? `+${odds}` : String(odds);
}

function formatCountdown(ms: number): string {
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  if (days >= 1) return `${days}d ${hours}h`;
  if (hours >= 1) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

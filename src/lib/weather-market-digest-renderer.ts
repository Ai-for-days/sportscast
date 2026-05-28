// ── Step 160: Daily-brief → digest renderer ─────────────────────────────
//
// Pure helpers that turn a `WeatherMarketDailyBrief` (Step 159) into an
// HTML + plaintext digest suitable for an operator handoff or — once
// outbound email infrastructure exists — a daily admin email.
//
// **Admin-only. No I/O. No mutation. No outbound send.** This file does
// not import any mailer / wallet / settlement / grading / publish /
// Kalshi / Polymarket / public-API code. Pure data → string functions.
//
// The current build has no SMTP/SES/SendGrid/Resend/etc. configured,
// so Step 160 ships preview-only. The digest payload here is shaped so
// a future step can pipe `{ subject, html, text }` into whatever mailer
// gets adopted, without re-rendering.

import type { WeatherMarketDailyBrief, BriefItem } from './weather-market-daily-brief';

if (typeof window !== 'undefined') {
  // Pure helpers — safe to render anywhere — but keep them in the
  // server bundle to match the Step 159 brief module's posture.
  // (No throw here; the digest renderer is small enough that the
  // marginal cost of bundling it in client code if anyone ever imports
  // it isn't worth a hard error.)
}

// ── Public types ────────────────────────────────────────────────────────────

export interface DigestPayload {
  /** One-line subject suitable for an email or chat headline. */
  subject: string;
  /** Multi-line plain text body. */
  text: string;
  /** Inline-styled HTML body. */
  html: string;
  /** Echo of `brief.generatedAt`. */
  generatedAt: string;
  /** Recipient hint — never actually sent from this step. */
  recipient: string;
}

export interface RenderDigestOptions {
  /** Recipient stamp shown in the digest footer. Defaults to the project owner. */
  recipient?: string;
  /** Origin / base URL for any deep links. Defaults to a relative path. */
  baseUrl?: string;
}

const DEFAULT_RECIPIENT = 'derek@derekbdavis.com';

// ── HTML helpers ───────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toneColor(tone: BriefItem['tone']): string {
  if (tone === 'high') return '#b91c1c';
  if (tone === 'warning') return '#b45309';
  if (tone === 'positive') return '#15803d';
  return '#475569';
}

function renderItemRowHtml(item: BriefItem, baseUrl: string): string {
  const safeTitle = escapeHtml(item.title);
  const safeSub = item.subtitle ? escapeHtml(item.subtitle) : '';
  const color = toneColor(item.tone);
  const href = item.link ? (item.link.startsWith('http') ? item.link : `${baseUrl}${item.link}`) : '';
  const titleHtml = href
    ? `<a href="${escapeHtml(href)}" style="color:#1d4ed8;text-decoration:none;">${safeTitle}</a>`
    : safeTitle;
  const subHtml = safeSub
    ? `<div style="font-size:11px;color:#475569;margin-top:2px;">${safeSub}</div>`
    : '';
  return [
    `<tr><td style="padding:6px 8px;border-left:4px solid ${color};background:#f8fafc;">`,
    `<div style="font-size:13px;font-weight:600;color:#0f172a;word-break:break-word;">${titleHtml}</div>`,
    subHtml,
    `</td></tr>`,
  ].join('');
}

function renderSectionHtml(
  title: string,
  description: string,
  items: BriefItem[],
  baseUrl: string,
  emptyCopy: string,
): string {
  const head = [
    `<h2 style="margin:18px 0 4px 0;font-size:14px;color:#0f172a;">${escapeHtml(title)}</h2>`,
    `<div style="font-size:11px;color:#64748b;margin-bottom:6px;">${escapeHtml(description)}</div>`,
  ].join('');
  if (items.length === 0) {
    return `${head}<div style="font-size:12px;color:#94a3b8;font-style:italic;">${escapeHtml(emptyCopy)}</div>`;
  }
  return [
    head,
    `<table role="presentation" cellpadding="0" cellspacing="6" border="0" style="border-collapse:separate;border-spacing:0 4px;width:100%;">`,
    items.map((it) => renderItemRowHtml(it, baseUrl)).join(''),
    `</table>`,
  ].join('');
}

// ── Plain-text helpers ─────────────────────────────────────────────────────

function renderItemRowText(item: BriefItem, baseUrl: string): string {
  const lines: string[] = [];
  const lead = `  • ${item.title}`;
  lines.push(lead);
  if (item.subtitle) lines.push(`     ${item.subtitle}`);
  if (item.link) {
    const href = item.link.startsWith('http') ? item.link : `${baseUrl}${item.link}`;
    lines.push(`     ↪ ${href}`);
  }
  return lines.join('\n');
}

function renderSectionText(
  title: string,
  items: BriefItem[],
  baseUrl: string,
  emptyCopy: string,
): string {
  const head = `${title}\n${'-'.repeat(title.length)}`;
  if (items.length === 0) return `${head}\n  (${emptyCopy})`;
  return `${head}\n${items.map((it) => renderItemRowText(it, baseUrl)).join('\n')}`;
}

// ── Subject line ───────────────────────────────────────────────────────────

function buildSubject(brief: WeatherMarketDailyBrief): string {
  const dateStr = (() => {
    const d = new Date(brief.generatedAt);
    if (Number.isNaN(d.getTime())) return brief.generatedAt;
    return d.toISOString().slice(0, 10);
  })();
  const parts: string[] = [];
  if (brief.counts.highSeverityWarnings > 0) {
    parts.push(`${brief.counts.highSeverityWarnings} high-sev`);
  }
  if (brief.counts.qaPending + brief.counts.qaNeedsChanges > 0) {
    parts.push(`${brief.counts.qaPending + brief.counts.qaNeedsChanges} QA`);
  }
  if (brief.counts.draftsActive > 0) {
    parts.push(`${brief.counts.draftsActive} draft(s)`);
  }
  // Step 166 — divergence count appended only when non-zero.
  if (typeof brief.counts.divergenceWatch === 'number' && brief.counts.divergenceWatch > 0) {
    parts.push(`${brief.counts.divergenceWatch} divergence`);
  }
  const tag = parts.length > 0 ? ` · ${parts.join(' · ')}` : '';
  return `WagerOnWeather admin brief ${dateStr}${tag}`;
}

// ── Public renderers ───────────────────────────────────────────────────────

const SECTIONS: Array<{
  key: keyof Pick<
    WeatherMarketDailyBrief,
    | 'generatedHighlights'
    | 'interestingMarkets'
    | 'riskAlerts'
    | 'forecastDivergenceWatch'
    | 'qaPending'
    | 'staleDrafts'
    | 'recentlyPublished'
    | 'feedbackSignals'
    | 'tuningSignals'
  >;
  title: string;
  description: string;
  empty: string;
}> = [
  {
    key: 'generatedHighlights',
    title: 'Top ideas',
    description: 'High-interest ideas saved in the last 24 hours.',
    empty: 'No high-interest ideas saved in the last 24 hours.',
  },
  {
    key: 'interestingMarkets',
    title: 'High-interest discoveries',
    description: 'Saved ideas the scorer rated promising or high-interest.',
    empty: 'No promising or high-interest saved ideas right now.',
  },
  {
    key: 'riskAlerts',
    title: 'Risk alerts',
    description: 'Items carrying high-severity duplicate or correlation warnings.',
    empty: 'No high-severity risk warnings — workflow is clean.',
  },
  {
    key: 'forecastDivergenceWatch',
    title: 'Forecast Instability Highlights',
    description: 'Step 166 — saved-idea sides whose recent forecast snapshots show non-trivial divergence, volatility, or settlement risk.',
    empty: 'No actionable divergence signals right now.',
  },
  {
    key: 'qaPending',
    title: 'QA pending',
    description: 'Published markets whose post-publish QA is pending or needs changes.',
    empty: 'QA queue is empty — every published market has been reviewed.',
  },
  {
    key: 'staleDrafts',
    title: 'Drafts needing action',
    description: 'Drafts that have not been published or updated in the last 48 hours.',
    empty: 'No stale drafts.',
  },
  {
    key: 'recentlyPublished',
    title: 'Recently published',
    description: 'Drafts promoted to live wagers in the last 48 hours.',
    empty: 'No recently published markets.',
  },
  {
    key: 'feedbackSignals',
    title: 'Feedback signals',
    description: 'Per-preset useful rate + advisory tuning note.',
    empty: 'No feedback signals yet.',
  },
  {
    key: 'tuningSignals',
    title: 'Tuning notes',
    description: 'Top-level advisory notes from the feedback aggregator.',
    empty: 'No tuning notes yet.',
  },
];

export function renderDigestHTML(
  brief: WeatherMarketDailyBrief,
  options: RenderDigestOptions = {},
): string {
  const baseUrl = options.baseUrl ?? '';
  const recipient = options.recipient ?? DEFAULT_RECIPIENT;
  const subject = buildSubject(brief);
  const headline = escapeHtml(brief.summaryHeadline);
  const generated = (() => {
    const d = new Date(brief.generatedAt);
    return Number.isNaN(d.getTime()) ? brief.generatedAt : d.toUTCString();
  })();

  const failedSubsystems = Object.entries(brief.subsystemStatus)
    .filter(([, h]) => h === 'failed')
    .map(([k]) => k);

  const degradedBanner = failedSubsystems.length > 0
    ? `<div style="margin:12px 0;padding:8px 12px;background:#fef3c7;border:1px solid #fbbf24;color:#92400e;font-size:12px;border-radius:6px;">
        <strong>Partial degradation:</strong> ${escapeHtml(failedSubsystems.join(', '))} failed to load. Sections backed by these subsystems may be empty.
       </div>`
    : '';

  const ops = brief.operationalWarnings.length > 0
    ? `<h2 style="margin:18px 0 4px 0;font-size:14px;color:#0f172a;">Operational notes</h2>
       <ul style="margin:0 0 0 18px;padding:0;font-size:12px;color:#475569;">
         ${brief.operationalWarnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}
       </ul>`
    : '';

  const sectionsHtml = SECTIONS.map((s) =>
    renderSectionHtml(s.title, s.description, brief[s.key], baseUrl, s.empty),
  ).join('');

  return [
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:720px;color:#0f172a;line-height:1.4;">`,
    `<div style="padding:16px 20px;background:linear-gradient(135deg,#0f172a,#1e293b);color:#e2e8f0;border-radius:8px;">`,
    `<div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.3px;">Admin daily market brief</div>`,
    `<div style="font-size:20px;font-weight:700;margin-top:4px;">${escapeHtml(subject)}</div>`,
    `<div style="font-size:13px;margin-top:8px;color:#cbd5e1;">${headline}</div>`,
    `<div style="font-size:10px;color:#94a3b8;margin-top:6px;">Admin-only situational awareness. Never customer-facing. Not betting advice. No automatic actions are taken from this surface.</div>`,
    `</div>`,
    degradedBanner,
    sectionsHtml,
    ops,
    `<hr style="margin-top:18px;border:none;border-top:1px solid #e2e8f0;" />`,
    `<div style="font-size:10px;color:#94a3b8;margin-top:6px;">Generated ${escapeHtml(generated)}. Prepared for ${escapeHtml(recipient)}. This digest is informational — no markets are created or modified from this page.</div>`,
    `</div>`,
  ].join('\n');
}

export function renderDigestPlainText(
  brief: WeatherMarketDailyBrief,
  options: RenderDigestOptions = {},
): string {
  const baseUrl = options.baseUrl ?? '';
  const recipient = options.recipient ?? DEFAULT_RECIPIENT;
  const subject = buildSubject(brief);
  const failedSubsystems = Object.entries(brief.subsystemStatus)
    .filter(([, h]) => h === 'failed')
    .map(([k]) => k);

  const lines: string[] = [];
  lines.push(subject);
  lines.push('='.repeat(subject.length));
  lines.push('');
  lines.push(brief.summaryHeadline);
  lines.push('');
  if (failedSubsystems.length > 0) {
    lines.push(
      `PARTIAL DEGRADATION: ${failedSubsystems.join(', ')} failed to load. Sections may be empty.`,
    );
    lines.push('');
  }
  for (const s of SECTIONS) {
    lines.push(renderSectionText(s.title, brief[s.key], baseUrl, s.empty));
    lines.push('');
  }
  if (brief.operationalWarnings.length > 0) {
    lines.push('Operational notes');
    lines.push('-'.repeat('Operational notes'.length));
    for (const w of brief.operationalWarnings) lines.push(`  • ${w}`);
    lines.push('');
  }
  const generated = (() => {
    const d = new Date(brief.generatedAt);
    return Number.isNaN(d.getTime()) ? brief.generatedAt : d.toUTCString();
  })();
  lines.push('---');
  lines.push(`Generated ${generated}. Prepared for ${recipient}.`);
  lines.push('Admin-only situational awareness. Never customer-facing. Not betting advice.');
  return lines.join('\n');
}

export function renderDigestPayload(
  brief: WeatherMarketDailyBrief,
  options: RenderDigestOptions = {},
): DigestPayload {
  return {
    subject: buildSubject(brief),
    html: renderDigestHTML(brief, options),
    text: renderDigestPlainText(brief, options),
    generatedAt: brief.generatedAt,
    recipient: options.recipient ?? DEFAULT_RECIPIENT,
  };
}

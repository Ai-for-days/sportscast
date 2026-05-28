// ── Step 161: Crypto paper-trade alert renderer ─────────────────────────
//
// Pure helpers that turn an `AlertPayload` (from the paper-trade
// simulator) into a compact HTML and plaintext body suitable for an
// admin handoff. **Admin-only. No I/O. No mutation. No outbound send.**
//
// No SMTP / SES / SendGrid / Resend / Mailgun / Postmark / nodemailer
// client is configured in this build, so Step 161 ships preview-only.
// The renderer is shaped so any future transport can consume
// `renderCryptoTradeAlertPayload(payload)` without re-rendering.
//
// **Paper trading only. Research only. Not financial advice.**

import type { AlertPayload, AlertAction } from './crypto-paper-portfolio';

// ── Public types ────────────────────────────────────────────────────────────

export interface CryptoAlertRenderedPayload {
  subject: string;
  text: string;
  html: string;
  generatedAt: string;
  /** Defaults to the project owner; never actually delivered from this step. */
  recipient: string;
  /** Echoes payload.action so a downstream caller can branch without parsing. */
  action: AlertAction;
}

export interface RenderCryptoAlertOptions {
  recipient?: string;
}

const DEFAULT_RECIPIENT = 'derek@derekbdavis.com';

const DISCLAIMER = 'Paper trading only. Research only. Not financial advice.';

// ── Helpers ────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(2)}%`;
}

function fmtQty(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function actionLabel(a: AlertAction): string {
  if (a === 'buy') return 'PAPER BUY';
  if (a === 'sell') return 'PAPER SELL';
  if (a === 'trim') return 'PAPER TRIM';
  if (a === 'add') return 'PAPER ADD';
  if (a === 'stop_loss') return 'PAPER STOP-LOSS';
  if (a === 'take_profit') return 'PAPER TAKE-PROFIT';
  if (a === 'blocked') return 'BLOCKED (risk gate)';
  return 'NO-OP';
}

function actionTone(a: AlertAction): { bar: string; chip: string; text: string } {
  if (a === 'blocked') return { bar: '#dc2626', chip: '#b91c1c', text: '#7f1d1d' };
  if (a === 'no_op') return { bar: '#94a3b8', chip: '#475569', text: '#1f2937' };
  if (a === 'buy' || a === 'add') return { bar: '#16a34a', chip: '#15803d', text: '#14532d' };
  return { bar: '#f59e0b', chip: '#b45309', text: '#7c2d12' };
}

function buildSubject(payload: AlertPayload): string {
  const tag =
    payload.action === 'blocked'
      ? `BLOCKED ${payload.symbol}`
      : `${actionLabel(payload.action)} ${payload.symbol}`;
  return `WagerOnWeather paper trade · ${tag}`;
}

// ── HTML renderer ──────────────────────────────────────────────────────────

export function renderCryptoTradeAlertHTML(
  payload: AlertPayload,
  options: RenderCryptoAlertOptions = {},
): string {
  const recipient = options.recipient ?? DEFAULT_RECIPIENT;
  const subject = buildSubject(payload);
  const tone = actionTone(payload.action);
  const generated = (() => {
    const d = new Date(payload.generatedAt);
    return Number.isNaN(d.getTime()) ? payload.generatedAt : d.toUTCString();
  })();

  const blockedBlock = payload.blockedReason
    ? `<tr><td style="padding:4px 6px;color:#7f1d1d;font-weight:600;">Blocked reason</td><td style="padding:4px 6px;color:#7f1d1d;">${escapeHtml(payload.blockedReason)}</td></tr>`
    : '';

  const targets = [
    payload.takeProfit1 != null ? `T1 ${fmtUsd(payload.takeProfit1)}` : null,
    payload.takeProfit2 != null ? `T2 ${fmtUsd(payload.takeProfit2)}` : null,
    payload.takeProfit3 != null ? `T3 ${fmtUsd(payload.takeProfit3)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return [
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:680px;color:#0f172a;line-height:1.45;">`,
    `<div style="padding:16px 20px;background:linear-gradient(135deg,#0f172a,#1e293b);color:#e2e8f0;border-radius:8px;">`,
    `<div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.3px;">Admin paper-trade alert</div>`,
    `<div style="font-size:18px;font-weight:700;margin-top:4px;">${escapeHtml(subject)}</div>`,
    `<div style="margin-top:8px;display:inline-block;padding:4px 10px;border-radius:999px;background:${tone.chip};color:#fff;font-size:11px;font-weight:700;letter-spacing:0.3px;">${escapeHtml(actionLabel(payload.action))}</div>`,
    `<div style="font-size:10px;color:#fbbf24;margin-top:8px;">${escapeHtml(DISCLAIMER)}</div>`,
    `</div>`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;width:100%;border-collapse:collapse;font-size:12px;border-left:4px solid ${tone.bar};">`,
    `<tr><td style="padding:4px 6px;color:#475569;">Symbol</td><td style="padding:4px 6px;color:#0f172a;font-weight:600;">${escapeHtml(payload.symbol)} (${escapeHtml(payload.assetName)})</td></tr>`,
    `<tr><td style="padding:4px 6px;color:#475569;">Model bankroll</td><td style="padding:4px 6px;color:#0f172a;">${fmtUsd(payload.modelBankroll)}</td></tr>`,
    `<tr><td style="padding:4px 6px;color:#475569;">Entry price</td><td style="padding:4px 6px;color:#0f172a;">${fmtUsd(payload.entryPrice)}</td></tr>`,
    `<tr><td style="padding:4px 6px;color:#475569;">Quantity</td><td style="padding:4px 6px;color:#0f172a;">${fmtQty(payload.quantity)}</td></tr>`,
    `<tr><td style="padding:4px 6px;color:#475569;">Position size</td><td style="padding:4px 6px;color:#0f172a;">${fmtUsd(payload.positionValue)}</td></tr>`,
    `<tr><td style="padding:4px 6px;color:#475569;">Risk vs bankroll</td><td style="padding:4px 6px;color:#0f172a;">${fmtPct(payload.riskPct)}</td></tr>`,
    payload.stopLoss != null
      ? `<tr><td style="padding:4px 6px;color:#475569;">Stop loss</td><td style="padding:4px 6px;color:#0f172a;">${fmtUsd(payload.stopLoss)}</td></tr>`
      : '',
    targets
      ? `<tr><td style="padding:4px 6px;color:#475569;">Targets</td><td style="padding:4px 6px;color:#0f172a;">${escapeHtml(targets)}</td></tr>`
      : '',
    `<tr><td style="padding:4px 6px;color:#475569;">Signal score</td><td style="padding:4px 6px;color:#0f172a;">${payload.signalScore} / 100</td></tr>`,
    `<tr><td style="padding:4px 6px;color:#475569;">Confidence</td><td style="padding:4px 6px;color:#0f172a;">${escapeHtml(payload.confidence)}</td></tr>`,
    `<tr><td style="padding:4px 6px;color:#475569;">Updated cash</td><td style="padding:4px 6px;color:#0f172a;">${fmtUsd(payload.updatedCash)}</td></tr>`,
    `<tr><td style="padding:4px 6px;color:#475569;">Updated exposure</td><td style="padding:4px 6px;color:#0f172a;">${fmtPct(payload.updatedExposurePct)}</td></tr>`,
    blockedBlock,
    `<tr><td style="padding:4px 6px;color:#475569;vertical-align:top;">Rationale</td><td style="padding:4px 6px;color:#0f172a;">${escapeHtml(payload.rationale)}</td></tr>`,
    `</table>`,
    `<hr style="margin-top:14px;border:none;border-top:1px solid #e2e8f0;" />`,
    `<div style="font-size:10px;color:#94a3b8;margin-top:6px;">Generated ${escapeHtml(generated)}. Prepared for ${escapeHtml(recipient)}.</div>`,
    `<div style="font-size:10px;color:#94a3b8;">${escapeHtml(DISCLAIMER)} No real funds, exchanges, broker APIs, custody, wallets, or order execution are involved.</div>`,
    `</div>`,
  ].join('\n');
}

// ── Plaintext renderer ─────────────────────────────────────────────────────

export function renderCryptoTradeAlertPlainText(
  payload: AlertPayload,
  options: RenderCryptoAlertOptions = {},
): string {
  const recipient = options.recipient ?? DEFAULT_RECIPIENT;
  const subject = buildSubject(payload);
  const lines: string[] = [];
  lines.push(subject);
  lines.push('='.repeat(subject.length));
  lines.push('');
  lines.push(DISCLAIMER);
  lines.push('');
  lines.push(`Action            : ${actionLabel(payload.action)}`);
  lines.push(`Symbol            : ${payload.symbol} (${payload.assetName})`);
  lines.push(`Model bankroll    : ${fmtUsd(payload.modelBankroll)}`);
  lines.push(`Entry price       : ${fmtUsd(payload.entryPrice)}`);
  lines.push(`Quantity          : ${fmtQty(payload.quantity)}`);
  lines.push(`Position size     : ${fmtUsd(payload.positionValue)}`);
  lines.push(`Risk vs bankroll  : ${fmtPct(payload.riskPct)}`);
  if (payload.stopLoss != null) lines.push(`Stop loss         : ${fmtUsd(payload.stopLoss)}`);
  if (payload.takeProfit1 != null) lines.push(`Take profit 1     : ${fmtUsd(payload.takeProfit1)}`);
  if (payload.takeProfit2 != null) lines.push(`Take profit 2     : ${fmtUsd(payload.takeProfit2)}`);
  if (payload.takeProfit3 != null) lines.push(`Take profit 3     : ${fmtUsd(payload.takeProfit3)}`);
  lines.push(`Signal score      : ${payload.signalScore} / 100`);
  lines.push(`Confidence        : ${payload.confidence}`);
  lines.push(`Updated cash      : ${fmtUsd(payload.updatedCash)}`);
  lines.push(`Updated exposure  : ${fmtPct(payload.updatedExposurePct)}`);
  if (payload.blockedReason) lines.push(`Blocked reason    : ${payload.blockedReason}`);
  lines.push('');
  lines.push('Rationale:');
  lines.push(`  ${payload.rationale}`);
  lines.push('');
  const generated = (() => {
    const d = new Date(payload.generatedAt);
    return Number.isNaN(d.getTime()) ? payload.generatedAt : d.toUTCString();
  })();
  lines.push('---');
  lines.push(`Generated ${generated}. Prepared for ${recipient}.`);
  lines.push(
    `${DISCLAIMER} No real funds, exchanges, broker APIs, custody, wallets, or order execution are involved.`,
  );
  return lines.join('\n');
}

// ── Envelope ──────────────────────────────────────────────────────────────

export function renderCryptoTradeAlertPayload(
  payload: AlertPayload,
  options: RenderCryptoAlertOptions = {},
): CryptoAlertRenderedPayload {
  return {
    subject: buildSubject(payload),
    text: renderCryptoTradeAlertPlainText(payload, options),
    html: renderCryptoTradeAlertHTML(payload, options),
    generatedAt: payload.generatedAt,
    recipient: options.recipient ?? DEFAULT_RECIPIENT,
    action: payload.action,
  };
}

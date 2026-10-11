// Email delivery for operator alerts, via Resend (2026-10-11, per Derek).
//
// Why this exists: alerts were only ever written to Redis. On 2026-10-11 the
// store held 3,831 critical "ESPN is not answering" alerts covering a 26-day
// outage (2026-09-15 to 2026-10-11), every one still `open`, and not a single
// alert of any kind had been acknowledged since 09-01. The alarm worked; it
// just had no way to reach a person. An alarm nobody receives is a log.
//
// Two channels, both deliberately quiet, because a noisy channel gets muted
// and then the real one is muted with it:
//
//   Immediate: the first critical alert for a given (type, source) sends one
//   email, then that pair is silent for 24 hours. ESPN and Open-Meteo both
//   FLAP (short failure streaks that reset on the next success), so "email per
//   alert" would have meant ~150 emails a day during the ESPN outage.
//
//   Daily digest (/api/cron/alert-digest, 12:00 UTC = 8am ET): sent ONLY when
//   something alerted in the last 24 hours. Counts per source, first and last
//   time, the latest message, and each source's status right now. A flapping
//   outage reads as "143 alerts in the last 24 hours" on its first morning.
//
// Configuration (Vercel env, server-side, NOT `PUBLIC_`):
//   RESEND_API_KEY   from resend.com > API Keys. Without it nothing is sent.
//   ALERT_EMAIL_TO   recipient(s), comma-separated.
//   ALERT_EMAIL_FROM optional. Defaults to Resend's shared sender, which can
//                    only deliver to the email that owns the Resend account.
//                    Set it to an address on a domain verified in Resend to
//                    send anywhere.
//
// Never throws: a failed email must not break the cron or request that raised
// the alert. Failures are recorded on the `resend` health row (record-only, so
// a broken mail path cannot try to email about itself).

import { getRedis } from './redis';
import type { Alert } from './alerts';
import { recordSourceFailure, recordSourceSuccess, type SourceHealthRecord } from './data-source-health';
import { formatEasternDMYTime } from './date-format';

const RESEND_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'Wager on Weather Alerts <onboarding@resend.dev>';
const SITE = 'https://wageronweather.com';

/** One immediate email per (type, source) per this window. */
export const IMMEDIATE_EMAIL_WINDOW_SECONDS = 24 * 3600;

function env(name: string): string {
  return ((import.meta.env as any)?.[name] ?? process.env[name] ?? '').toString().trim();
}

export function alertEmailConfigured(): boolean {
  return !!env('RESEND_API_KEY') && !!env('ALERT_EMAIL_TO');
}

/** Send one plain-text email. Returns whether Resend accepted it. */
export async function sendAlertEmail(subject: string, text: string): Promise<boolean> {
  const apiKey = env('RESEND_API_KEY');
  const to = env('ALERT_EMAIL_TO').split(',').map((s) => s.trim()).filter(Boolean);
  if (!apiKey || !to.length) return false;
  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env('ALERT_EMAIL_FROM') || DEFAULT_FROM, to, subject, text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[alert-email] Resend ${res.status}: ${body.slice(0, 300)}`);
      await recordSourceFailure('resend', `${res.status} ${body.slice(0, 200)}`);
      return false;
    }
    await recordSourceSuccess('resend');
    return true;
  } catch (err) {
    console.error('[alert-email] Resend request failed', err);
    await recordSourceFailure('resend', String(err));
    return false;
  }
}

function immediateKey(alert: Alert): string {
  return `alert-email:immediate:${alert.type}:${alert.metadata?.source ?? '-'}`;
}

/** Email a newly raised critical alert, unless its (type, source) emailed in the last 24h. */
export async function emailCriticalAlert(alert: Alert): Promise<void> {
  if (alert.severity !== 'critical' || !alertEmailConfigured()) return;
  try {
    const claimed = await getRedis().set(immediateKey(alert), alert.id, { nx: true, ex: IMMEDIATE_EMAIL_WINDOW_SECONDS });
    if (claimed !== 'OK') return;
  } catch {
    return; // no Redis means no throttle; skip rather than risk a flood
  }
  const link = alert.link ? `${SITE}${alert.link}` : `${SITE}/admin/system/health`;
  await sendAlertEmail(
    `[Wager on Weather] ${alert.title}`,
    [
      alert.message,
      '',
      `Raised ${formatEasternDMYTime(alert.createdAt)} ET. Details: ${link}`,
      '',
      'Further alerts of this kind are not emailed for 24 hours; the 8am ET daily digest reports whether it is still happening.',
    ].join('\n'),
  );
}

export interface DigestGroup {
  key: string;
  title: string;
  severity: string;
  count: number;
  firstAt: string;
  lastAt: string;
  latestMessage: string;
}

/** Group the last day's alerts by (type, source), most frequent first. Pure, for tests. */
export function groupAlertsForDigest(alerts: Alert[]): DigestGroup[] {
  const groups = new Map<string, DigestGroup>();
  for (const a of alerts) {
    const key = `${a.type}:${a.metadata?.source ?? '-'}`;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { key, title: a.title, severity: a.severity, count: 1, firstAt: a.createdAt, lastAt: a.createdAt, latestMessage: a.message });
      continue;
    }
    g.count++;
    if (a.createdAt < g.firstAt) g.firstAt = a.createdAt;
    if (a.createdAt > g.lastAt) { g.lastAt = a.createdAt; g.latestMessage = a.message; g.title = a.title; }
  }
  return [...groups.values()].sort((x, y) => y.count - x.count);
}

/** The digest email, or null when nothing alerted (no email on a quiet day). Pure, for tests. */
export function buildDigest(alerts: Alert[], sources: SourceHealthRecord[]): { subject: string; text: string } | null {
  const groups = groupAlertsForDigest(alerts);
  if (!groups.length) return null;
  const total = groups.reduce((s, g) => s + g.count, 0);
  const lines: string[] = [`${total} alert(s) in the last 24 hours, ${groups.length} distinct problem(s).`, ''];
  for (const g of groups) {
    lines.push(`${g.severity.toUpperCase()}: ${g.title}`);
    lines.push(`  ${g.count} time(s), ${formatEasternDMYTime(g.firstAt)} to ${formatEasternDMYTime(g.lastAt)} ET`);
    lines.push(`  ${g.latestMessage}`);
    lines.push('');
  }
  lines.push('Upstream sources right now:');
  for (const s of sources) {
    const status = s.status === 'ok' ? 'answering' : s.status;
    lines.push(`  ${s.label}: ${status}${s.consecutiveFailures ? ` (${s.consecutiveFailures} failures in a row)` : ''}`);
  }
  lines.push('', `Health page: ${SITE}/admin/system/health`);
  const worst = groups.some((g) => g.severity === 'critical') ? 'critical' : 'warning';
  return { subject: `[Wager on Weather] Daily alert digest: ${total} ${worst} alert(s)`, text: lines.join('\n') };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDigest, groupAlertsForDigest, alertEmailConfigured, IMMEDIATE_EMAIL_WINDOW_SECONDS } from '../src/lib/alert-email';
import { alertsOnFailure } from '../src/lib/data-source-health';

// 2026-10-11: 3,831 ESPN alerts over a 26-day outage, all unread, because
// alerts were only written to Redis. These pin that the email path is quiet
// enough to stay read: grouped, counted, and silent on a quiet day.

const alert = (source: string, at: string, title = `${source} is not answering`) => ({
  id: `${source}-${at}`, createdAt: at, severity: 'critical' as const, type: 'data_source_dark',
  title, message: `${source} failed`, status: 'open' as const, metadata: { source },
});

test('a quiet day sends no digest at all', () => {
  assert.equal(buildDigest([], []), null);
});

test('a flapping outage reads as one problem with a count, not 150 lines', () => {
  const espn = Array.from({ length: 143 }, (_, i) => alert('espn', new Date(Date.UTC(2026, 9, 10, 0, i * 10)).toISOString()));
  const groups = groupAlertsForDigest([...espn, alert('open-meteo', '2026-10-10T05:00:00Z')]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].count, 143);
  assert.equal(groups[0].firstAt, espn[0].createdAt);
  assert.equal(groups[0].lastAt, espn.at(-1)!.createdAt);
});

test('two sources sharing an alert type stay separate', () => {
  const groups = groupAlertsForDigest([alert('espn', '2026-10-10T01:00:00Z'), alert('open-meteo', '2026-10-10T01:05:00Z')]);
  assert.equal(groups.length, 2);
});

test('the digest names the count and links the health page', () => {
  const d = buildDigest([alert('espn', '2026-10-10T01:00:00Z'), alert('espn', '2026-10-10T02:00:00Z')], [
    { source: 'espn', label: 'ESPN scoreboard', consecutiveFailures: 0, status: 'ok' },
  ] as any)!;
  assert.match(d.subject, /2 critical alert/);
  assert.match(d.text, /2 time\(s\)/);
  assert.match(d.text, /ESPN scoreboard: answering/);
  assert.match(d.text, /\/admin\/system\/health/);
  assert.ok(!d.text.includes('—'));
});

test('an immediate email repeats at most once a day per problem', () => {
  assert.equal(IMMEDIATE_EMAIL_WINDOW_SECONDS, 86400);
});

test('nothing is sent until both the key and the recipient are set', () => {
  assert.equal(alertEmailConfigured(), !!process.env.RESEND_API_KEY && !!process.env.ALERT_EMAIL_TO);
});

test('a broken email path never tries to email about itself', () => {
  assert.equal(alertsOnFailure('resend'), false);
});

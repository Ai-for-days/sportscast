import test from 'node:test';
import assert from 'node:assert/strict';
import { statusFor, FAILURE_ALERT_THRESHOLD, DATA_SOURCE_LABELS } from '../src/lib/data-source-health';

// ── The alarm for a fallback that is working ──────────────────────────────
//
// Two outages in one evening on 2026-08-29 shared a shape: an upstream went
// dark, a fallback caught it, and nobody was told. ESPN 403'd for hours and
// surfaced only when Derek asked for a feature that already existed;
// Open-Meteo rate-limited us and its fallback invented forecasts the market
// engines then priced against.
//
// The thresholds are the whole design, so they are pinned here. Everything
// else in that module is Redis bookkeeping that must never throw.

test('one failure is noise, not an outage', () => {
  // Every upstream blips. Alerting on the first one trains operators to
  // ignore the alert, which is worse than not having it.
  assert.equal(statusFor(1, true), 'degraded');
  assert.equal(statusFor(2, true), 'degraded');
});

test('the third consecutive failure is an outage', () => {
  assert.equal(statusFor(FAILURE_ALERT_THRESHOLD, true), 'dark');
  assert.equal(statusFor(FAILURE_ALERT_THRESHOLD + 5, true), 'dark');
});

test('a success clears the streak', () => {
  assert.equal(statusFor(0, true), 'ok');
});

test('never-seen is reported as unknown, not as healthy', () => {
  // A source we have never successfully reached must not read green. That is
  // the state a brand-new deployment starts in, and it is also what a source
  // that has been dark past its record TTL looks like.
  assert.equal(statusFor(0, false), 'unknown');
});

test('every tracked source has an operator-readable label', () => {
  // The alert text is built from these; a raw key like "espn-primary-host" in
  // an alert title is how an alarm gets ignored.
  for (const [source, label] of Object.entries(DATA_SOURCE_LABELS)) {
    assert.ok(label.length > 0, `${source} has no label`);
    assert.notEqual(label, source, `${source} needs a human label, not its key`);
  }
});

test('the ESPN mirror is tracked separately from ESPN itself', () => {
  // The canonical host was blocked while the mirror served every request, so
  // the site looked fine. That state has to be visible on its own, otherwise
  // the early warning is indistinguishable from full health.
  assert.ok('espn' in DATA_SOURCE_LABELS);
  assert.ok('espn-primary-host' in DATA_SOURCE_LABELS);
});

// ── An absence of coverage is not an outage ───────────────────────────────

import { isNwsOutageStatus } from '../src/lib/nws-forecast';

test('an NWS 404 is coverage, not an outage', () => {
  // api.weather.gov is US-only and answers a location it does not cover with
  // a 404. Four tracked venues sit outside it (Rogers Centre and the three
  // Canadian MLS sides). Counting those would page an operator about NWS
  // being down every time someone opened a Toronto page.
  assert.equal(isNwsOutageStatus(404), false);
});

test('every other NWS failure status counts', () => {
  for (const status of [500, 502, 503, 504, 429, 403, 401]) {
    assert.equal(isNwsOutageStatus(status), true, `${status} should count as an outage`);
  }
});

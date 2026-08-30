// One place to talk to ESPN's free, keyless scoreboard API.
//
// Why this exists (2026-08-29): ESPN answered every scoreboard request from
// our Vercel egress with 403 Forbidden, continuously, for hours. Confirmed in
// production logs on opening Saturday of the college football season:
//
//   [venue-schedule] ESPN fetch 403 Forbidden: .../football/college-football/...
//   [venue-schedule] ESPN fetch 403 Forbidden: .../football/nfl/...
//   [venue-schedule] ESPN fetch 403 Forbidden: .../soccer/usa.1/...
//
// Nothing looked broken from the outside, because both callers degrade
// quietly: the Weatherboard fell through to The Odds API (which carries a
// score but no period or clock, so live games read a bare "In Progress"),
// and /college-football-weather and /nfl-weather rendered their no-games
// state mid-slate. MLB was unaffected throughout, because it goes to the MLB
// Stats API instead — which is exactly why only MLB still showed innings.
//
// Two changes, both narrow:
//
//   Browser-shaped request headers. The old `WagerOnWeather/1.0` user agent
//   from a datacenter IP is the shape ESPN's edge rejects.
//
//   A second host. site.web.api.espn.com serves the SAME paths with the SAME
//   response shape as site.api.espn.com (verified 2026-08-29 against a live
//   game: HAW @ STAN came back state=in, period 4, clock 2:41 on both), so
//   it is a drop-in second attempt rather than a different integration.
//
// This does not make ESPN reliable, it just stops one blocked edge from
// taking every non-MLB live score off the site. Both callers keep their own
// fallbacks for when every attempt here fails.

import { recordSourceSuccess, recordSourceFailure } from './data-source-health';

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

/** Tried in order. The first is ESPN's canonical host; the second is its mirror. */
const SCOREBOARD_HOSTS = ['site.api.espn.com', 'site.web.api.espn.com'] as const;

const DEFAULT_TIMEOUT_MS = 8000;

/**
 * The scoreboard URL for one host. Exported for tests, which pin the host
 * order and the path shape rather than making a network call.
 */
export function espnScoreboardUrl(host: string, leaguePath: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return `https://${host}/apis/site/v2/sports/${leaguePath}/scoreboard${qs ? `?${qs}` : ''}`;
}

/**
 * Fetch one league's scoreboard, trying each host in turn. Returns the parsed
 * JSON body of the first host that answers 200, or null when every host
 * fails — never throws, so a caller's page still renders.
 *
 * `logTag` names the calling module in the log line, since two different
 * callers hit this and their failure modes look identical otherwise.
 */
export async function fetchEspnScoreboard(
  leaguePath: string,
  params: Record<string, string>,
  logTag: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<any | null> {
  for (let i = 0; i < SCOREBOARD_HOSTS.length; i++) {
    const host = SCOREBOARD_HOSTS[i];
    const url = espnScoreboardUrl(host, leaguePath, params);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': BROWSER_UA,
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          Referer: 'https://www.espn.com/',
        },
      });
      clearTimeout(timer);
      if (!res.ok) {
        console.error(`[${logTag}] ESPN ${res.status} ${res.statusText} via ${host}: ${url}`);
        // The canonical host being blocked is tracked on its own. It has no
        // customer-visible effect while the mirror answers, which is exactly
        // why it needs recording: it is the early warning for ESPN going
        // fully dark, and it was true and unreported for hours on 2026-08-29.
        if (i === 0) await recordSourceFailure('espn-primary-host', `${res.status} ${res.statusText}`, 'warning');
        continue;
      }
      const data = await res.json();
      // Worth a line: it means the canonical host is blocking us again and
      // the mirror is the only reason live scores are on the site at all.
      if (i > 0) console.warn(`[${logTag}] ESPN served by fallback host ${host}: ${leaguePath}`);
      await recordSourceSuccess('espn');
      if (i === 0) await recordSourceSuccess('espn-primary-host');
      return data;
    } catch (err) {
      console.error(`[${logTag}] ESPN fetch threw via ${host}: ${url}`, err);
    }
  }
  // Every host refused. Whoever called this is about to degrade quietly, so
  // this is the last place that can say so out loud.
  await recordSourceFailure('espn', `every host refused ${leaguePath}`);
  return null;
}

/**
 * Which vocabulary a league counts its periods in. Football counts quarters,
 * soccer counts halves; nothing else here uses ESPN's period field (MLB comes
 * from the MLB Stats API, with innings and a half-inning instead).
 */
export type EspnPeriodStyle = 'football' | 'soccer';

/**
 * "Point in the game" for an ESPN-sourced league — "Q3 6:49", "2nd Half 71:12".
 *
 * Built from the structured `status.period` + `status.displayClock` rather than
 * parsing `shortDetail` text, which is sometimes a bare "In Progress" when the
 * upstream feed has not populated the period and clock yet. Returns null when
 * there is no real period to report, so a caller can fall back to whatever
 * status text it has rather than render a half-empty badge.
 */
export function formatLivePeriodClock(
  style: EspnPeriodStyle,
  period: number | undefined,
  displayClock: string | undefined,
): string | null {
  if (!period || period < 1) return null;
  // ESPN reports 0:00 both at a period break and before the clock starts;
  // either way the period alone is the honest label.
  const clock = displayClock && displayClock !== '0:00' ? ` ${displayClock}` : '';
  if (style === 'football') return period <= 4 ? `Q${period}${clock}` : `OT${clock}`;
  if (period === 1) return `1st Half${clock}`;
  if (period === 2) return `2nd Half${clock}`;
  return `ET${clock}`;
}

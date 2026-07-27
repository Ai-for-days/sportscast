// Shared client-side forecast payload.
//
// Problem this solves: the ZIP forecast page mounts ~9 `client:only` React
// islands that each need the full `hourly` (and some the `daily`) forecast
// array. Astro serializes every island's props into the HTML, so the same
// ~200 KB forecast array was written into the page ~9–10 times — ballooning
// each ZIP page to ~1.9 MB of duplicated, HTML-escaped JSON that renders NO
// server content (the islands are client-only) and burns Google's crawl
// budget on a low-authority domain.
//
// Fix: the page emits the forecast arrays ONCE inside
// `<script type="application/json" id="wow-forecast-data">`. Islands read
// their hourly/daily from here instead of from props. Props still win when
// provided, so other pages (map, /forecast/[location]) that pass the arrays
// inline keep working unchanged.

type Payload = { hourly: unknown[]; daily: unknown[]; current: unknown | null };

let cache: Payload | null = null;

const EMPTY: Payload = { hourly: [], daily: [], current: null };

function readPayload(): Payload {
  if (cache) return cache;
  if (typeof document === 'undefined') return EMPTY;
  const el = document.getElementById('wow-forecast-data');
  if (!el || !el.textContent) {
    cache = { ...EMPTY };
    return cache;
  }
  try {
    const parsed = JSON.parse(el.textContent) as { hourly?: unknown[]; daily?: unknown[]; current?: unknown };
    cache = { hourly: parsed.hourly ?? [], daily: parsed.daily ?? [], current: parsed.current ?? null };
  } catch {
    cache = { ...EMPTY };
  }
  return cache;
}

/** Return the caller's `hourly` prop if it has data, else the shared payload's hourly. */
export function sharedHourly<T = unknown>(prop?: T[] | null): T[] {
  if (prop && prop.length) return prop;
  return readPayload().hourly as T[];
}

/** Return the caller's `daily` prop if it has data, else the shared payload's daily. */
export function sharedDaily<T = unknown>(prop?: T[] | null): T[] {
  if (prop && prop.length) return prop;
  return readPayload().daily as T[];
}

/**
 * Return the caller's `current` prop if provided, else the shared payload's current
 * observation. Islands that label a value "Now" must use this rather than `hourly[0]`
 * — the first hourly point is the current HOUR's model value, which is a different
 * number and made the trend card read 90° while the hero read 93°.
 */
export function sharedCurrent<T = unknown>(prop?: T | null): T | null {
  if (prop) return prop;
  return (readPayload().current as T) ?? null;
}

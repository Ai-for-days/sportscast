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

let cache: { hourly: unknown[]; daily: unknown[] } | null = null;

function readPayload(): { hourly: unknown[]; daily: unknown[] } {
  if (cache) return cache;
  if (typeof document === 'undefined') return { hourly: [], daily: [] };
  const el = document.getElementById('wow-forecast-data');
  if (!el || !el.textContent) {
    cache = { hourly: [], daily: [] };
    return cache;
  }
  try {
    const parsed = JSON.parse(el.textContent) as { hourly?: unknown[]; daily?: unknown[] };
    cache = { hourly: parsed.hourly ?? [], daily: parsed.daily ?? [] };
  } catch {
    cache = { hourly: [], daily: [] };
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

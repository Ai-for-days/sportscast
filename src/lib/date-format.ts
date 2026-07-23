// Site-wide human date formatting.
//
// Every calendar date shown to a user renders as DD-MM-YYYY (e.g. 01-01-2026):
// numeric, day first, dash-separated. Date+time values render as
// "DD-MM-YYYY, h:mm AM/PM" (with an optional trailing zone label like "ET").
//
// Do NOT use these for machine-readable values (ISO strings, <time datetime>,
// JSON/API payloads, sitemap lastmod, data-* attributes, or YYYY-MM-DD lookup
// keys) — those must stay in their canonical form.

type DateInput = Date | string | number;

function toDate(input: DateInput): Date | null {
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "01-01-2026" (DD-MM-YYYY). Empty string for an invalid date. */
export function formatDMY(input: DateInput, timeZone?: string): string {
  const d = toDate(input);
  if (!d) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    ...(timeZone ? { timeZone } : {}),
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}-${get('month')}-${get('year')}`;
}

/** "01-01-2026, 10:04 PM" (+ optional zone label). Empty string for an invalid date. */
export function formatDMYTime(
  input: DateInput,
  opts?: { timeZone?: string; zoneLabel?: string },
): string {
  const d = toDate(input);
  if (!d) return '';
  const date = formatDMY(d, opts?.timeZone);
  const time = new Intl.DateTimeFormat('en-US', {
    ...(opts?.timeZone ? { timeZone: opts.timeZone } : {}),
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
  return `${date}, ${time}${opts?.zoneLabel ? ` ${opts.zoneLabel}` : ''}`;
}

/** Eastern-time "DD-MM-YYYY, h:mm PM ET" — replaces the old inline admin formatET. */
export function formatEasternDMYTime(input: DateInput): string {
  return formatDMYTime(input, { timeZone: 'America/New_York', zoneLabel: 'ET' });
}

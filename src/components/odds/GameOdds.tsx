// Every market for one game, in tabs (2026-10-13).
//
// Ported from Derek's Practice Sportsbook (Documents\Scrapers\sportsbook,
// static/index.html renderEvent): the tabs are the feed's own groups in the
// feed's order ("All" first), so a market family the book adds shows up with
// no code change; a search box filters markets, periods and player names;
// each two- or three-way market shows its hold, and hovering a price shows
// its no-vig fair odds. New here: a line-movement chart per market, from the
// snapshots /api/odds/ingest records on every price change.
//
// Read-only. No bet buttons, no links out (Derek, 2026-10-13).

import { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useChartTheme } from '../forecast/useChartTheme';
import { fairAmerican, holdPercent, parseAmerican, type FeedGroup, type FeedMarket, type FeedOutcome, type HistoryPoint } from '../../lib/odds-feed';

interface Props {
  gameId: string;
  groups: FeedGroup[];
  awayName: string;
  homeName: string;
}

const PLAIN_PERIOD = /^(game|match|live game|regulation time|live regulation time)$/i;
const ET = 'America/New_York';

function american(v: string | null | undefined): string {
  const n = parseAmerican(v);
  if (n === null) return '—';
  return n > 0 ? `+${n}` : String(n);
}

function lineLabel(o: FeedOutcome, m: FeedMarket): string {
  const h = o.price.handicap;
  if (h === null || h === undefined || h === '') return '';
  if (o.type === 'O') return `O ${h}`;
  if (o.type === 'U') return `U ${h}`;
  if (/OU/i.test(m.key ?? '') || /total/i.test(m.description)) return h;
  const n = Number(h);
  return Number.isFinite(n) && n > 0 ? `+${h}` : h;
}

const SERIES_COLORS = ['#2563eb', '#dc2626', '#16a34a'];

function MarketChart({ gameId, market }: { gameId: string; market: FeedMarket }) {
  const theme = useChartTheme();
  const [points, setPoints] = useState<HistoryPoint[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(`/api/odds/history?id=${encodeURIComponent(gameId)}&market=${encodeURIComponent(market.id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => alive && setPoints(j.points ?? []))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [gameId, market.id]);

  // Chart the line when the market has one (spread, total), else the price.
  const outcomes = market.outcomes.slice(0, 3);
  const byLine = outcomes.some((o) => o.price.handicap);
  const data = useMemo(
    () =>
      (points ?? []).map(([t, outs]) => {
        const row: Record<string, number | null> = { t };
        // Series keys are s0..s2, not outcome ids: recharts reads a dotted
        // dataKey as a nested path, and feed ids contain dots.
        outcomes.forEach((o, i) => {
          const hit = outs.find(([id]) => id === o.id);
          row[`s${i}`] = hit ? (byLine && hit[2] !== null ? Number(hit[2]) : parseAmerican(hit[1])) : null;
        });
        return row;
      }),
    [points],
  );

  if (error) return <p className="text-xs text-text-muted dark:text-text-dark-muted">Line history is unavailable right now.</p>;
  if (!points) return <p className="text-xs text-text-muted dark:text-text-dark-muted">Loading line history…</p>;
  if (points.length < 2) {
    return <p className="text-xs text-text-muted dark:text-text-dark-muted">No movement recorded yet ({points.length} snapshot{points.length === 1 ? '' : 's'}).</p>;
  }
  const fmtTime = (t: number) => new Date(t).toLocaleString('en-US', { timeZone: ET, month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return (
    <div className="mt-2">
      <div className="h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" />
            <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={fmtTime} tick={{ fill: theme.tickSecondary, fontSize: 10 }} stroke={theme.axis} />
            <YAxis tick={{ fill: theme.tickSecondary, fontSize: 10 }} stroke={theme.axis} domain={['auto', 'auto']} />
            <Tooltip
              labelFormatter={(t) => `${fmtTime(Number(t))} ET`}
              contentStyle={{ background: theme.tooltipBg, border: 'none', color: theme.tooltipText, fontSize: 12 }}
              formatter={(v: any, key: any) => [byLine ? v : v > 0 ? `+${v}` : v, outcomes[Number(String(key).slice(1))]?.description ?? key]}
            />
            {outcomes.map((o, i) => (
              <Line key={o.id} dataKey={`s${i}`} type="stepAfter" dot={false} strokeWidth={2} stroke={SERIES_COLORS[i]} connectNulls isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[11px] text-text-muted dark:text-text-dark-muted">
        {byLine ? 'Line' : 'Price'} by snapshot, {points.length} snapshots, times ET.{' '}
        {outcomes.map((o, i) => (
          <span key={o.id} className="mr-2" style={{ color: SERIES_COLORS[i] }}>■ {o.description}</span>
        ))}
      </p>
    </div>
  );
}

function MarketCard({ gameId, market }: { gameId: string; market: FeedMarket }) {
  const [open, setOpen] = useState(false);
  const hold = holdPercent(market);
  const period = market.period?.description && !PLAIN_PERIOD.test(market.period.description) ? market.period.description : null;
  const suspended = (market.status ?? 'O') !== 'O';
  return (
    <div className="rounded-lg border border-border bg-surface p-3 dark:border-border-dark dark:bg-surface-dark-alt">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-semibold text-text dark:text-text-dark">
          {market.description}
          {period && <span className="font-normal text-text-muted dark:text-text-dark-muted"> · {period}</span>}
          {suspended && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">Suspended</span>}
        </div>
        {hold !== null && (
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${hold < 4.6 ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}
            title="The book's margin on this market. Lower means fairer prices."
          >
            Hold {hold.toFixed(1)}%
          </span>
        )}
      </div>
      <div className={`mt-2 grid gap-1.5 ${market.outcomes.length <= 3 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'}`}>
        {market.outcomes.map((o) => {
          const fair = fairAmerican(market, o);
          const off = (o.status ?? 'O') !== 'O' || suspended;
          return (
            <div
              key={o.id}
              className={`flex items-center justify-between gap-2 rounded border border-border px-2 py-1.5 text-xs dark:border-border-dark ${off ? 'opacity-50' : ''}`}
              title={fair !== null ? `No-vig fair odds ${fair > 0 ? '+' : ''}${fair}` : undefined}
            >
              <span className="min-w-0 truncate text-text dark:text-text-dark">
                {o.description}
                {lineLabel(o, market) && <span className="ml-1 text-text-muted dark:text-text-dark-muted">{lineLabel(o, market)}</span>}
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-text dark:text-text-dark">{american(o.price.american)}</span>
            </div>
          );
        })}
      </div>
      <button type="button" onClick={() => setOpen(!open)} className="mt-2 text-[11px] font-medium text-blue-700 hover:underline dark:text-blue-400">
        {open ? 'Hide line movement' : 'Line movement'}
      </button>
      {open && <MarketChart gameId={gameId} market={market} />}
    </div>
  );
}

export default function GameOdds({ gameId, groups, awayName, homeName }: Props) {
  const tabs = useMemo(() => ['All', ...groups.filter((g) => g.markets.length).map((g) => g.description)], [groups]);
  const [tab, setTab] = useState('All');
  const [q, setQ] = useState('');
  const markets = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return groups
      .filter((g) => tab === 'All' || g.description === tab)
      // A market can sit in two groups under the same id (6 of 175 on one NFL
      // game), so the card key carries the group too.
      .flatMap((g) => g.markets.map((m) => ({ m, key: `${g.description}|${m.id}` })))
      .filter(({ m }) => !needle || `${m.description} ${m.period?.description ?? ''} ${m.outcomes.map((o) => o.description).join(' ')}`.toLowerCase().includes(needle));
  }, [groups, tab, q]);
  const total = groups.reduce((n, g) => n + g.markets.length, 0);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search markets or players"
          aria-label={`Search the ${total} markets for ${awayName} at ${homeName}`}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text sm:w-72 dark:border-border-dark dark:bg-surface-dark-alt dark:text-text-dark"
        />
        <span className="text-xs text-text-muted dark:text-text-dark-muted">Hover a price for its no-vig fair odds. Hold is the book's margin; lower is fairer.</span>
      </div>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="tablist">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${tab === t ? 'border-field bg-field text-white' : 'border-border text-text hover:border-field/40 dark:border-border-dark dark:text-text-dark'}`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {markets.map(({ m, key }) => (
          <MarketCard key={key} gameId={gameId} market={m} />
        ))}
      </div>
      {markets.length === 0 && <p className="mt-6 text-sm text-text-muted dark:text-text-dark-muted">No markets match.</p>}
    </div>
  );
}

// Every market for one game, in tabs (2026-10-13).
//
// Ported from Derek's Practice Sportsbook (Documents\Scrapers\sportsbook,
// static/index.html renderEvent): the tabs are the feed's own groups in the
// feed's order ("All" first), so a market family the book adds shows up with
// no code change; a search box filters markets, periods and player names;
// New here: a line-movement chart per market, from the snapshots
// /api/odds/ingest records on every price change.
//
// 2026-10-13 (Derek): read-only, no bet buttons, no links out.
// 2026-11-20 (DBD, WOW-038) reverses that: prices are buttons. Signed out, a
// click opens the sign-up prompt in place. Signed in, a click shows a note
// (sportsbook bets are not graded yet, WOW-036), and never adds to a bet slip.
// After kickoff prices do nothing. The hold % and no-vig odds are gone (DBD:
// "why is the hold percentage visible?"), and in-game ("Live ...") and
// suspended markets are hidden (src/lib/public-odds.ts).

import { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useChartTheme } from '../forecast/useChartTheme';
import GameWagerGrid from '../public/GameWagerGrid';
import type { PublicWagerView } from '../../lib/public-wager-view';
import { parseAmerican, type FeedGroup, type FeedMarket, type FeedOutcome, type HistoryPoint } from '../../lib/odds-feed';
import { publicGroups, priceClick, GRADING_NOTE } from '../../lib/public-odds';
import { useSignedIn } from '../../lib/client/use-signed-in';
import SignUpPrompt from '../auth/SignUpPrompt';

interface Props {
  gameId: string;
  groups: FeedGroup[];
  awayName: string;
  homeName: string;
  /** Our weather markets for this game, shown as the last tab (DBD 2026-11-18). Omitted: no tab. */
  weatherWagers?: PublicWagerView[];
  /** Kickoff, epoch ms. After it, prices are shown but do nothing. */
  startTime?: number | null;
}

const WEATHER_TAB = 'Wager on Weather';

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
  // A spread or total can sit on the same number for days while its price
  // moves (-108 to -112), and a line-only chart drew that as two flat lines
  // (found 2026-11-11 on Commanders at Giants: 5 snapshots, all price moves).
  // So a market with a line also offers its price, and the tooltip shows both.
  const outcomes = market.outcomes.slice(0, 3);
  const hasLine = outcomes.some((o) => o.price.handicap);
  const [showPrice, setShowPrice] = useState(false);
  const byLine = hasLine && !showPrice;
  const data = useMemo(
    () =>
      (points ?? []).map(([t, outs]) => {
        const row: Record<string, number | string | null> = { t };
        // Series keys are s0..s2, not outcome ids: recharts reads a dotted
        // dataKey as a nested path, and feed ids contain dots.
        outcomes.forEach((o, i) => {
          const hit = outs.find(([id]) => id === o.id);
          row[`s${i}`] = hit ? (byLine && hit[2] !== null ? Number(hit[2]) : parseAmerican(hit[1])) : null;
          // The other half of the quote, for the tooltip.
          row[`p${i}`] = hit ? american(hit[1]) : null;
          row[`l${i}`] = hit && hit[2] !== null ? String(hit[2]) : null;
        });
        return row;
      }),
    [points, byLine],
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
              formatter={(v: any, key: any, item: any) => {
                const i = Number(String(key).slice(1));
                const row = item?.payload ?? {};
                const line = row[`l${i}`];
                const price = row[`p${i}`];
                const o = outcomes[i];
                // Same formatting as the price buttons: "+2.5", "O 41.0".
                const lineText = o && line !== null && line !== undefined ? lineLabel({ ...o, price: { ...o.price, handicap: line } }, market) : '';
                const shown = lineText ? `${lineText} (${price})` : price ?? v;
                return [shown, outcomes[i]?.description ?? key];
              }}
            />
            {outcomes.map((o, i) => (
              <Line key={o.id} dataKey={`s${i}`} type="stepAfter" dot={false} strokeWidth={2} stroke={SERIES_COLORS[i]} connectNulls isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {hasLine && (
        <div className="mt-1 inline-flex rounded border border-border text-[11px] dark:border-border-dark" role="group" aria-label="Chart the line or the price">
          {(['Line', 'Price'] as const).map((label) => {
            const active = (label === 'Price') === showPrice;
            return (
              <button
                key={label}
                type="button"
                onClick={() => setShowPrice(label === 'Price')}
                aria-pressed={active}
                className={`px-2 py-0.5 ${active ? 'bg-slate-200 font-semibold text-text dark:bg-slate-700 dark:text-text-dark' : 'text-text-muted dark:text-text-dark-muted'}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
      <p className="mt-1 text-[11px] text-text-muted dark:text-text-dark-muted">
        {byLine ? 'Line' : 'Price'} by snapshot, {points.length} snapshots, times ET.{' '}
        {outcomes.map((o, i) => (
          <span key={o.id} className="mr-2" style={{ color: SERIES_COLORS[i] }}>■ {o.description}</span>
        ))}
      </p>
    </div>
  );
}

function MarketCard({ gameId, market, closed, onPrice }: { gameId: string; market: FeedMarket; closed: boolean; onPrice: () => void }) {
  const [open, setOpen] = useState(false);
  const period = market.period?.description && !PLAIN_PERIOD.test(market.period.description) ? market.period.description : null;
  return (
    <div className="rounded-lg border border-border bg-surface p-3 dark:border-border-dark dark:bg-surface-dark-alt">
      <div className="text-sm font-semibold text-text dark:text-text-dark">
        {market.description}
        {period && <span className="font-normal text-text-muted dark:text-text-dark-muted"> · {period}</span>}
      </div>
      {closed && <p className="mt-1 text-[11px] font-medium text-text-muted dark:text-text-dark-muted">Betting closed at kickoff</p>}
      <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {market.outcomes.map((o) => {
          const line = lineLabel(o, market);
          return (
            <button
              key={o.id}
              type="button"
              disabled={closed}
              onClick={closed ? undefined : onPrice}
              className={`flex items-center justify-between gap-3 rounded border border-border px-2.5 py-2 text-left text-xs dark:border-border-dark ${closed ? 'cursor-default' : 'hover:border-field hover:bg-field/5'}`}
            >
              <span className="min-w-0 break-words text-text dark:text-text-dark">
                {o.description}
                {line && <span className="block text-text-muted dark:text-text-dark-muted">{line}</span>}
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-text dark:text-text-dark">{american(o.price.american)}</span>
            </button>
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

export default function GameOdds({ gameId, groups: feedGroups, awayName, homeName, weatherWagers, startTime }: Props) {
  // Only open, pre-game markets and outcomes (no "Live ..." in-game markets).
  const groups = useMemo(() => publicGroups(feedGroups), [feedGroups]);
  const signedIn = useSignedIn();
  const [prompt, setPrompt] = useState(false);
  const [note, setNote] = useState(false);
  const closed = priceClick(signedIn, startTime) === 'closed';
  const onPrice = () => {
    const action = priceClick(signedIn, startTime);
    if (action === 'signup') setPrompt(true);
    else if (action === 'grading-note') setNote(true);
  };
  const tabs = useMemo(
    () => ['All', ...groups.filter((g) => g.markets.length).map((g) => g.description), ...(weatherWagers ? [WEATHER_TAB] : [])],
    [groups, weatherWagers],
  );
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
      </div>
      {note && (
        <p role="status" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100">
          {GRADING_NOTE}
        </p>
      )}
      {prompt && <SignUpPrompt onClose={() => setPrompt(false)} />}
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
            {t === WEATHER_TAB ? `${t} (${weatherWagers?.length ?? 0})` : t}
          </button>
        ))}
      </div>
      {tab === WEATHER_TAB ? (
        <div className="mt-4">
          <GameWagerGrid wagers={weatherWagers ?? []} />
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {markets.map(({ m, key }) => (
              <MarketCard key={key} gameId={gameId} market={m} closed={closed} onPrice={onPrice} />
            ))}
          </div>
          {markets.length === 0 && (
            <p className="mt-6 text-sm text-text-muted dark:text-text-dark-muted">
              {total === 0 ? 'Game lines appear here before kickoff.' : 'No markets match.'}
            </p>
          )}
        </>
      )}
    </div>
  );
}

import { useState, Fragment } from 'react';
import WagerFormModal, { type PricingPrefill } from './WagerFormModal';
import type { WagerScheduleRow } from '../../lib/wager-schedule';

interface Props {
  rows: WagerScheduleRow[];
  date: string;
}

const ET = 'America/New_York';

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-US', { timeZone: ET, hour: 'numeric', minute: '2-digit' }).replace(' ', '').toLowerCase();
}

function groupDateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { timeZone: ET, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase();
}

function tempCell(v: number | null): string {
  return v !== null ? `${Math.round(v)}°` : '—';
}

/** targetDate for the wager form is a plain YYYY-MM-DD (ET calendar date), not the kickoff instant. */
function dateFromKickoff(kickoffUTC: string): string {
  const d = new Date(kickoffUTC);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-CA', { timeZone: ET });
}

/** One game = two consecutive rows (away, home) sharing the same gameId. */
interface GamePair {
  away: WagerScheduleRow;
  home: WagerScheduleRow;
}
interface LeagueGroup {
  leagueLabel: string;
  dateLabel: string;
  games: GamePair[];
}

// Fixed section order (matches WAGER_SCHEDULE_LEAGUE_LABELS) rather than
// first-appearance order — with 4 leagues on one date, a later game in an
// earlier-appearing league (e.g. a 7pm MLB game after 4:30pm/7pm MLS kickoffs)
// must not fragment into its own trailing group merely because some other
// league's game happened to fall between them in kickoff-time order. Every
// league's games — regardless of what else tips off in between — belong in
// ONE section together, in time order within that section.
const LEAGUE_SECTION_ORDER = ['MLB', 'NFL', 'NCAA Football', 'MLS & Soccer'];

function groupRows(rows: WagerScheduleRow[]): LeagueGroup[] {
  const games: GamePair[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].side !== 'away') continue;
    const home = rows.find((r) => r.gameId === rows[i].gameId && r.side === 'home');
    if (home) games.push({ away: rows[i], home });
  }
  const byLeague = new Map<string, GamePair[]>();
  for (const game of games) {
    const leagueLabel = game.away.leagueLabel;
    const list = byLeague.get(leagueLabel);
    if (list) list.push(game);
    else byLeague.set(leagueLabel, [game]);
  }
  const dateLabel = games[0] ? groupDateLabel(games[0].away.kickoffUTC) : '';
  const orderedLeagues = [
    ...LEAGUE_SECTION_ORDER.filter((l) => byLeague.has(l)),
    ...[...byLeague.keys()].filter((l) => !LEAGUE_SECTION_ORDER.includes(l)),
  ];
  return orderedLeagues.map((leagueLabel) => ({ leagueLabel, dateLabel, games: byLeague.get(leagueLabel)! }));
}

/** One of the 4 candidate values for a game's pointspread picker — a
 * team's own high or low, at that team's own home venue. */
interface SpreadOption {
  key: string;
  label: string;
  team: string;
  metric: 'high_temp' | 'low_temp';
  value: number | null;
  lat: number | null;
  lon: number | null;
  name: string;
}

function spreadOptions(game: GamePair): SpreadOption[] {
  const forSide = (row: WagerScheduleRow, metric: 'high_temp' | 'low_temp'): SpreadOption => ({
    key: `${row.side}-${metric}`,
    label: `${row.team} ${metric === 'high_temp' ? 'High' : 'Low'}`,
    team: row.team,
    metric,
    value: metric === 'high_temp' ? row.highF : row.lowF,
    lat: row.lat,
    lon: row.lon,
    // Per Derek (2026-08-24): "you need the venues in there" — name the
    // location by its actual venue (e.g. "Tropicana Field"), not city/state.
    name: row.venueName || (row.venueCity && row.venueState ? `${row.venueCity}, ${row.venueState}` : row.team),
  });
  return [
    forSide(game.away, 'high_temp'),
    forSide(game.away, 'low_temp'),
    forSide(game.home, 'high_temp'),
    forSide(game.home, 'low_temp'),
  ];
}

/** Pending over/under prefill (a single team's own high or low). */
type PendingOverUnder = { type: 'over-under'; row: WagerScheduleRow; metric: 'high_temp' | 'low_temp' };
/** Pending pointspread prefill (favorite vs underdog, any two of the game's 4 high/low values). */
type PendingSpread = { type: 'pointspread'; game: GamePair; favorite: SpreadOption; underdog: SpreadOption };
type PendingWager = PendingOverUnder | PendingSpread;

function GamePointspreadRow({ game, onCreate }: { game: GamePair; onCreate: (spread: PendingSpread) => void }) {
  const options = spreadOptions(game);
  const [favoriteKey, setFavoriteKey] = useState(options[0].key);
  const [underdogKey, setUnderdogKey] = useState(options[3].key);

  const favorite = options.find((o) => o.key === favoriteKey)!;
  const underdog = options.find((o) => o.key === underdogKey)!;
  const sameSide = favoriteKey === underdogKey;
  const missingCoords = favorite.lat === null || favorite.lon === null || underdog.lat === null || underdog.lon === null;

  return (
    <tr className="border-b-2 border-gray-800 bg-gray-50">
      <td colSpan={7} className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold uppercase tracking-wide text-gray-500">Pointspread</span>
          <label className="flex items-center gap-1">
            <span className="text-gray-500">Favorite</span>
            <select value={favoriteKey} onChange={(e) => setFavoriteKey(e.target.value)} className="rounded border border-gray-300 px-1.5 py-1 text-xs">
              {options.map((o) => <option key={o.key} value={o.key}>{o.label} ({tempCell(o.value)})</option>)}
            </select>
          </label>
          <span className="text-gray-400">vs</span>
          <label className="flex items-center gap-1">
            <span className="text-gray-500">Underdog</span>
            <select value={underdogKey} onChange={(e) => setUnderdogKey(e.target.value)} className="rounded border border-gray-300 px-1.5 py-1 text-xs">
              {options.map((o) => <option key={o.key} value={o.key}>{o.label} ({tempCell(o.value)})</option>)}
            </select>
          </label>
          <button
            type="button"
            disabled={sameSide || missingCoords}
            onClick={() => onCreate({ type: 'pointspread', game, favorite, underdog })}
            className="rounded-lg bg-purple-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            Create Pointspread Wager
          </button>
          {sameSide && <span className="text-red-500">Pick two different sides.</span>}
        </div>
      </td>
    </tr>
  );
}

/** Renders the shared WagerFormModal for whichever pending wager (over/under or pointspread) is active — one instance, rendered once at the table root, regardless of which button (an O/U cell or a pointspread picker) triggered it. */
function PendingWagerModal({ pending, onClose }: { pending: PendingWager; onClose: (savedLabel?: string) => void }) {
  if (pending.type === 'over-under') {
    const { row, metric } = pending;
    if (row.lat === null || row.lon === null) return null;
    const forecastValue = (metric === 'high_temp' ? row.highF : row.lowF) ?? 0;
    return (
      <WagerFormModal
        prefill={{
          // Per Derek (2026-08-24): "you need the venues in there".
          locationName: row.venueName || `${row.venueCity}, ${row.venueState}`,
          lat: row.lat,
          lon: row.lon,
          metric,
          targetDate: dateFromKickoff(row.kickoffUTC),
          forecastValue,
        }}
        onClose={() => onClose()}
        onSaved={() => onClose(`Over/under wager created for ${row.team}'s ${metric === 'high_temp' ? 'high' : 'low'} (${row.side === 'home' ? 'vs' : '@'} ${row.opponent}).`)}
      />
    );
  }

  const { game, favorite, underdog } = pending;
  // Reported live (2026-08-23): this prefill never set `spread`, so the
  // form's Spread field started empty and submitted as 0 — a guaranteed-
  // unfair line for any pair whose forecasts aren't equal (which is the
  // whole point of picking a favorite/underdog). Default it the same way
  // weather-market-idea-generator.ts's balancedSpreadF does: negate the
  // favorite-minus-underdog forecast gap, rounded to the nearest half —
  // a genuinely ~50/50 line the operator can still edit before saving.
  const defaultSpread = favorite.value !== null && underdog.value !== null
    ? Math.round(-(favorite.value - underdog.value) * 2) / 2
    : undefined;
  const pricingPrefill: PricingPrefill = {
    kind: 'pointspread',
    metricA: favorite.metric,
    metricB: underdog.metric,
    locationAName: favorite.name,
    locationBName: underdog.name,
    locationALat: favorite.lat ?? undefined,
    locationALon: favorite.lon ?? undefined,
    locationBLat: underdog.lat ?? undefined,
    locationBLon: underdog.lon ?? undefined,
    spread: defaultSpread,
    targetDate: dateFromKickoff(game.away.kickoffUTC),
    title: `${favorite.label} vs ${underdog.label}`,
  };
  return (
    <WagerFormModal
      pricingPrefill={pricingPrefill}
      onClose={() => onClose()}
      onSaved={() => onClose(`Pointspread wager created: ${favorite.label} vs ${underdog.label}.`)}
    />
  );
}

export default function WagerScheduleTable({ rows, date }: Props) {
  const [pending, setPending] = useState<PendingWager | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
        No tracked games on {new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { timeZone: ET, weekday: 'long', month: 'long', day: 'numeric' })}.
      </p>
    );
  }

  const groups = groupRows(rows);

  function ouButton(row: WagerScheduleRow, metric: 'high_temp' | 'low_temp', label: string) {
    const value = metric === 'high_temp' ? row.highF : row.lowF;
    return (
      <button
        type="button"
        disabled={row.lat === null || row.lon === null || value === null}
        onClick={() => setPending({ type: 'over-under', row, metric })}
        className="block w-full rounded-lg bg-indigo-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-gray-300"
      >
        {label}
      </button>
    );
  }

  return (
    <div>
      {savedMsg && (
        <div className="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800">
          {savedMsg}
        </div>
      )}

      {groups.map((group, gi) => (
        <div key={gi} className="mb-6 overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full min-w-[1000px] border-collapse text-sm">
            <thead>
              <tr className="bg-slate-700 text-left text-xs font-semibold uppercase tracking-wide text-white">
                <th className="px-3 py-2" colSpan={7}>{group.leagueLabel} — {group.dateLabel}</th>
              </tr>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold text-gray-500">
                <th className="px-3 py-1.5">Time</th>
                <th className="px-2 py-1.5">#</th>
                <th className="px-3 py-1.5">Team</th>
                <th className="px-2 py-1.5">Score</th>
                <th className="px-3 py-1.5 text-right">High</th>
                <th className="px-3 py-1.5 text-right">Low</th>
                <th className="px-3 py-1.5">Over/Under</th>
              </tr>
            </thead>
            <tbody>
              {group.games.map((game) => (
                <Fragment key={game.away.gameId}>
                  <tr className="border-b border-gray-300 bg-white">
                    <td className="px-3 py-1.5 align-top font-medium text-gray-900" rowSpan={2}>
                      {timeLabel(game.away.kickoffUTC)}
                      <div className="text-[10px] font-normal text-gray-400">ET</div>
                      {game.away.state !== 'pre' && (
                        <div className="text-[10px] font-normal uppercase text-indigo-600">{game.away.statusDetail || game.away.state}</div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-gray-500">{game.away.rotation ?? '—'}</td>
                    <td className="px-3 py-1.5 text-gray-900">
                      <div className="font-semibold">{game.away.team}</div>
                      {game.away.pitcher && <div className="text-[11px] font-normal text-gray-500">{game.away.pitcher}</div>}
                    </td>
                    <td className="px-2 py-1.5 font-semibold text-gray-900">{game.away.score ?? ''}</td>
                    <td className="px-3 py-1.5 text-right font-semibold text-gray-900">{tempCell(game.away.highF)}</td>
                    <td className="px-3 py-1.5 text-right font-semibold text-gray-900">{tempCell(game.away.lowF)}</td>
                    <td className="px-3 py-1.5">
                      <div className="flex gap-1">
                        {ouButton(game.away, 'high_temp', 'O/U High')}
                        {ouButton(game.away, 'low_temp', 'O/U Low')}
                      </div>
                    </td>
                  </tr>
                  <tr className="border-b border-gray-300 bg-white">
                    <td className="px-2 py-1.5 text-gray-500">{game.home.rotation ?? '—'}</td>
                    <td className="px-3 py-1.5 text-gray-900">
                      <div className="font-semibold">{game.home.team}</div>
                      {game.home.pitcher && <div className="text-[11px] font-normal text-gray-500">{game.home.pitcher}</div>}
                    </td>
                    <td className="px-2 py-1.5 font-semibold text-gray-900">{game.home.score ?? ''}</td>
                    <td className="px-3 py-1.5 text-right font-semibold text-gray-900">{tempCell(game.home.highF)}</td>
                    <td className="px-3 py-1.5 text-right font-semibold text-gray-900">{tempCell(game.home.lowF)}</td>
                    <td className="px-3 py-1.5">
                      <div className="flex gap-1">
                        {ouButton(game.home, 'high_temp', 'O/U High')}
                        {ouButton(game.home, 'low_temp', 'O/U Low')}
                      </div>
                    </td>
                  </tr>
                  <GamePointspreadRow game={game} onCreate={setPending} />
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {pending && (
        <PendingWagerModal
          pending={pending}
          onClose={(savedLabel) => {
            setPending(null);
            if (savedLabel) {
              setSavedMsg(savedLabel);
              setTimeout(() => setSavedMsg(null), 5000);
            }
          }}
        />
      )}
    </div>
  );
}

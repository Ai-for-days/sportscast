import { useState, Fragment } from 'react';
import WagerFormModal from './WagerFormModal';
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

/** Which of a row's forecast values makes the better default line to prefill — the operator can still switch metric in the form itself. Defaults to high when both exist. */
function defaultForecastValue(row: WagerScheduleRow): number | null {
  if (row.highF !== null) return row.highF;
  if (row.lowF !== null) return row.lowF;
  return null;
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

function groupRows(rows: WagerScheduleRow[]): LeagueGroup[] {
  const games: GamePair[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].side !== 'away') continue;
    const home = rows.find((r) => r.gameId === rows[i].gameId && r.side === 'home');
    if (home) games.push({ away: rows[i], home });
  }
  const groups: LeagueGroup[] = [];
  for (const game of games) {
    const leagueLabel = game.away.leagueLabel;
    const dateLabel = groupDateLabel(game.away.kickoffUTC);
    const last = groups[groups.length - 1];
    if (last && last.leagueLabel === leagueLabel && last.dateLabel === dateLabel) last.games.push(game);
    else groups.push({ leagueLabel, dateLabel, games: [game] });
  }
  return groups;
}

export default function WagerScheduleTable({ rows, date }: Props) {
  const [activeRow, setActiveRow] = useState<WagerScheduleRow | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
        No tracked games on {new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { timeZone: ET, weekday: 'long', month: 'long', day: 'numeric' })}.
      </p>
    );
  }

  const groups = groupRows(rows);
  const forecastValue = activeRow ? defaultForecastValue(activeRow) : null;

  return (
    <div>
      {savedMsg && (
        <div className="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800">
          {savedMsg}
        </div>
      )}

      {groups.map((group, gi) => (
        <div key={gi} className="mb-6 overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full min-w-[900px] border-collapse text-sm">
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
                <th className="px-3 py-1.5"></th>
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
                    <td className="px-3 py-1.5 align-top" rowSpan={2}>
                      <button
                        type="button"
                        disabled={game.away.lat === null || game.away.lon === null}
                        onClick={() => setActiveRow(game.away)}
                        className="mb-1 block w-full rounded-lg bg-indigo-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-gray-300"
                      >
                        Wager: {game.away.team.split(' ').slice(-1)[0]}
                      </button>
                      <button
                        type="button"
                        disabled={game.home.lat === null || game.home.lon === null}
                        onClick={() => setActiveRow(game.home)}
                        className="block w-full rounded-lg bg-indigo-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-gray-300"
                      >
                        Wager: {game.home.team.split(' ').slice(-1)[0]}
                      </button>
                    </td>
                  </tr>
                  <tr className="border-b-2 border-gray-800 bg-white">
                    <td className="px-2 py-1.5 text-gray-500">{game.home.rotation ?? '—'}</td>
                    <td className="px-3 py-1.5 text-gray-900">
                      <div className="font-semibold">{game.home.team}</div>
                      {game.home.pitcher && <div className="text-[11px] font-normal text-gray-500">{game.home.pitcher}</div>}
                    </td>
                    <td className="px-2 py-1.5 font-semibold text-gray-900">{game.home.score ?? ''}</td>
                    <td className="px-3 py-1.5 text-right font-semibold text-gray-900">{tempCell(game.home.highF)}</td>
                    <td className="px-3 py-1.5 text-right font-semibold text-gray-900">{tempCell(game.home.lowF)}</td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {activeRow && activeRow.lat !== null && activeRow.lon !== null && (
        <WagerFormModal
          prefill={{
            locationName: `${activeRow.venueCity}, ${activeRow.venueState}`,
            lat: activeRow.lat,
            lon: activeRow.lon,
            metric: 'high_temp',
            targetDate: dateFromKickoff(activeRow.kickoffUTC),
            forecastValue: forecastValue ?? 0,
          }}
          onClose={() => setActiveRow(null)}
          onSaved={() => {
            setActiveRow(null);
            setSavedMsg(`Wager created for ${activeRow.team} (${activeRow.side === 'home' ? 'vs' : '@'} ${activeRow.opponent}).`);
            setTimeout(() => setSavedMsg(null), 5000);
          }}
        />
      )}
    </div>
  );
}

/** targetDate for the wager form is a plain YYYY-MM-DD (ET calendar date), not the kickoff instant. */
function dateFromKickoff(kickoffUTC: string): string {
  const d = new Date(kickoffUTC);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-CA', { timeZone: ET });
}

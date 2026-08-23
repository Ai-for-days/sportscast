import { useState } from 'react';
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
  return d.toLocaleTimeString('en-US', { timeZone: ET, hour: 'numeric', minute: '2-digit' });
}

function dateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { timeZone: ET, month: 'short', day: 'numeric' });
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

  const forecastValue = activeRow ? defaultForecastValue(activeRow) : null;

  return (
    <div>
      {savedMsg && (
        <div className="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800">
          {savedMsg}
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full min-w-[920px] text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Time (ET)</th>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">League</th>
              <th className="px-3 py-2">Team</th>
              <th className="px-3 py-2">Home Venue</th>
              <th className="px-3 py-2 text-right">High</th>
              <th className="px-3 py-2 text-right">Low</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row, i) => {
              const prevRow = rows[i - 1];
              const isNewGame = !prevRow || prevRow.gameId !== row.gameId;
              return (
                <tr key={row.id} className={`hover:bg-gray-50 ${isNewGame && i > 0 ? 'border-t-2 border-t-gray-200' : ''}`}>
                  <td className="px-3 py-2 align-top text-gray-700">{isNewGame ? dateLabel(row.kickoffUTC) : ''}</td>
                  <td className="px-3 py-2 align-top text-gray-700">
                    {isNewGame && (
                      <>
                        {timeLabel(row.kickoffUTC)}
                        {row.state !== 'pre' && (
                          <div className="text-[10px] font-semibold uppercase text-indigo-600">{row.statusDetail || row.state}</div>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top text-gray-500">{row.rotation ?? '—'}</td>
                  <td className="px-3 py-2 align-top text-gray-500">{isNewGame ? row.leagueLabel : ''}</td>
                  <td className="px-3 py-2 align-top font-medium text-gray-900">
                    {row.team}
                    <div className="text-xs font-normal text-gray-400">{row.side === 'home' ? 'vs' : '@'} {row.opponent}</div>
                  </td>
                  <td className="px-3 py-2 align-top text-gray-500">
                    {row.venueName ?? '—'}
                    {row.venueCity && <div className="text-xs text-gray-400">{row.venueCity}, {row.venueState}</div>}
                  </td>
                  <td className="px-3 py-2 align-top text-right font-semibold text-gray-900">{tempCell(row.highF)}</td>
                  <td className="px-3 py-2 align-top text-right font-semibold text-gray-900">{tempCell(row.lowF)}</td>
                  <td className="px-3 py-2 align-top">
                    <button
                      type="button"
                      disabled={row.lat === null || row.lon === null}
                      onClick={() => setActiveRow(row)}
                      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-gray-300"
                    >
                      Create Wager
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

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

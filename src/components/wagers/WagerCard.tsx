import type { Wager, WagerStatus } from '../../lib/wager-types';
import OddsDisplay from './OddsDisplay';
import OverUnderDisplay from './OverUnderDisplay';
import PointspreadDisplay from './PointspreadDisplay';

interface UserInfo {
  id: string;
  email: string;
  displayName: string;
}

interface Props {
  wager: Wager;
  user?: UserInfo | null;
  onOutcomeClick?: (wagerId: string, wagerTitle: string, outcomeLabel: string, odds: number) => void;
}

const STATUS_STYLES: Record<WagerStatus, { bg: string; text: string; label: string }> = {
  open: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Open' },
  locked: { bg: 'bg-orange-100', text: 'text-orange-700', label: 'Locked' },
  graded: { bg: 'bg-sky-100', text: 'text-sky-700', label: 'Graded' },
  void: { bg: 'bg-gray-100', text: 'text-gray-500', label: 'Void' },
};

const METRIC_LABELS: Record<string, string> = {
  actual_temp: 'Actual Temp at Time (°F)',
  high_temp: 'High Temp for the Day (°F)',
  low_temp: 'Low Temp for the Day (°F)',
  actual_wind: 'High Wind for the Day (mph)',
  actual_gust: 'High Gusts for the Day (mph)',
};

function getLocationName(wager: Wager): string {
  if (wager.kind === 'pointspread') {
    return `${wager.locationA.name} vs ${wager.locationB.name}`;
  }
  return wager.location.name;
}

function formatTime12h(time24: string): string {
  const [hStr, mStr] = time24.split(':');
  let h = parseInt(hStr);
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${mStr} ${ampm}`;
}

function getCountdown(lockTime: string): string | null {
  const diff = new Date(lockTime).getTime() - Date.now();
  if (diff <= 0) return null;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  return `${hours}h ${mins}m`;
}

export default function WagerCard({ wager, user, onOutcomeClick }: Props) {
  const status = STATUS_STYLES[wager.status];
  const countdown = wager.status === 'open' ? getCountdown(wager.lockTime) : null;
  const bettable = wager.status === 'open' && !!onOutcomeClick;

  const handleOutcomeClick = (outcomeLabel: string, odds: number) => {
    if (bettable && onOutcomeClick) {
      onOutcomeClick(wager.id, wager.title, outcomeLabel, odds);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 transition-shadow hover:shadow-lg hover:shadow-field/5">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold text-gray-900 truncate">{wager.title}</h3>
            {wager.ticketNumber && (
              <span className="font-mono text-[10px] text-gray-400 shrink-0">#{wager.ticketNumber}</span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span>{getLocationName(wager)}</span>
            <span className="text-gray-300">|</span>
            <span>{METRIC_LABELS[wager.metric] || wager.metric}</span>
            <span className="text-gray-300">|</span>
            <span>{wager.targetDate}{wager.targetTime ? ` at ${formatTime12h(wager.targetTime)}` : ''}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${status.bg} ${status.text}`}>
            {status.label}
          </span>
          {countdown && (
            <span className="text-xs text-orange-500">Locks in {countdown}</span>
          )}
        </div>
      </div>

      {/* Description */}
      {wager.description && (
        <p className="mb-4 text-sm text-gray-500">{wager.description}</p>
      )}

      {/* Kind-specific display */}
      {wager.kind === 'odds' && (
        <OddsDisplay wager={wager} bettable={bettable} onOutcomeClick={handleOutcomeClick} />
      )}
      {wager.kind === 'over-under' && (
        <OverUnderDisplay wager={wager} bettable={bettable} onOutcomeClick={handleOutcomeClick} />
      )}
      {wager.kind === 'pointspread' && (
        <PointspreadDisplay wager={wager} bettable={bettable} onOutcomeClick={handleOutcomeClick} />
      )}

      {/* Graded result */}
      {wager.status === 'graded' && wager.observedValue != null && (() => {
        const outcome = wager.winningOutcome;
        const isNoMatch = outcome === 'no_match';
        const displayOutcome = isNoMatch ? 'No winner' : outcome;
        return (
          <div className={`mt-4 rounded-lg border px-4 py-2 ${
            isNoMatch
              ? 'border-slate-200 bg-slate-50'
              : 'border-green-200 bg-green-50'
          }`}>
            <span className="text-xs text-gray-500">NWS Observed: </span>
            <span className="font-mono font-bold text-slate-700">{wager.observedValue}</span>
            {outcome && (
              <>
                <span className="mx-2 text-gray-300">|</span>
                <span className="text-xs text-gray-500">Result: </span>
                <span className={`font-semibold ${isNoMatch ? 'text-slate-500' : 'text-green-600'}`}>
                  {displayOutcome}
                </span>
              </>
            )}
          </div>
        );
      })()}

      {/* Void reason */}
      {wager.status === 'void' && wager.voidReason && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2">
          <span className="text-xs text-gray-500">Void: {wager.voidReason}</span>
        </div>
      )}
    </div>
  );
}

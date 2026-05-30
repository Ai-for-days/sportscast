import type { PublicWagerView } from '../../lib/public-wager-view';
import OddsDisplay from './OddsDisplay';
import OverUnderDisplay from './OverUnderDisplay';
import PointspreadDisplay from './PointspreadDisplay';

interface UserInfo {
  id: string;
  email: string;
  displayName: string;
}

interface Props {
  wager: PublicWagerView;
  user?: UserInfo | null;
  onOutcomeClick?: (wagerId: string, wagerTitle: string, outcomeLabel: string, odds: number) => void;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
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

function getLocationDisplay(wager: PublicWagerView): string {
  if (wager.kind === 'pointspread') {
    if (wager.locationAName && wager.locationBName) {
      return `${wager.locationAName} vs ${wager.locationBName}`;
    }
    return wager.locationSummary;
  }
  return wager.locationName ?? wager.locationSummary;
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

export default function WagerCard({ wager, onOutcomeClick }: Props) {
  const status = STATUS_STYLES[wager.status] ?? { bg: 'bg-gray-100', text: 'text-gray-600', label: wager.status };
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
      <div className="mb-4">
        {/* Title row: title takes the full width, with only the small status
            badge to its right so it never gets squeezed into a narrow column
            (which caused character-by-character wrapping on mobile). */}
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 flex-1 break-words text-base font-bold leading-snug text-gray-900 sm:text-lg">
            {wager.title}
          </h3>
          <span className={`mt-0.5 inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${status.bg} ${status.text}`}>
            {status.label}
          </span>
        </div>
        {/* Meta row: location · metric · date, plus ticket # and lock
            countdown — all wrap freely on small screens. */}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
          <span>{getLocationDisplay(wager)}</span>
          <span className="text-gray-300">|</span>
          <span>{METRIC_LABELS[wager.metric] || wager.metric}</span>
          <span className="text-gray-300">|</span>
          <span>{wager.targetDate}{wager.targetTime ? ` at ${formatTime12h(wager.targetTime)}` : ''}</span>
          {wager.ticketNumber && (
            <>
              <span className="text-gray-300">|</span>
              <span className="font-mono text-gray-400">#{wager.ticketNumber}</span>
            </>
          )}
          {countdown && (
            <>
              <span className="text-gray-300">|</span>
              <span className="font-medium text-orange-500">Locks in {countdown}</span>
            </>
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

      {/* Player/non-admin void notice. PublicWagerView intentionally omits
          voidReason; admin views render the raw reason from the underlying
          Wager record separately. */}
      {wager.status === 'void' && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2">
          <span className="text-xs text-gray-500">
            This market was cancelled before resolution.
          </span>
        </div>
      )}
    </div>
  );
}

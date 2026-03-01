import type { Wager, WagerStatus } from '../../lib/wager-types';
import OddsDisplay from './OddsDisplay';
import OverUnderDisplay from './OverUnderDisplay';
import PointspreadDisplay from './PointspreadDisplay';

interface Props {
  wager: Wager;
}

const STATUS_STYLES: Record<WagerStatus, { bg: string; text: string; label: string }> = {
  open: { bg: 'bg-field/20', text: 'text-field-light', label: 'Open' },
  locked: { bg: 'bg-heat/20', text: 'text-heat-light', label: 'Locked' },
  graded: { bg: 'bg-sky/20', text: 'text-sky-light', label: 'Graded' },
  void: { bg: 'bg-storm/20', text: 'text-storm-light', label: 'Void' },
};

const METRIC_LABELS: Record<string, string> = {
  high_temp: 'Actual High (°F)',
  low_temp: 'Actual Low (°F)',
  precip: 'Precipitation (in)',
  wind_speed: 'Wind (mph)',
  wind_gust: 'Gusts (mph)',
};

function getLocationName(wager: Wager): string {
  if (wager.kind === 'pointspread') {
    return `${wager.locationA.name} vs ${wager.locationB.name}`;
  }
  return wager.location.name;
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

export default function WagerCard({ wager }: Props) {
  const status = STATUS_STYLES[wager.status];
  const countdown = wager.status === 'open' ? getCountdown(wager.lockTime) : null;

  return (
    <div className="rounded-xl border border-border-dark bg-surface-dark-alt p-5 transition-shadow hover:shadow-lg hover:shadow-field/5">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-bold text-text-dark truncate">{wager.title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-dark-muted">
            <span>{getLocationName(wager)}</span>
            <span className="text-border-dark">|</span>
            <span>{METRIC_LABELS[wager.metric] || wager.metric}</span>
            <span className="text-border-dark">|</span>
            <span>{wager.targetDate}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${status.bg} ${status.text}`}>
            {status.label}
          </span>
          {countdown && (
            <span className="text-xs text-heat-light">Locks in {countdown}</span>
          )}
        </div>
      </div>

      {/* Description */}
      {wager.description && (
        <p className="mb-4 text-sm text-text-dark-muted">{wager.description}</p>
      )}

      {/* Kind-specific display */}
      {wager.kind === 'odds' && <OddsDisplay wager={wager} />}
      {wager.kind === 'over-under' && <OverUnderDisplay wager={wager} />}
      {wager.kind === 'pointspread' && <PointspreadDisplay wager={wager} />}

      {/* Graded result */}
      {wager.status === 'graded' && wager.observedValue != null && (
        <div className="mt-4 rounded-lg border border-green-500/30 bg-green-500/5 px-4 py-2">
          <span className="text-xs text-text-dark-muted">Observed: </span>
          <span className="font-mono font-bold text-green-400">{wager.observedValue}</span>
          {wager.winningOutcome && (
            <>
              <span className="mx-2 text-border-dark">|</span>
              <span className="text-xs text-text-dark-muted">Result: </span>
              <span className="font-semibold text-green-400">{wager.winningOutcome}</span>
            </>
          )}
        </div>
      )}

      {/* Void reason */}
      {wager.status === 'void' && wager.voidReason && (
        <div className="mt-4 rounded-lg border border-storm/30 bg-storm/5 px-4 py-2">
          <span className="text-xs text-storm-light">Void: {wager.voidReason}</span>
        </div>
      )}
    </div>
  );
}

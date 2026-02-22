import { useState } from 'react';
import type { WeatherAlert } from '../../lib/types';

interface Props {
  alerts?: WeatherAlert[];
}

function severityColor(severity: string): string {
  switch (severity) {
    case 'Extreme': return 'border-red-800 bg-red-700 text-white';
    case 'Severe': return 'border-red-600 bg-red-600 text-white';
    case 'Moderate': return 'border-orange-500 bg-orange-500 text-white';
    case 'Minor': return 'border-yellow-500 bg-yellow-400 text-gray-900';
    default: return 'border-blue-500 bg-blue-500 text-white';
  }
}

function severityIcon(severity: string): string {
  switch (severity) {
    case 'Extreme':
    case 'Severe': return '\u26A0\uFE0F';
    case 'Moderate': return '\uD83D\uDFE0';
    case 'Minor': return '\uD83D\uDFE1';
    default: return '\u2139\uFE0F';
  }
}

function formatAlertTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export default function WeatherAlerts({ alerts }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!alerts || alerts.length === 0) return null;

  return (
    <div className="space-y-2">
      {alerts.map((alert, i) => {
        const key = alert.id || String(i);
        const isExpanded = expandedId === key;
        const colors = severityColor(alert.severity);
        const icon = severityIcon(alert.severity);

        return (
          <div key={key} className={`overflow-hidden rounded-lg border-2 ${colors}`}>
            <button
              onClick={() => setExpandedId(isExpanded ? null : key)}
              className="flex w-full items-center gap-2 px-4 py-3 text-left font-semibold"
            >
              <span className="text-lg">{icon}</span>
              <span className="flex-1">{alert.event}</span>
              {alert.expires && (
                <span className="text-xs font-normal opacity-80">
                  Until {formatAlertTime(alert.expires)}
                </span>
              )}
              <span className="text-sm opacity-70">{isExpanded ? '\u25B2' : '\u25BC'}</span>
            </button>

            {isExpanded && (
              <div className="bg-black/10 px-4 py-3 text-sm">
                {alert.headline && (
                  <p className="mb-2 font-medium">{alert.headline}</p>
                )}
                <p className="whitespace-pre-wrap leading-relaxed opacity-90">
                  {alert.description}
                </p>
                {alert.senderName && (
                  <p className="mt-2 text-xs opacity-70">Source: {alert.senderName}</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

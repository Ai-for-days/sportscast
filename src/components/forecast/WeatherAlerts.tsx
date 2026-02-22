import { useState } from 'react';
import type { WeatherAlert } from '../../lib/types';

interface Props {
  alerts: WeatherAlert[];
}

function severityColor(severity: WeatherAlert['severity']): { bg: string; border: string; text: string; icon: string } {
  switch (severity) {
    case 'Extreme':
    case 'Severe':
      return { bg: 'bg-red-50 dark:bg-red-950/40', border: 'border-red-400 dark:border-red-700', text: 'text-red-800 dark:text-red-200', icon: 'text-red-600 dark:text-red-400' };
    case 'Moderate':
      return { bg: 'bg-orange-50 dark:bg-orange-950/40', border: 'border-orange-400 dark:border-orange-700', text: 'text-orange-800 dark:text-orange-200', icon: 'text-orange-600 dark:text-orange-400' };
    case 'Minor':
    default:
      return { bg: 'bg-yellow-50 dark:bg-yellow-950/40', border: 'border-yellow-400 dark:border-yellow-700', text: 'text-yellow-800 dark:text-yellow-200', icon: 'text-yellow-600 dark:text-yellow-400' };
  }
}

function formatAlertTime(iso: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
}

export default function WeatherAlerts({ alerts }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (!alerts || alerts.length === 0) return null;

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-2">
      {alerts.map(alert => {
        const colors = severityColor(alert.severity);
        const isOpen = expanded.has(alert.id);

        return (
          <div
            key={alert.id}
            className={`rounded-xl border-l-4 ${colors.border} ${colors.bg} overflow-hidden shadow-sm`}
          >
            <button
              onClick={() => toggle(alert.id)}
              className="flex w-full items-start gap-3 p-4 text-left"
            >
              <span className={`mt-0.5 text-lg ${colors.icon}`}>
                {alert.severity === 'Extreme' || alert.severity === 'Severe' ? '🚨' : '⚠️'}
              </span>
              <div className="min-w-0 flex-1">
                <div className={`font-semibold ${colors.text}`}>{alert.event}</div>
                <div className={`mt-0.5 text-sm opacity-80 ${colors.text}`}>
                  {alert.headline}
                </div>
                {alert.expires && (
                  <div className={`mt-1 text-xs opacity-60 ${colors.text}`}>
                    Expires: {formatAlertTime(alert.expires)}
                  </div>
                )}
              </div>
              <span className={`mt-1 text-sm ${colors.text}`}>
                {isOpen ? '▲' : '▼'}
              </span>
            </button>

            {isOpen && (
              <div className={`border-t ${colors.border} px-4 pb-4 pt-3`}>
                <p className={`whitespace-pre-wrap text-sm leading-relaxed ${colors.text} opacity-90`}>
                  {alert.description}
                </p>
                {alert.senderName && (
                  <p className={`mt-2 text-xs ${colors.text} opacity-50`}>
                    Source: {alert.senderName}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

import { useState, useEffect } from 'react';

interface ExecutionConfig {
  mode: string;
  liveTradingEnabled: boolean;
  demoTradingEnabled: boolean;
  requireApproval: boolean;
  killSwitchEnabled: boolean;
}

interface AuditEvent {
  id: string;
  createdAt: string;
  actor: string;
  eventType: string;
  targetType?: string;
  targetId?: string;
  summary: string;
}

const cardClass = 'rounded-lg border border-gray-200 bg-white p-4';
const thClass = 'px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider';
const tdClass = 'px-3 py-2 text-sm text-gray-900';

const MODE_COLORS: Record<string, string> = {
  disabled: 'bg-gray-200 text-gray-700',
  paper: 'bg-blue-100 text-blue-700',
  demo: 'bg-yellow-100 text-yellow-700',
  live: 'bg-red-100 text-red-700',
};

function formatET(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    }) + ' ET';
  } catch { return iso; }
}

export default function ExecutionControl() {
  const [config, setConfig] = useState<ExecutionConfig | null>(null);
  const [hardLimits, setHardLimits] = useState<Record<string, number>>({});
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    try {
      const res = await fetch('/api/admin/execution-control', { credentials: 'include' });
      if (!res.ok) { setError('Failed to load'); return; }
      const d = await res.json();
      setConfig(d.config);
      setHardLimits(d.hardLimits || {});
      setAuditEvents(d.auditEvents || []);
    } catch (err: any) { setError(err?.message || 'Failed'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const updateConfig = async (updates: Partial<ExecutionConfig>) => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/execution-control', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update-config', updates }),
      });
      if (res.ok) { const d = await res.json(); setConfig(d.config); fetchData(); }
    } catch {} finally { setSaving(false); }
  };

  const toggleKillSwitch = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/execution-control', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle-kill-switch' }),
      });
      if (res.ok) { const d = await res.json(); setConfig(d.config); fetchData(); }
    } catch {} finally { setSaving(false); }
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading execution control...</div>;
  if (error) return <div className="text-center py-12 text-red-600">{error}</div>;
  if (!config) return null;

  const limitEntries = Object.entries(hardLimits).map(([key, val]) => ({
    name: key.replace(/_/g, ' ').toLowerCase(),
    value: key.includes('CENTS') ? `$${(val / 100).toFixed(0)}` : key.includes('THRESHOLD') ? `${(val * 100).toFixed(0)}%` : String(val),
  }));

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Execution Control</h1>
        <div className="flex gap-3">
          <a href="/admin/live-readiness" className="text-sm text-blue-600 hover:underline">Live Readiness</a>
          <a href="/admin/demo-execution" className="text-sm text-blue-600 hover:underline">Demo Execution</a>
          <a href="/admin/execution-candidates" className="text-sm text-blue-600 hover:underline">Candidates</a>
          <a href="/admin/trading-desk" className="text-sm text-blue-600 hover:underline">Trading Desk</a>
          <a href="/admin/signals" className="text-sm text-blue-600 hover:underline">Signals</a>
        </div>
      </div>

      {/* Kill Switch Banner */}
      {config.killSwitchEnabled && (
        <div className="rounded-lg border-2 border-red-500 bg-red-50 p-4 text-center">
          <div className="text-lg font-bold text-red-700">KILL SWITCH ACTIVE</div>
          <div className="text-sm text-red-600 mt-1">All execution is blocked. No orders will be processed.</div>
        </div>
      )}

      {/* Status Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Current Mode</div>
          <div className="mt-1">
            <span className={`inline-block rounded-full px-3 py-1 text-sm font-bold ${MODE_COLORS[config.mode]}`}>
              {config.mode.toUpperCase()}
            </span>
          </div>
        </div>
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Kill Switch</div>
          <div className={`text-lg font-bold mt-1 ${config.killSwitchEnabled ? 'text-red-600' : 'text-green-600'}`}>
            {config.killSwitchEnabled ? 'ACTIVE' : 'OFF'}
          </div>
        </div>
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Approval Required</div>
          <div className={`text-lg font-bold mt-1 ${config.requireApproval ? 'text-blue-600' : 'text-gray-400'}`}>
            {config.requireApproval ? 'YES' : 'NO'}
          </div>
        </div>
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Live Trading</div>
          <div className={`text-lg font-bold mt-1 ${config.liveTradingEnabled ? 'text-red-600' : 'text-gray-400'}`}>
            {config.liveTradingEnabled ? 'ENABLED' : 'DISABLED'}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className={cardClass}>
        <h2 className="mb-4 text-sm font-semibold text-gray-700">Controls</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Execution Mode</label>
            <select value={config.mode} onChange={e => updateConfig({ mode: e.target.value as any })}
              disabled={saving}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm">
              <option value="disabled">Disabled</option>
              <option value="paper">Paper</option>
              <option value="demo">Demo</option>
              <option value="live">Live</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Kill Switch</label>
            <button onClick={toggleKillSwitch} disabled={saving}
              className={`w-full rounded px-4 py-2 text-sm font-semibold ${
                config.killSwitchEnabled
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'bg-red-600 text-white hover:bg-red-700'
              } disabled:opacity-50`}>
              {config.killSwitchEnabled ? 'Deactivate Kill Switch' : 'Activate Kill Switch'}
            </button>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Require Approval</label>
            <button onClick={() => updateConfig({ requireApproval: !config.requireApproval })} disabled={saving}
              className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {config.requireApproval ? 'Disable Approval Requirement' : 'Enable Approval Requirement'}
            </button>
          </div>
        </div>
      </div>

      {/* Hard Limits */}
      <div className={cardClass}>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Hard Risk Limits</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {limitEntries.map(l => (
            <div key={l.name} className="rounded bg-gray-50 px-3 py-2">
              <div className="text-xs text-gray-500">{l.name}</div>
              <div className="text-sm font-bold text-gray-900">{l.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Audit Log */}
      <div className={cardClass}>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Audit Log (Recent)</h2>
        {auditEvents.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">No audit events yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className={thClass}>Time</th>
                  <th className={thClass}>Event</th>
                  <th className={thClass}>Summary</th>
                </tr>
              </thead>
              <tbody>
                {auditEvents.map(e => (
                  <tr key={e.id} className="border-b border-gray-50">
                    <td className={`${tdClass} text-xs whitespace-nowrap`}>{formatET(e.createdAt)}</td>
                    <td className={tdClass}>
                      <span className="inline-block rounded bg-gray-100 px-2 py-0.5 text-xs font-mono">{e.eventType}</span>
                    </td>
                    <td className={`${tdClass} text-xs`}>{e.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

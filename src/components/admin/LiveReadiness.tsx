import { useState, useEffect } from 'react';

interface ReadinessCheck {
  key: string; label: string; category: string;
  passed: boolean; severity: 'info' | 'warning' | 'critical'; message: string;
}
interface ReadinessResult { ready: boolean; checks: ReadinessCheck[]; criticalFailures: number; warnings: number; }
interface ExecutionConfig { mode: string; liveTradingEnabled: boolean; demoTradingEnabled: boolean; requireApproval: boolean; killSwitchEnabled: boolean; }
interface PreflightRecord { id: string; createdAt: string; actor: string; confirmedItems: string[]; notes?: string; }
interface PreflightItem { key: string; label: string; description: string; }
interface LiveGuardrails { maxOrderSizeCents: number; minEdgeThreshold: number; maxSpreadThreshold: number; requireApproval: boolean; requireDryRun: boolean; requireAuditBeforeSubmit: boolean; }

const cardClass = 'rounded-lg border border-gray-200 bg-white p-4';
const thClass = 'px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider';
const tdClass = 'px-3 py-2 text-sm text-gray-900';

const SEV_COLORS: Record<string, string> = {
  critical: 'text-red-700 bg-red-50',
  warning: 'text-amber-700 bg-amber-50',
  info: 'text-blue-700 bg-blue-50',
};

function fmtUSD(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

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

export default function LiveReadiness() {
  const [readiness, setReadiness] = useState<ReadinessResult | null>(null);
  const [config, setConfig] = useState<ExecutionConfig | null>(null);
  const [preflight, setPreflight] = useState<PreflightRecord | null>(null);
  const [preflightItems, setPreflightItems] = useState<PreflightItem[]>([]);
  const [guardrails, setGuardrails] = useState<LiveGuardrails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Preflight form state
  const [pfChecked, setPfChecked] = useState<Record<string, boolean>>({});
  const [pfNotes, setPfNotes] = useState('');
  const [pfSubmitting, setPfSubmitting] = useState(false);

  // Live toggle state
  const [confirmPhrase, setConfirmPhrase] = useState('');
  const [showLiveModal, setShowLiveModal] = useState(false);
  const [liveActing, setLiveActing] = useState(false);
  const [liveError, setLiveError] = useState('');

  // Emergency state
  const [emergencyNotes, setEmergencyNotes] = useState('');
  const [emergencyActing, setEmergencyActing] = useState(false);

  const fetchData = async () => {
    try {
      const res = await fetch('/api/admin/live-readiness', { credentials: 'include' });
      if (!res.ok) { setError('Failed to load'); return; }
      const d = await res.json();
      setReadiness(d.readiness);
      setConfig(d.config);
      setPreflight(d.preflight);
      setPreflightItems(d.preflightItems || []);
      setGuardrails(d.liveGuardrails);
    } catch (err: any) { setError(err?.message || 'Failed'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const doPost = async (action: string, extra: any = {}) => {
    const res = await fetch('/api/admin/live-readiness', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
    });
    return res.json();
  };

  const submitPreflight = async () => {
    setPfSubmitting(true);
    try {
      const confirmedItems = Object.entries(pfChecked).filter(([, v]) => v).map(([k]) => k);
      const result = await doPost('preflight', { confirmedItems, notes: pfNotes || undefined });
      if (!result.success && result.missing) {
        alert(`Incomplete: missing ${result.missing.join(', ')}`);
      }
      fetchData();
    } catch {} finally { setPfSubmitting(false); }
  };

  const doEnableLive = async () => {
    setLiveActing(true);
    setLiveError('');
    try {
      const result = await doPost('enable-live', { confirmationPhrase: confirmPhrase });
      if (!result.success) {
        setLiveError(result.reason || 'Denied');
      } else {
        setShowLiveModal(false);
        setConfirmPhrase('');
      }
      fetchData();
    } catch {} finally { setLiveActing(false); }
  };

  const doDisableLive = async () => {
    setLiveActing(true);
    try {
      await doPost('disable-live');
      fetchData();
    } catch {} finally { setLiveActing(false); }
  };

  const doEmergencyShutdown = async () => {
    if (!confirm('EMERGENCY SHUTDOWN: This will enable kill switch, disable live trading, and revert to paper mode. Continue?')) return;
    setEmergencyActing(true);
    try {
      await doPost('emergency-shutdown', { notes: emergencyNotes || undefined });
      setEmergencyNotes('');
      fetchData();
    } catch {} finally { setEmergencyActing(false); }
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading live readiness...</div>;
  if (error) return <div className="text-center py-12 text-red-600">{error}</div>;

  const isLive = config?.mode === 'live';
  const categories = [...new Set(readiness?.checks.map(c => c.category) || [])];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Live Readiness</h1>
        <div className="flex gap-3">
          <a href="/admin/execution-control" className="text-sm text-blue-600 hover:underline">Execution Control</a>
          <a href="/admin/demo-execution" className="text-sm text-blue-600 hover:underline">Demo Execution</a>
          <a href="/admin/execution-candidates" className="text-sm text-blue-600 hover:underline">Candidates</a>
          <a href="/admin/trading-desk" className="text-sm text-blue-600 hover:underline">Trading Desk</a>
        </div>
      </div>

      {/* Live Mode Banner */}
      {isLive && (
        <div className="rounded-lg border-2 border-red-500 bg-red-50 p-4 text-center">
          <div className="text-lg font-bold text-red-700">LIVE MODE ACTIVE</div>
          <div className="text-sm text-red-600 mt-1">Manual approval still required for all orders.</div>
        </div>
      )}

      {/* Kill Switch Banner */}
      {config?.killSwitchEnabled && (
        <div className="rounded-lg border-2 border-red-500 bg-red-50 p-4 text-center">
          <div className="text-lg font-bold text-red-700">KILL SWITCH ACTIVE</div>
          <div className="text-sm text-red-600 mt-1">All execution is blocked.</div>
        </div>
      )}

      {/* A. Readiness Status Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Overall</div>
          <div className={`text-lg font-bold ${readiness?.ready ? 'text-green-600' : 'text-red-600'}`}>
            {readiness?.ready ? 'READY' : 'NOT READY'}
          </div>
        </div>
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Critical Failures</div>
          <div className={`text-lg font-bold ${(readiness?.criticalFailures || 0) > 0 ? 'text-red-600' : 'text-green-600'}`}>
            {readiness?.criticalFailures || 0}
          </div>
        </div>
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Warnings</div>
          <div className={`text-lg font-bold ${(readiness?.warnings || 0) > 0 ? 'text-amber-600' : 'text-green-600'}`}>
            {readiness?.warnings || 0}
          </div>
        </div>
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Current Mode</div>
          <div className={`text-lg font-bold ${isLive ? 'text-red-600' : config?.mode === 'demo' ? 'text-yellow-600' : 'text-gray-600'}`}>
            {config?.mode?.toUpperCase()}
          </div>
        </div>
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Kill Switch</div>
          <div className={`text-lg font-bold ${config?.killSwitchEnabled ? 'text-red-600' : 'text-green-600'}`}>
            {config?.killSwitchEnabled ? 'ACTIVE' : 'OFF'}
          </div>
        </div>
      </div>

      {/* B. Full Checklist Table */}
      <div className={cardClass}>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Readiness Checklist</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className={thClass}>Category</th>
                <th className={thClass}>Check</th>
                <th className={thClass}>Status</th>
                <th className={thClass}>Severity</th>
                <th className={thClass}>Message</th>
              </tr>
            </thead>
            <tbody>
              {categories.map(cat =>
                readiness?.checks.filter(c => c.category === cat).map(c => (
                  <tr key={c.key} className={`border-b border-gray-50 ${!c.passed ? 'bg-red-50/30' : ''}`}>
                    <td className={`${tdClass} text-xs text-gray-500`}>{c.category}</td>
                    <td className={`${tdClass} font-medium`}>{c.label}</td>
                    <td className={tdClass}>
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${c.passed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {c.passed ? 'PASS' : 'FAIL'}
                      </span>
                    </td>
                    <td className={tdClass}>
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${SEV_COLORS[c.severity] || ''}`}>
                        {c.severity}
                      </span>
                    </td>
                    <td className={`${tdClass} text-xs`}>{c.message}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* C. Operator Preflight Panel */}
      <div className={cardClass}>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Operator Preflight Checklist</h2>

        {preflight && (
          <div className="mb-4 rounded border border-green-200 bg-green-50 p-3 text-sm">
            <div className="font-semibold text-green-700">Last Preflight: {formatET(preflight.createdAt)}</div>
            <div className="text-green-600 text-xs mt-1">
              Confirmed: {preflight.confirmedItems.join(', ')}
              {preflight.notes && <span className="ml-2">— {preflight.notes}</span>}
            </div>
          </div>
        )}

        <div className="space-y-3">
          {preflightItems.map(item => (
            <label key={item.key} className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={pfChecked[item.key] || false}
                onChange={e => setPfChecked(prev => ({ ...prev, [item.key]: e.target.checked }))}
                className="mt-1 h-4 w-4 rounded border-gray-300"
              />
              <div>
                <div className="text-sm font-medium text-gray-900">{item.label}</div>
                <div className="text-xs text-gray-500">{item.description}</div>
              </div>
            </label>
          ))}
        </div>

        <div className="mt-4">
          <label className="block text-xs font-medium text-gray-500 mb-1">Notes (optional)</label>
          <input
            type="text" value={pfNotes} onChange={e => setPfNotes(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            placeholder="Any additional notes..."
          />
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={submitPreflight}
            disabled={pfSubmitting || Object.values(pfChecked).filter(Boolean).length === 0}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {pfSubmitting ? 'Submitting...' : 'Submit Preflight'}
          </button>
          <span className="text-xs text-gray-500">
            {Object.values(pfChecked).filter(Boolean).length}/{preflightItems.length} items checked
          </span>
        </div>

        <div className="mt-4 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <strong>Risk Acknowledgement:</strong> By completing this preflight, I confirm I understand the risks of live trading,
          know how to activate the kill switch, and have tested demo execution. Live mode requires manual approval for every order.
          No autonomous trading will occur.
        </div>
      </div>

      {/* Live Guardrails */}
      {guardrails && (
        <div className={cardClass}>
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Live Mode Guardrails (Stricter Than Demo)</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded border border-gray-100 p-2">
              <div className="text-xs text-gray-500">Max Order Size</div>
              <div className="text-sm font-bold text-gray-900">{fmtUSD(guardrails.maxOrderSizeCents)}</div>
            </div>
            <div className="rounded border border-gray-100 p-2">
              <div className="text-xs text-gray-500">Min Edge</div>
              <div className="text-sm font-bold text-gray-900">{(guardrails.minEdgeThreshold * 100).toFixed(0)}%</div>
            </div>
            <div className="rounded border border-gray-100 p-2">
              <div className="text-xs text-gray-500">Max Spread</div>
              <div className="text-sm font-bold text-gray-900">{(guardrails.maxSpreadThreshold * 100).toFixed(0)}%</div>
            </div>
            <div className="rounded border border-gray-100 p-2">
              <div className="text-xs text-gray-500">Require Approval</div>
              <div className="text-sm font-bold text-green-600">{guardrails.requireApproval ? 'YES' : 'NO'}</div>
            </div>
            <div className="rounded border border-gray-100 p-2">
              <div className="text-xs text-gray-500">Require Dry Run</div>
              <div className="text-sm font-bold text-green-600">{guardrails.requireDryRun ? 'YES' : 'NO'}</div>
            </div>
            <div className="rounded border border-gray-100 p-2">
              <div className="text-xs text-gray-500">Audit Before Submit</div>
              <div className="text-sm font-bold text-green-600">{guardrails.requireAuditBeforeSubmit ? 'YES' : 'NO'}</div>
            </div>
          </div>
        </div>
      )}

      {/* D. Live Mode Activation Panel */}
      <div className={`${cardClass} ${isLive ? 'border-red-300 bg-red-50/30' : ''}`}>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Live Mode Control</h2>

        <div className="mb-3 text-sm">
          <span className="text-gray-500">Current Mode: </span>
          <span className={`font-bold ${isLive ? 'text-red-600' : 'text-gray-900'}`}>{config?.mode?.toUpperCase()}</span>
        </div>

        {!isLive ? (
          <div className="space-y-3">
            <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <strong>To enable live mode:</strong> liveTradingEnabled must be true, all critical readiness checks must pass,
              operator preflight must be completed within 24 hours, and kill switch must be off.
            </div>
            <button
              onClick={() => setShowLiveModal(true)}
              disabled={!readiness?.ready}
              className="rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              Request Live Mode Activation
            </button>
            {!readiness?.ready && (
              <div className="text-xs text-red-600">Cannot enable: {readiness?.criticalFailures} critical check(s) failed</div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <button
              onClick={doDisableLive}
              disabled={liveActing}
              className="rounded bg-gray-600 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
            >
              {liveActing ? 'Disabling...' : 'Disable Live Mode (Revert to Paper)'}
            </button>
          </div>
        )}
      </div>

      {/* Live Mode Confirmation Modal */}
      {showLiveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-red-700">Enable Live Trading</h3>

            <div className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <strong>WARNING:</strong> You are about to enable LIVE trading mode. Real orders will be submitted
              to Kalshi with real money. Manual approval is still required for each order.
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Type <strong>ENABLE LIVE TRADING</strong> to confirm:
              </label>
              <input
                type="text"
                value={confirmPhrase}
                onChange={e => setConfirmPhrase(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono"
                placeholder="ENABLE LIVE TRADING"
              />
            </div>

            {liveError && (
              <div className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{liveError}</div>
            )}

            <div className="mt-4 flex gap-3 justify-end">
              <button
                onClick={() => { setShowLiveModal(false); setConfirmPhrase(''); setLiveError(''); }}
                className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >Cancel</button>
              <button
                onClick={doEnableLive}
                disabled={liveActing || confirmPhrase.trim() !== 'ENABLE LIVE TRADING'}
                className="rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {liveActing ? 'Enabling...' : 'Confirm Enable Live'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* E. Emergency Actions Panel */}
      <div className={`${cardClass} border-red-200`}>
        <h2 className="mb-3 text-sm font-semibold text-red-700">Emergency Actions</h2>
        <div className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800 mb-4">
          Emergency shutdown will: enable kill switch, disable live trading, and revert to paper mode immediately.
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Emergency Notes (optional)</label>
            <input
              type="text" value={emergencyNotes} onChange={e => setEmergencyNotes(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
              placeholder="Reason for emergency shutdown..."
            />
          </div>

          <div className="flex gap-3">
            {isLive && (
              <button
                onClick={doDisableLive}
                disabled={emergencyActing}
                className="rounded bg-gray-600 px-4 py-2 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
              >Disable Live</button>
            )}
            <button
              onClick={doEmergencyShutdown}
              disabled={emergencyActing}
              className="rounded bg-red-700 px-4 py-2 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-50"
            >
              {emergencyActing ? 'Shutting Down...' : 'EMERGENCY SHUTDOWN'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

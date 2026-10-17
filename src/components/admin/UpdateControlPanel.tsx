import { useState, useEffect } from 'react';

interface UpdateSettings {
  autoUpdateEnabled: boolean;
  updatesPerHour: number;
  lastUpdated: number;
  nextScheduledUpdate: number;
}

export default function UpdateControlPanel() {
  const [settings, setSettings] = useState<UpdateSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [manualUpdateType, setManualUpdateType] = useState<'weather' | 'sports' | 'odds' | 'nws' | 'all'>('all');
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);

  // Load settings on mount
  useEffect(() => {
    fetchSettings();
  }, []);

  // Poll job status
  useEffect(() => {
    if (!jobId) return;

    const interval = setInterval(async () => {
      const res = await fetch(`/api/admin/update-control/job-status?jobId=${jobId}`);
      const data = await res.json();
      setJobStatus(data.status);

      if (data.status === 'completed' || data.status === 'failed') {
        clearInterval(interval);
        setTimeout(fetchSettings, 1000);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [jobId]);

  async function fetchSettings() {
    try {
      const res = await fetch('/api/admin/update-control/settings');
      const data = await res.json();
      setSettings(data);
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      setLoading(false);
    }
  }

  async function toggleAutoUpdate() {
    if (!settings) return;
    setSaving(true);

    try {
      const res = await fetch('/api/admin/update-control/toggle-auto', {
        method: 'POST',
        body: JSON.stringify({
          enabled: !settings.autoUpdateEnabled,
        }),
      });
      const data = await res.json();
      setSettings(data);
    } catch (err) {
      console.error('Failed to toggle auto-update:', err);
    } finally {
      setSaving(false);
    }
  }

  async function updateFrequency(frequency: number) {
    if (!settings) return;
    setSaving(true);

    try {
      const res = await fetch('/api/admin/update-control/frequency', {
        method: 'POST',
        body: JSON.stringify({ frequency }),
      });
      const data = await res.json();
      setSettings(data);
    } catch (err) {
      console.error('Failed to update frequency:', err);
    } finally {
      setSaving(false);
    }
  }

  async function triggerManualUpdate() {
    setSaving(true);

    try {
      const res = await fetch('/api/admin/update-control/trigger', {
        method: 'POST',
        body: JSON.stringify({ type: manualUpdateType }),
      });
      const data = await res.json();
      setJobId(data.jobId);
      setJobStatus('pending');
    } catch (err) {
      console.error('Failed to trigger update:', err);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="p-8 text-center">Loading settings...</div>;
  }

  if (!settings) {
    return <div className="p-8 text-center text-red-500">Failed to load settings</div>;
  }

  const lastUpdatedTime = settings.lastUpdated ? new Date(settings.lastUpdated).toLocaleString() : 'Never';
  const nextUpdateTime = settings.nextScheduledUpdate ? new Date(settings.nextScheduledUpdate).toLocaleString() : 'Not scheduled';

  return (
    <div className="max-w-2xl mx-auto p-8 bg-slate-800 rounded-lg shadow-lg text-white">
      <h1 className="text-3xl font-bold mb-8">Update Control</h1>

      {/* Auto-Update Toggle */}
      <section className="mb-8 p-6 bg-slate-700 rounded-lg border border-slate-600">
        <h2 className="text-xl font-semibold mb-4 text-white">Auto-Update Settings</h2>

        <div className="flex items-center justify-between mb-6">
          <label className="text-lg font-medium">Enable Auto-Update</label>
          <button
            onClick={toggleAutoUpdate}
            disabled={saving}
            className={`px-6 py-2 rounded-lg font-medium transition ${
              settings.autoUpdateEnabled
                ? 'bg-green-500 text-white hover:bg-green-600'
                : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
            } ${saving ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {settings.autoUpdateEnabled ? 'ON' : 'OFF'}
          </button>
        </div>

        {settings.autoUpdateEnabled && (
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Updates Per Hour (1-60)</label>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min="1"
                max="60"
                value={settings.updatesPerHour}
                onChange={(e) => updateFrequency(parseInt(e.target.value))}
                disabled={saving}
                className="flex-1"
              />
              <span className="text-lg font-semibold w-16 text-right">{settings.updatesPerHour}</span>
            </div>
            <p className="text-sm text-gray-600 mt-2">
              Update interval: every {(3600 / settings.updatesPerHour).toFixed(1)} seconds
            </p>
          </div>
        )}

        <div className="mt-6 p-4 bg-blue-50 rounded border border-blue-200">
          <p className="text-sm text-gray-700">
            <span className="font-semibold">Last updated:</span> {lastUpdatedTime}
          </p>
          <p className="text-sm text-gray-700 mt-1">
            <span className="font-semibold">Next scheduled:</span> {nextUpdateTime}
          </p>
        </div>
      </section>

      {/* Manual Update */}
      <section className="mb-8 p-6 bg-gray-50 rounded-lg">
        <h2 className="text-xl font-semibold mb-4">Manual Update</h2>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Update Type</label>
          <select
            value={manualUpdateType}
            onChange={(e) => setManualUpdateType(e.target.value as any)}
            disabled={saving || jobStatus === 'running'}
            className="w-full p-2 border border-gray-300 rounded"
          >
            <option value="all">All Data Sources</option>
            <option value="weather">Weather Only</option>
            <option value="sports">Sports Schedules Only</option>
            <option value="odds">Odds Only</option>
            <option value="nws">NWS Observations Only</option>
          </select>
        </div>

        <button
          onClick={triggerManualUpdate}
          disabled={saving || jobStatus === 'running'}
          className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {jobStatus === 'running' ? 'Updating...' : 'Trigger Manual Update'}
        </button>

        {jobId && (
          <div className="mt-4 p-4 bg-blue-50 rounded border border-blue-200">
            <p className="text-sm text-gray-700">
              <span className="font-semibold">Job ID:</span> {jobId}
            </p>
            <p className="text-sm text-gray-700 mt-1">
              <span className="font-semibold">Status:</span>
              <span className={`ml-2 inline-block px-2 py-1 rounded text-white text-xs font-semibold ${
                jobStatus === 'completed' ? 'bg-green-500' :
                jobStatus === 'running' ? 'bg-blue-500' :
                jobStatus === 'failed' ? 'bg-red-500' :
                'bg-gray-500'
              }`}>
                {jobStatus?.toUpperCase()}
              </span>
            </p>
          </div>
        )}
      </section>

      {/* Info */}
      <section className="p-6 bg-amber-50 rounded-lg border border-amber-200">
        <h3 className="font-semibold text-amber-900 mb-2">ℹ️ How This Works</h3>
        <ul className="text-sm text-amber-800 space-y-1">
          <li>• <strong>Auto-Update OFF:</strong> No automatic updates; use Manual Update only</li>
          <li>• <strong>Auto-Update ON:</strong> Updates run automatically at your chosen frequency</li>
          <li>• <strong>Updates Per Hour:</strong> 1 = every hour, 60 = every minute</li>
          <li>• <strong>Manual Update:</strong> Immediately trigger an update for any data source</li>
        </ul>
      </section>
    </div>
  );
}

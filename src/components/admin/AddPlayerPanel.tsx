import { useState } from 'react';

/**
 * Add a player with a temporary password and a play-money bankroll
 * (DBD 2026-11-20). Calls /api/admin/users/create. The temporary password is
 * shown here once; the player must replace it at first sign-in (/set-password)
 * before they can bet on the sportsbook or the weather wagers.
 */
export default function AddPlayerPanel({ onCreated }: { onCreated?: () => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [bankroll, setBankroll] = useState('100000');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; tempPassword: string; dollars: number } | null>(null);

  const submit = async () => {
    setLoading(true);
    setError(null);
    setCreated(null);
    try {
      const dollars = Number(bankroll.replace(/[$,\s]/g, ''));
      const res = await fetch('/api/admin/users/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), displayName: name.trim(), startingBalanceDollars: dollars }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Failed (${res.status})`);
        return;
      }
      setCreated({ email: data.user.email, tempPassword: data.tempPassword, dollars });
      setEmail('');
      setName('');
      setBankroll('100000');
      onCreated?.();
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="mb-1 text-sm font-semibold text-gray-900">Add Player</h3>
      <p className="mb-3 text-xs text-gray-500">
        Their email is their user name. They get a temporary password and must choose their own the first
        time they sign in, before they can bet. Change their bankroll any time with Adjust Player Balance below.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-gray-500">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="player@example.com"
            className="w-56 rounded-lg border border-gray-200 bg-gray-100 px-3 py-2 text-sm text-gray-900 outline-none focus:border-field"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">Name (optional)</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-40 rounded-lg border border-gray-200 bg-gray-100 px-3 py-2 text-sm text-gray-900 outline-none focus:border-field"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">Starting bankroll ($)</label>
          <input
            type="text"
            inputMode="numeric"
            value={bankroll}
            onChange={(e) => setBankroll(e.target.value)}
            className="w-32 rounded-lg border border-gray-200 bg-gray-100 px-3 py-2 text-sm text-gray-900 outline-none focus:border-field"
          />
        </div>
        <button
          onClick={submit}
          disabled={loading || !email.trim()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? '...' : 'Add Player'}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">Error: {error}</p>}
      {created && (
        <div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-gray-900">
          <p>
            Added <strong>{created.email}</strong> with ${created.dollars.toLocaleString('en-US')} play money.
          </p>
          <p className="mt-1">
            Temporary password: <code className="rounded bg-white px-1.5 py-0.5 font-mono text-base">{created.tempPassword}</code>
          </p>
          <p className="mt-1 text-xs text-gray-600">
            Send it to them yourself. It is shown only this once. They sign in at wageronweather.com with their
            email and this password, then choose their own.
          </p>
        </div>
      )}
    </div>
  );
}

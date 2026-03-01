import { useState } from 'react';

export default function AdminLogin() {
  const [username, setUsername] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, passphrase }),
      });

      if (res.ok) {
        window.location.href = '/admin/wagers';
      } else {
        const data = await res.json();
        setError(data.error || 'Login failed');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-sm">
      <div className="rounded-xl border border-border-dark bg-surface-dark-alt p-8">
        <h2 className="mb-6 text-center text-xl font-bold text-text-dark">Admin Login</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="username" className="mb-1 block text-sm text-text-dark-muted">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full rounded-lg border border-border-dark bg-surface-dark px-4 py-3 text-sm text-text-dark outline-none focus:border-field focus:ring-2 focus:ring-field/20"
              placeholder="Enter username"
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="passphrase" className="mb-1 block text-sm text-text-dark-muted">
              Passphrase
            </label>
            <input
              id="passphrase"
              type="password"
              value={passphrase}
              onChange={e => setPassphrase(e.target.value)}
              className="w-full rounded-lg border border-border-dark bg-surface-dark px-4 py-3 text-sm text-text-dark outline-none focus:border-field focus:ring-2 focus:ring-field/20"
              placeholder="Enter admin passphrase"
            />
          </div>
          {error && (
            <div className="rounded-lg bg-alert/10 px-3 py-2 text-sm text-alert-light">{error}</div>
          )}
          <button
            type="submit"
            disabled={loading || !username || !passphrase}
            className="w-full rounded-lg bg-field px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-field-light disabled:opacity-50"
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
}

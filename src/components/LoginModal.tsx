import { useState } from 'react';

interface LoginModalProps {
  onClose: () => void;
}

export function LoginModal({ onClose }: LoginModalProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (res.ok) {
        window.location.reload();
      } else {
        const data = await res.json();
        setError(data.error || 'Login failed');
      }
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6 dark:border-border-dark dark:bg-surface-dark-alt">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-text dark:text-text-dark">Sign In</h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text dark:text-text-dark-muted dark:hover:text-text-dark"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-text dark:text-text-dark">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-1 w-full rounded border border-border bg-white px-3 py-2 text-sm dark:border-border-dark dark:bg-surface-dark"
              placeholder="your@email.com"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-text dark:text-text-dark">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="mt-1 w-full rounded border border-border bg-white px-3 py-2 text-sm dark:border-border-dark dark:bg-surface-dark"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="rounded border border-alert/30 bg-alert/10 px-3 py-2 text-sm text-alert-light dark:bg-alert/10 dark:text-alert-light">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-field px-4 py-2 font-semibold text-white hover:bg-field-dark disabled:opacity-50 dark:bg-field-light dark:text-field dark:hover:bg-field-light/80 dark:disabled:opacity-50"
          >
            {loading ? 'Signing In...' : 'Sign In'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-text-muted dark:text-text-dark-muted">
          Don't have an account?{' '}
          <a
            href="/auth/login"
            className="font-semibold text-field hover:underline dark:text-field-light"
          >
            Register here
          </a>
        </p>
      </div>
    </div>
  );
}

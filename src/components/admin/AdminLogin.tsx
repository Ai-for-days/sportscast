import { useState } from 'react';

export default function AdminLogin() {
  const [username, setUsername] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
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
        const data = await res.json();
        if (data.passwordResetRequired && data.resetToken) {
          setResetToken(data.resetToken);
          setNotice(data.message || 'Temporary password accepted. Create a new password to continue.');
          setPassphrase('');
          return;
        }
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

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/admin/complete-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetToken, password: newPassword }),
      });
      if (res.ok) {
        window.location.href = '/admin/wagers';
      } else {
        const data = await res.json();
        setError(data.error || 'Could not reset password.');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-sm">
      <div className="rounded-xl border border-gray-200 bg-white p-8">
        <h2 className="mb-6 text-center text-xl font-bold text-gray-900">
          {resetToken ? 'Create New Password' : 'Admin Login'}
        </h2>
        {resetToken ? (
        <form onSubmit={handleResetSubmit} className="space-y-4">
          <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
            Your temporary password worked. Set your own password before entering the admin dashboard.
          </p>
          <div>
            <label htmlFor="new-password" className="mb-1 block text-sm text-gray-500">
              New password
            </label>
            <input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-gray-100 px-4 py-3 text-sm text-gray-900 outline-none focus:border-field focus:ring-2 focus:ring-field/20"
              placeholder="At least 8 characters"
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="confirm-password" className="mb-1 block text-sm text-gray-500">
              Confirm password
            </label>
            <input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-gray-100 px-4 py-3 text-sm text-gray-900 outline-none focus:border-field focus:ring-2 focus:ring-field/20"
              placeholder="Re-enter new password"
            />
          </div>
          {error && (
            <div className="rounded-lg bg-alert/10 px-3 py-2 text-sm text-red-600">{error}</div>
          )}
          <button
            type="submit"
            disabled={loading || !newPassword || !confirmPassword}
            className="w-full rounded-lg bg-field px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-field-light disabled:opacity-50"
          >
            {loading ? 'Saving...' : 'Save Password and Continue'}
          </button>
        </form>
        ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="username" className="mb-1 block text-sm text-gray-500">
              Email <span className="text-gray-400">(employees)</span> or username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-gray-100 px-4 py-3 text-sm text-gray-900 outline-none focus:border-field focus:ring-2 focus:ring-field/20"
              placeholder="you@email.com"
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="passphrase" className="mb-1 block text-sm text-gray-500">
              Password or admin passphrase
            </label>
            <input
              id="passphrase"
              type="password"
              value={passphrase}
              onChange={e => setPassphrase(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-gray-100 px-4 py-3 text-sm text-gray-900 outline-none focus:border-field focus:ring-2 focus:ring-field/20"
              placeholder="Your password or passphrase"
            />
          </div>
          {error && (
            <div className="rounded-lg bg-alert/10 px-3 py-2 text-sm text-red-600">{error}</div>
          )}
          {notice && (
            <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">{notice}</div>
          )}
          <button
            type="submit"
            disabled={loading || !username || !passphrase}
            className="w-full rounded-lg bg-field px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-field-light disabled:opacity-50"
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
        )}
      </div>
    </div>
  );
}

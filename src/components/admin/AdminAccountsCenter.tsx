import { useEffect, useState } from 'react';

interface AdminAccount {
  id: string;
  email: string;
  displayName: string;
  role: string;
  status: 'active' | 'disabled';
  passwordResetRequired?: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export default function AdminAccountsCenter() {
  const [admins, setAdmins] = useState<AdminAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // create form
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'super_admin'>('admin');
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/admins?action=list');
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      const data = await res.json();
      if (!res.ok) setError(data.error || 'Failed to load.');
      else setAdmins(data.admins || []);
    } catch {
      setError('Network error.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function post(payload: Record<string, unknown>): Promise<any> {
    const res = await fetch('/api/admin/admins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError('');
    setNotice('');
    const { ok, data } = await post({ action: 'create', email, displayName, password, role });
    setCreating(false);
    if (!ok) {
      setError(data.error || 'Could not create admin.');
      return;
    }
    setNotice(
      `Created ${data.account.email}. Share the login + temporary password. They must create their own password before entering admin.`
    );
    setEmail('');
    setDisplayName('');
    setPassword('');
    setRole('admin');
    load();
  }

  async function toggleStatus(a: AdminAccount) {
    setError('');
    const next = a.status === 'active' ? 'disabled' : 'active';
    const { ok, data } = await post({ action: 'set-status', id: a.id, status: next });
    if (!ok) setError(data.error || 'Could not update.');
    else load();
  }

  async function resetPassword(a: AdminAccount) {
    setError('');
    setNotice('');
    const pw = window.prompt(`Set a temporary password for ${a.email} (min 8 chars):`);
    if (pw == null) return;
    const { ok, data } = await post({ action: 'reset-password', id: a.id, password: pw });
    if (!ok) setError(data.error || 'Could not reset password.');
    else {
      setNotice(`Temporary password set for ${a.email}. They must create their own password on next login.`);
      load();
    }
  }

  if (forbidden) {
    return (
      <div className="mx-auto max-w-2xl rounded-xl border border-amber-200 bg-amber-50 p-6">
        <h1 className="text-lg font-bold text-amber-900">Owner only</h1>
        <p className="mt-1 text-sm text-amber-800">
          Only the owner can add or manage admins. You have full access to everything else.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-5">
        <h1 className="text-2xl font-extrabold text-gray-900">Manage Admins</h1>
        <p className="mt-1 text-sm text-gray-500">
          Add employees as admins. Each gets their own email + password login and full dashboard access —
          everything you can do <strong>except</strong> adding or managing other admins. You stay the owner.
        </p>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {notice && <div className="mb-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</div>}

      {/* Add admin */}
      <form onSubmit={handleCreate} className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">Add an admin</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input
            type="text" value={displayName} onChange={e => setDisplayName(e.target.value)}
            placeholder="Full name" required
            className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none focus:border-field"
          />
          <input
            type="text" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="Email or username (e.g. admin)" required
            className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none focus:border-field"
          />
          <input
            type="text" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Temporary password (min 8)" required minLength={8}
            className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none focus:border-field"
          />
          <select
            value={role} onChange={e => setRole(e.target.value as 'admin' | 'super_admin')}
            className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none focus:border-field"
          >
            <option value="admin">Admin (employee — full except admins)</option>
            <option value="super_admin">Owner (full + can add admins)</option>
          </select>
        </div>
        <button
          type="submit" disabled={creating}
          className="mt-3 rounded-lg bg-field px-4 py-2 text-sm font-semibold text-white hover:bg-field-light disabled:opacity-50"
        >
          {creating ? 'Adding…' : 'Add admin'}
        </button>
        <p className="mt-2 text-xs text-gray-400">
          You set a temporary password. On first login, they must create their own password before entering admin.
        </p>
      </form>

      {/* Existing admins */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">Admins</h2>
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : admins.length === 0 ? (
          <p className="text-sm text-gray-500">No employee admins yet. You (the owner) sign in with the passphrase.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="border-b border-gray-200 px-2 py-2">Name</th>
                  <th className="border-b border-gray-200 px-2 py-2">Email</th>
                  <th className="border-b border-gray-200 px-2 py-2">Role</th>
                  <th className="border-b border-gray-200 px-2 py-2">Status</th>
                  <th className="border-b border-gray-200 px-2 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {admins.map(a => (
                  <tr key={a.id} className="text-gray-800">
                    <td className="border-b border-gray-100 px-2 py-2 font-medium">{a.displayName}</td>
                    <td className="border-b border-gray-100 px-2 py-2">{a.email}</td>
                    <td className="border-b border-gray-100 px-2 py-2">
                      {a.role === 'super_admin' ? 'Owner (full + admins)' : 'Admin (full, no admin mgmt)'}
                    </td>
                    <td className="border-b border-gray-100 px-2 py-2">
                      <span className={a.status === 'active' ? 'text-green-600' : 'text-gray-400'}>{a.status}</span>
                      {a.passwordResetRequired && (
                        <span className="ml-2 inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                          password reset required
                        </span>
                      )}
                    </td>
                    <td className="border-b border-gray-100 px-2 py-2">
                      <div className="flex gap-2">
                        <button onClick={() => toggleStatus(a)} className="rounded border border-gray-200 px-2 py-1 text-xs hover:bg-gray-50">
                          {a.status === 'active' ? 'Disable' : 'Enable'}
                        </button>
                        <button onClick={() => resetPassword(a)} className="rounded border border-gray-200 px-2 py-1 text-xs hover:bg-gray-50">
                          Reset password
                        </button>
                      </div>
                    </td>
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

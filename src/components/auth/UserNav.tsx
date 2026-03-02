import { useState, useEffect, useRef } from 'react';

interface UserInfo {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
}

export default function UserNav() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(data => setUser(data.user || null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/';
  };

  if (loading) return null;

  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <a
          href="/login"
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-text-dark-muted transition-colors hover:text-text-dark"
        >
          Log in
        </a>
        <a
          href="/signup"
          className="rounded-lg bg-field px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-field-light"
        >
          Sign up
        </a>
      </div>
    );
  }

  const initials = user.displayName
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-dark-alt"
      >
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt="" className="h-7 w-7 rounded-full" referrerPolicy="no-referrer" />
        ) : (
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-field/20 text-xs font-bold text-field-light">
            {initials}
          </div>
        )}
        <span className="hidden text-sm font-medium text-text-dark sm:inline">{user.displayName}</span>
        <svg className="h-4 w-4 text-text-dark-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-lg border border-border-dark bg-surface-dark shadow-xl">
          <div className="border-b border-border-dark px-4 py-2">
            <div className="text-sm font-medium text-text-dark">{user.displayName}</div>
            <div className="truncate text-xs text-text-dark-muted">{user.email}</div>
          </div>
          <div className="py-1">
            <a
              href="/account"
              className="block px-4 py-2 text-sm text-text-dark transition-colors hover:bg-surface-dark-alt"
            >
              Account
            </a>
            <button
              onClick={handleLogout}
              className="block w-full px-4 py-2 text-left text-sm text-alert-light transition-colors hover:bg-surface-dark-alt"
            >
              Log out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

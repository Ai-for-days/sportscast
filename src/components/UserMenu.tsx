import { useEffect, useState } from 'react';

interface User {
  id: string;
  displayName: string;
  email: string;
  avatarUrl?: string;
}

interface UserMenuProps {
  user: User;
  onLogout?: () => void;
}

export function UserMenu({ user, onLogout }: UserMenuProps) {
  const [balance, setBalance] = useState<number | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchBalance = async () => {
      try {
        const res = await fetch('/api/account/balance');
        if (res.ok) {
          const data = await res.json();
          setBalance(data.balanceDollars);
        }
      } catch (err) {
        console.error('Failed to fetch balance:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchBalance();
    // Poll balance every 5 seconds
    const interval = setInterval(fetchBalance, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      onLogout?.();
      window.location.href = '/auth/login';
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  if (loading || balance === null) {
    return <div className="text-sm text-text-muted dark:text-text-dark-muted">Loading...</div>;
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2 text-sm font-semibold text-text hover:bg-surface-dark dark:bg-surface-dark-alt dark:text-text-dark dark:hover:bg-surface-dark"
      >
        {user.avatarUrl && (
          <img
            src={user.avatarUrl}
            alt={user.displayName}
            className="w-5 h-5 rounded-full"
          />
        )}
        <span>{user.displayName || user.email.split('@')[0]}</span>
        <span>▼</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 rounded-lg border border-border bg-surface shadow-lg dark:border-border-dark dark:bg-surface-dark-alt">
          <div className="px-4 py-3 border-b border-border dark:border-border-dark">
            <p className="text-xs text-text-muted dark:text-text-dark-muted">Balance</p>
            <p className="text-lg font-semibold text-text dark:text-text-dark">
              ${balance?.toFixed(2) || 'Loading...'}
            </p>
          </div>
          <button
            onClick={handleLogout}
            className="w-full px-4 py-2 text-left text-sm text-text-muted hover:bg-surface-dark dark:text-text-dark-muted dark:hover:bg-surface-dark-alt"
          >
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { UserMenu } from './UserMenu';
import { LoginModal } from './LoginModal';

interface User {
  id: string;
  displayName: string;
  email: string;
  avatarUrl?: string;
  emailVerified?: boolean;
}

export function Header() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showLoginModal, setShowLoginModal] = useState(false);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const res = await fetch('/api/auth/me');
        const data = await res.json();
        setUser(data.user || null);
      } catch (err) {
        console.error('Failed to fetch user:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchUser();
  }, []);

  const handleLogout = () => {
    setUser(null);
  };

  if (loading) {
    return (
      <header className="border-b border-border bg-surface dark:border-border-dark dark:bg-surface-dark">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
          <h1 className="text-xl font-bold">The Weatherboard</h1>
          <div className="w-20 h-8 bg-surface-dark rounded animate-pulse" />
        </div>
      </header>
    );
  }

  return (
    <header className="border-b border-border bg-surface dark:border-border-dark dark:bg-surface-dark">
      <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
        <h1 className="text-xl font-bold text-text dark:text-text-dark">The Weatherboard</h1>

        <div className="flex items-center gap-4">
          {user ? (
            <UserMenu user={user} onLogout={handleLogout} />
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => setShowLoginModal(true)}
                className="px-4 py-2 text-sm font-semibold rounded border border-field text-field hover:bg-field/10 dark:border-field-light dark:text-field-light dark:hover:bg-field-light/10"
              >
                Login
              </button>
              <a
                href="/auth/login"
                className="px-4 py-2 text-sm font-semibold rounded bg-field text-white hover:bg-field-dark dark:bg-field-light dark:text-field dark:hover:bg-field-light/80"
              >
                Register
              </a>
            </div>
          )}
        </div>

        {showLoginModal && (
          <LoginModal onClose={() => setShowLoginModal(false)} />
        )}
      </div>
    </header>
  );
}

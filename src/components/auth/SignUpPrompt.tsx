import { useEffect, useState } from 'react';
import { LoginModal } from '../LoginModal';

/**
 * Shown when a signed-out visitor clicks a price or a weather wager
 * (DBD 2026-11-20: "People should be able to click on a wager and it ask them
 * to register"; WOW-038). Presentation only: "Create account" goes to the
 * existing sign-up page with no return-to parameter, and "Log in" opens the
 * existing LoginModal in place, which reloads this page after sign-in.
 */
export default function SignUpPrompt({ onClose }: { onClose: () => void }) {
  const [login, setLogin] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (login) return <LoginModal onClose={onClose} />;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" role="dialog" aria-modal="true" aria-labelledby="signup-prompt-title" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 text-center shadow-xl dark:border-border-dark dark:bg-surface-dark-alt" onClick={(e) => e.stopPropagation()}>
        <h2 id="signup-prompt-title" className="text-lg font-bold text-text dark:text-text-dark">Create a free account to bet</h2>
        <p className="mt-2 text-sm text-text-muted dark:text-text-dark-muted">
          New players start with $100,000 in play money. Practice play only, no real money.
        </p>
        <a href="/auth/login" className="mt-5 block w-full rounded-lg bg-field px-4 py-2.5 text-sm font-semibold text-white hover:bg-field-dark">
          Create account
        </a>
        <button type="button" onClick={() => setLogin(true)} className="mt-2 w-full rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-text hover:bg-surface-alt dark:border-border-dark dark:text-text-dark">
          I already have an account
        </button>
        <button type="button" onClick={onClose} className="mt-3 text-xs text-text-muted hover:underline dark:text-text-dark-muted">Not now</button>
      </div>
    </div>
  );
}

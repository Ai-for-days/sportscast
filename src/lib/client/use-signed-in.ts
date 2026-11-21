import { useEffect, useState } from 'react';

// Whether the visitor is signed in as a player, read once per page from
// GET /api/auth/me (read-only). null while unknown. Shared by every island on
// the page so the request is made once. WOW-038.
let pending: Promise<boolean> | null = null;

export function fetchSignedIn(): Promise<boolean> {
  if (!pending) {
    pending = fetch('/api/auth/me', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : { user: null }))
      .then((j) => !!j?.user)
      .catch(() => false);
  }
  return pending;
}

export function useSignedIn(): boolean | null {
  const [v, setV] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    fetchSignedIn().then((s) => alive && setV(s));
    return () => { alive = false; };
  }, []);
  return v;
}

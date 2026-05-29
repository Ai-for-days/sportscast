// ── Step 174: Centralized noindex policy ────────────────────────────────
//
// Pure helper that decides whether a given pathname should emit
// `meta name="robots" content="noindex, nofollow"` regardless of what
// the page itself passes. Used by `BaseLayout.astro` as a defensive
// belt over per-page settings.
//
// **Public-flow contract:** the homepage, state hubs, city hubs, ZIP
// forecast pages, venues, map, historical, and other public content
// are NEVER classified as noindex by this helper. Only the route
// groups enumerated below qualify.
//
// **Companion**: `vercel.json` emits matching `X-Robots-Tag` headers
// for `/admin/(.*)` and `/api/admin/(.*)`. This helper covers the meta
// layer; the HTTP header layer covers requests that bypass page render
// (API routes, direct file serves).

export type NoIndexReason =
  | 'admin_surface'
  | 'admin_api_surface'
  | 'auth_surface'
  | 'account_surface'
  | 'system_or_dashboard'
  | 'preview_or_internal';

export interface NoIndexDecision {
  shouldNoIndex: boolean;
  /** Set when `shouldNoIndex === true`. */
  reason?: NoIndexReason;
}

/**
 * Pure classifier. Returns `shouldNoIndex: true` for any route in the
 * documented private / admin / auth / dashboard groups. Pure — only
 * inspects the pathname, no I/O.
 */
export function shouldNoIndexPathname(pathname: string): NoIndexDecision {
  if (!pathname || typeof pathname !== 'string') return { shouldNoIndex: false };
  const p = normalize(pathname);

  // Admin pages and admin API surfaces.
  if (p.startsWith('/admin')) return { shouldNoIndex: true, reason: 'admin_surface' };
  if (p.startsWith('/api/admin')) return { shouldNoIndex: true, reason: 'admin_api_surface' };

  // Auth surfaces.
  if (p === '/login' || p.startsWith('/login/')) {
    return { shouldNoIndex: true, reason: 'auth_surface' };
  }
  if (p === '/signup' || p.startsWith('/signup/')) {
    return { shouldNoIndex: true, reason: 'auth_surface' };
  }
  if (p.startsWith('/api/auth')) return { shouldNoIndex: true, reason: 'auth_surface' };

  // Authenticated user surfaces (account / dashboard / settings).
  if (p === '/account' || p.startsWith('/account/')) {
    return { shouldNoIndex: true, reason: 'account_surface' };
  }
  if (p.startsWith('/dashboard')) {
    return { shouldNoIndex: true, reason: 'system_or_dashboard' };
  }
  if (p.startsWith('/settings')) {
    return { shouldNoIndex: true, reason: 'system_or_dashboard' };
  }

  // Misc preview / internal route prefixes (kept narrow so no public
  // weather route accidentally falls in).
  if (p.startsWith('/preview') || p.startsWith('/internal') || p.startsWith('/_dev')) {
    return { shouldNoIndex: true, reason: 'preview_or_internal' };
  }

  return { shouldNoIndex: false };
}

/**
 * Convenience boolean — `true` when the pathname is in any private group.
 */
export function isNoIndexPathname(pathname: string): boolean {
  return shouldNoIndexPathname(pathname).shouldNoIndex;
}

function normalize(p: string): string {
  // Drop trailing slash (except for `/`).
  if (p.length > 1 && p.endsWith('/')) return p.slice(0, -1);
  return p;
}

// Convenience constants exported for tests + documentation.
export const NOINDEX_ROUTE_GROUPS: ReadonlyArray<{ prefix: string; reason: NoIndexReason }> = [
  { prefix: '/admin', reason: 'admin_surface' },
  { prefix: '/api/admin', reason: 'admin_api_surface' },
  { prefix: '/login', reason: 'auth_surface' },
  { prefix: '/signup', reason: 'auth_surface' },
  { prefix: '/api/auth', reason: 'auth_surface' },
  { prefix: '/account', reason: 'account_surface' },
  { prefix: '/dashboard', reason: 'system_or_dashboard' },
  { prefix: '/settings', reason: 'system_or_dashboard' },
  { prefix: '/preview', reason: 'preview_or_internal' },
  { prefix: '/internal', reason: 'preview_or_internal' },
  { prefix: '/_dev', reason: 'preview_or_internal' },
];

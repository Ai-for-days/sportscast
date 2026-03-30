import { defineMiddleware } from 'astro:middleware';
import { getSessionFromCookies, isReadOnly } from './lib/admin-auth';

/**
 * Middleware: block all POST requests to admin API routes for read-only (viewer) sessions.
 * Login and logout are exempted so viewers can authenticate and sign out.
 */
export const onRequest = defineMiddleware(async ({ request }, next) => {
  if (request.method !== 'POST') return next();

  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/admin')) return next();

  // Allow login and logout for everyone
  if (url.pathname === '/api/admin/login' || url.pathname === '/api/admin/logout') {
    return next();
  }

  const cookieHeader = request.headers.get('cookie');
  const sessionId = getSessionFromCookies(cookieHeader);
  if (sessionId && await isReadOnly(sessionId)) {
    return new Response(JSON.stringify({ error: 'Read-only access — mutations are not permitted' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return next();
});

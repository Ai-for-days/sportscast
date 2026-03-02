import type { APIRoute } from 'astro';
import { getRedis } from '../../../lib/redis';

const OAUTH_STATE_TTL = 600; // 10 minutes

function generateState(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let state = '';
  for (let i = 0; i < 32; i++) {
    state += chars[Math.floor(Math.random() * chars.length)];
  }
  return state;
}

export const GET: APIRoute = async () => {
  const clientId = import.meta.env.GOOGLE_CLIENT_ID;
  const redirectUri = import.meta.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return new Response(JSON.stringify({ error: 'Google OAuth not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Generate CSRF state token
  const state = generateState();
  const redis = getRedis();
  await redis.set(`oauth-state:${state}`, 'valid', { ex: OAUTH_STATE_TTL });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    },
  });
};

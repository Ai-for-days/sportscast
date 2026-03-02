import type { APIRoute } from 'astro';
import { getRedis } from '../../../../lib/redis';
import { createUserSession, makeUserSessionCookie } from '../../../../lib/user-auth';
import { createUser, getUserByEmail, getUserByGoogleId, linkGoogleAccount } from '../../../../lib/user-store';

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    return new Response(null, {
      status: 302,
      headers: { Location: '/login?error=oauth_denied' },
    });
  }

  if (!code || !state) {
    return new Response(null, {
      status: 302,
      headers: { Location: '/login?error=oauth_invalid' },
    });
  }

  // Verify CSRF state
  const redis = getRedis();
  const stateValid = await redis.get(`oauth-state:${state}`);
  if (!stateValid) {
    return new Response(null, {
      status: 302,
      headers: { Location: '/login?error=oauth_expired' },
    });
  }
  await redis.del(`oauth-state:${state}`);

  // Exchange code for tokens
  const clientId = import.meta.env.GOOGLE_CLIENT_ID;
  const clientSecret = import.meta.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = import.meta.env.GOOGLE_REDIRECT_URI;

  let tokenData: any;
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error('No access token');
  } catch {
    return new Response(null, {
      status: 302,
      headers: { Location: '/login?error=oauth_token_failed' },
    });
  }

  // Get user info from Google
  let googleUser: { sub: string; email: string; name: string; picture?: string };
  try {
    const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    googleUser = await infoRes.json();
    if (!googleUser.email) throw new Error('No email');
  } catch {
    return new Response(null, {
      status: 302,
      headers: { Location: '/login?error=oauth_profile_failed' },
    });
  }

  // Find or create user
  let user = await getUserByGoogleId(googleUser.sub);

  if (!user) {
    // Check if email exists (link Google to existing account)
    const existingByEmail = await getUserByEmail(googleUser.email);
    if (existingByEmail) {
      user = await linkGoogleAccount(existingByEmail.id, googleUser.sub, googleUser.picture);
    } else {
      // Create new user
      user = await createUser({
        email: googleUser.email,
        displayName: googleUser.name || googleUser.email.split('@')[0],
        googleId: googleUser.sub,
        avatarUrl: googleUser.picture,
        emailVerified: true,
      });
    }
  }

  if (!user) {
    return new Response(null, {
      status: 302,
      headers: { Location: '/login?error=oauth_create_failed' },
    });
  }

  // Create session
  const sessionId = await createUserSession(user.id);

  return new Response(null, {
    status: 302,
    headers: {
      Location: '/account',
      'Set-Cookie': makeUserSessionCookie(sessionId),
    },
  });
};

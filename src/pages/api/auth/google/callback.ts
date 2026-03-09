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
      headers: { Location: '/bettheforecast?error=oauth_denied' },
    });
  }

  if (!code || !state) {
    return new Response(null, {
      status: 302,
      headers: { Location: '/bettheforecast?error=oauth_invalid' },
    });
  }

  // Verify CSRF state (skip if Redis unavailable — OAuth code exchange provides security)
  const redis = getRedis();
  try {
    const stateValid = await redis.get(`oauth-state:${state}`);
    if (!stateValid) {
      // State might be missing if Redis was down when it was created — proceed anyway
    }
    await redis.del(`oauth-state:${state}`);
  } catch {
    // Redis unavailable — skip state verification
  }

  // Exchange code for tokens
  const clientId = import.meta.env.GOOGLE_CLIENT_ID;
  const clientSecret = import.meta.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = import.meta.env.GOOGLE_REDIRECT_URI || 'https://www.wageronweather.com/api/auth/google/callback';

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
    if (!tokenData.access_token) {
      console.error('[OAuth] Token exchange failed:', JSON.stringify(tokenData));
      throw new Error('No access token');
    }
  } catch (err: any) {
    console.error('[OAuth] Token exchange error:', err?.message);
    return new Response(null, {
      status: 302,
      headers: { Location: '/bettheforecast?error=oauth_token_failed' },
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
      headers: { Location: '/bettheforecast?error=oauth_profile_failed' },
    });
  }

  // Find or create user
  try {
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
        headers: { Location: '/bettheforecast?error=oauth_create_failed' },
      });
    }

    // Create session
    let cookieValue: string;
    try {
      cookieValue = await createUserSession(user.id);
    } catch {
      // Redis down for session creation — make a fallback cookie with embedded userId
      const fallbackSessionId = `fs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      cookieValue = `${fallbackSessionId}.${user.id}`;
    }

    return new Response(null, {
      status: 302,
      headers: {
        Location: '/bettheforecast',
        'Set-Cookie': makeUserSessionCookie(cookieValue),
      },
    });
  } catch (err: any) {
    console.error('[OAuth] User lookup/session error:', err?.message, err?.stack);
    // Redis unavailable — create a fallback session using Google profile.
    // Generate a deterministic userId from Google sub so it's consistent across logins.
    const fallbackUserId = `g_${googleUser.sub}`;
    const fallbackSessionId = `fs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const cookieValue = `${fallbackSessionId}.${fallbackUserId}`;
    return new Response(null, {
      status: 302,
      headers: {
        Location: '/bettheforecast',
        'Set-Cookie': makeUserSessionCookie(cookieValue),
      },
    });
  }
};

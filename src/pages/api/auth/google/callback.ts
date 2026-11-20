import type { APIRoute } from 'astro';
import { getRedis } from '../../../../lib/redis';
import { createUserSession, makeUserSessionCookie } from '../../../../lib/user-auth';
import { createUser, getUserByEmail, getUserByGoogleId, linkGoogleAccount } from '../../../../lib/user-store';
import { creditBalance, recordTransaction } from '../../../../lib/wallet-store';

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

  // Verify the CSRF state that /api/auth/google stored (WOW-037: this used to
  // proceed when the state was missing or Redis failed, which allowed login CSRF).
  const invalid = () => new Response(null, { status: 302, headers: { Location: '/bettheforecast?error=oauth_invalid' } });
  try {
    const redis = getRedis();
    const stateValid = await redis.get(`oauth-state:${state}`);
    if (!stateValid) return invalid();
    await redis.del(`oauth-state:${state}`);
  } catch {
    return invalid();
  }
  const sessionFailed = () => new Response(null, { status: 302, headers: { Location: '/bettheforecast?error=oauth_session_failed' } });

  // Exchange code for tokens
  // Read the same way as alert-email.ts, so the handler also runs under the test runner.
  const env = (name: string) => ((import.meta.env as any)?.[name] ?? process.env[name]) as string | undefined;
  const clientId = env('GOOGLE_CLIENT_ID') ?? '';
  const clientSecret = env('GOOGLE_CLIENT_SECRET') ?? '';
  const redirectUri = env('GOOGLE_REDIRECT_URI') || 'https://www.wageronweather.com/api/auth/google/callback';

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
    let isNewUser = false;

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
        isNewUser = true;
      }
    }

    // Auto-credit $100,000 play money for new users
    if (isNewUser && user) {
      const playMoneyAmount = 10_000_000;
      await creditBalance(user.id, playMoneyAmount);
      await recordTransaction({
        userId: user.id,
        type: 'deposit',
        amountCents: playMoneyAmount,
        balanceAfterCents: playMoneyAmount,
        description: 'Welcome bonus: $100,000 play money',
      });
    }

    if (!user) {
      return new Response(null, {
        status: 302,
        headers: { Location: '/bettheforecast?error=oauth_create_failed' },
      });
    }

    // Create session. No "fallback" cookie any more (WOW-037): a cookie with no
    // stored session is not a login. If Redis cannot store it, sign-in fails.
    let cookieValue: string;
    try {
      cookieValue = await createUserSession(user.id);
    } catch {
      return sessionFailed();
    }

    return new Response(null, {
      status: 302,
      headers: {
        Location: '/bettheforecast',
        'Set-Cookie': makeUserSessionCookie(cookieValue),
      },
    });
  } catch (err: any) {
    console.error('[OAuth] User lookup/session error:', err?.message);
    return sessionFailed();
  }
};

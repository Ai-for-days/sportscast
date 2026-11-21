// Owner adds a player (DBD 2026-11-20): "Email address as the user name, give
// them a temp pass, then have them reset their pass ... They should have 100000
// in play money to start, but I'll control it."
//
// POST { email, displayName?, startingBalanceDollars? }  (admin session only)
// -> 201 { user, tempPassword }. The temporary password is returned ONCE, to the
// admin screen, and is never stored in plain text (bcrypt hash only). The player
// must set their own password before /api/bets or /api/bets/place accept a bet.
// The bankroll is changed afterwards with the existing Credit/Debit control
// (/api/admin/credit-balance).
import type { APIRoute } from 'astro';
import { randomInt } from 'node:crypto';
import { requireAdmin, isReadOnly } from '../../../../lib/admin-auth';
import { getRedis } from '../../../../lib/redis';
import { createUser, getUserByEmail, sanitizeUser } from '../../../../lib/user-store';
import { hashPassword } from '../../../../lib/user-auth';
import { creditBalance, recordTransaction } from '../../../../lib/wallet-store';

export const DEFAULT_START_DOLLARS = 100_000;
export const MAX_START_DOLLARS = 10_000_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// No 0/O, 1/l/I: the owner may read it out or text it.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

export function makeTempPassword(length = 12): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return json({ error: 'Unauthorized' }, 401);
  // A read-only (viewer) admin cannot add players, even if the middleware is
  // bypassed or changed (WOW-036 review finding 11).
  if (await isReadOnly(session)) return json({ error: 'Read-only admin session.' }, 403);

  let body: { email?: unknown; displayName?: unknown; startingBalanceDollars?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!body || typeof body !== 'object') return json({ error: 'Invalid JSON' }, 400);
  // Types first (WOW-036 review finding 9): a number email used to throw outside any try.
  if (typeof body.email !== 'string') return json({ error: 'Enter a valid email address.' }, 400);
  if (body.displayName !== undefined && typeof body.displayName !== 'string') return json({ error: 'Name must be text.' }, 400);

  const email = (body.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return json({ error: 'Enter a valid email address.' }, 400);
  const start = body.startingBalanceDollars ?? DEFAULT_START_DOLLARS;
  if (typeof start !== 'number' || !Number.isFinite(start) || start < 0 || start > MAX_START_DOLLARS) {
    return json({ error: `Starting bankroll must be between $0 and $${MAX_START_DOLLARS.toLocaleString('en-US')}.` }, 400);
  }
  if (await getUserByEmail(email)) return json({ error: 'A player with this email already exists.' }, 409);
  // Claim the email atomically before creating anything, so two simultaneous
  // creates cannot both succeed (WOW-036 review finding 10). createUser then
  // overwrites this placeholder with the new user's id.
  // The claim expires after 60 s (closure finding B), so a crash between the
  // claim and createUser cannot block this email for good; createUser's SET
  // replaces it without an expiry.
  const claimed = await getRedis().set(`user:by-email:${email}`, 'pending-create', { nx: true, ex: 60 });
  if (claimed !== 'OK') return json({ error: 'A player with this email already exists.' }, 409);

  const displayName = ((body.displayName as string | undefined) ?? '').trim().slice(0, 60) || email.split('@')[0];
  const tempPassword = makeTempPassword();
  let user;
  try {
    user = await createUser({
      email,
      displayName,
      passwordHash: await hashPassword(tempPassword),
      mustChangePassword: true,
    });
  } catch {
    // Release the claim so the owner can try again.
    await getRedis().del(`user:by-email:${email}`).catch(() => {});
    return json({ error: 'Could not create the player. Try again.' }, 500);
  }

  const cents = Math.round(start * 100);
  if (cents > 0) {
    const balance = await creditBalance(user.id, cents);
    await recordTransaction({
      userId: user.id,
      type: 'deposit',
      amountCents: cents,
      balanceAfterCents: balance,
      description: `Starting bankroll: $${start.toLocaleString('en-US')} play money (set by admin)`,
    });
  }

  return json({ ok: true, user: { ...sanitizeUser(user), balanceCents: cents }, tempPassword }, 201);
};

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
import { requireAdmin } from '../../../../lib/admin-auth';
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

  let body: { email?: string; displayName?: string; startingBalanceDollars?: number };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const email = (body.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return json({ error: 'Enter a valid email address.' }, 400);
  const start = body.startingBalanceDollars ?? DEFAULT_START_DOLLARS;
  if (typeof start !== 'number' || !Number.isFinite(start) || start < 0 || start > MAX_START_DOLLARS) {
    return json({ error: `Starting bankroll must be between $0 and $${MAX_START_DOLLARS.toLocaleString('en-US')}.` }, 400);
  }
  if (await getUserByEmail(email)) return json({ error: 'A player with this email already exists.' }, 409);

  const displayName = (body.displayName ?? '').trim().slice(0, 60) || email.split('@')[0];
  const tempPassword = makeTempPassword();
  const user = await createUser({
    email,
    displayName,
    passwordHash: await hashPassword(tempPassword),
    mustChangePassword: true,
  });

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

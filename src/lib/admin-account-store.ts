// ── Per-employee admin accounts (server-only) ───────────────────────────────
//
// Lets the owner "sign up" individual employees as admins with their own
// email + password login, instead of everyone sharing the ADMIN_SECRET
// passphrase. Each account is tied to an RBAC role via security-store so the
// existing requirePermission() enforcement applies:
//   - 'admin'       → full dashboard access EXCEPT managing admins
//   - 'super_admin' → everything, including managing admins (the owner)
//
// The owner continues to log in with the ADMIN_SECRET passphrase (resolves to
// operatorId 'primary-admin' → super_admin). Employee accounts created here log
// in with email + password.

import { getRedis } from './redis';
import bcrypt from 'bcryptjs';
import { assignRole, disableUser, enableUser } from './security-store';
import type { Role } from './rbac';

if (typeof window !== 'undefined') {
  throw new Error('admin-account-store is server-only and must not be imported in client code');
}

const SALT_ROUNDS = 12;
const ACCOUNT_PREFIX = 'admin-account:';
const ACCOUNT_SET = 'admin-accounts:all';
const EMAIL_INDEX = 'admin-account-email:'; // normalized email → account id

/** Roles an account can be created with from the Manage Admins UI. */
export const ASSIGNABLE_ADMIN_ROLES: Role[] = ['admin', 'super_admin'];

export interface AdminAccount {
  id: string; // also the operatorId used by the RBAC + session layer
  email: string;
  displayName: string;
  role: Role;
  status: 'active' | 'disabled';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface StoredAdminAccount extends AdminAccount {
  passwordHash: string;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function newId(): string {
  return `adm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function publicView(a: StoredAdminAccount): AdminAccount {
  const { passwordHash: _omit, ...rest } = a;
  return rest;
}

function parse(raw: unknown): StoredAdminAccount | null {
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? (JSON.parse(raw) as StoredAdminAccount) : (raw as StoredAdminAccount);
  } catch {
    return null;
  }
}

async function readAccount(id: string): Promise<StoredAdminAccount | null> {
  const redis = getRedis();
  return parse(await redis.get(`${ACCOUNT_PREFIX}${id}`));
}

export async function getAdminAccountById(id: string): Promise<AdminAccount | null> {
  const a = await readAccount(id);
  return a ? publicView(a) : null;
}

export async function getAdminAccountByEmail(email: string): Promise<StoredAdminAccount | null> {
  const redis = getRedis();
  const id = await redis.get(`${EMAIL_INDEX}${normalizeEmail(email)}`);
  if (!id) return null;
  return readAccount(typeof id === 'string' ? id : String(id));
}

export async function listAdminAccounts(): Promise<AdminAccount[]> {
  const redis = getRedis();
  const ids = (await redis.zrange(ACCOUNT_SET, 0, -1, { rev: true })) as string[];
  if (!ids || ids.length === 0) return [];
  const out: AdminAccount[] = [];
  for (const id of ids) {
    const a = await readAccount(id);
    if (a) out.push(publicView(a));
  }
  return out;
}

export interface CreateAdminInput {
  email: string;
  displayName: string;
  password: string;
  role?: Role; // defaults to 'admin' (full access except managing admins)
  createdBy: string;
}

export async function createAdminAccount(
  input: CreateAdminInput,
): Promise<{ ok: boolean; error?: string; account?: AdminAccount }> {
  const email = normalizeEmail(input.email);
  const displayName = input.displayName.trim();
  const role: Role = input.role ?? 'admin';

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: 'A valid email is required.' };
  }
  if (displayName.length < 2 || displayName.length > 60) {
    return { ok: false, error: 'Name must be 2–60 characters.' };
  }
  if (!input.password || input.password.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters.' };
  }
  if (!ASSIGNABLE_ADMIN_ROLES.includes(role)) {
    return { ok: false, error: 'Invalid role.' };
  }

  const existing = await getAdminAccountByEmail(email);
  if (existing) {
    return { ok: false, error: 'An admin with that email already exists.' };
  }

  const now = new Date().toISOString();
  const account: StoredAdminAccount = {
    id: newId(),
    email,
    displayName,
    role,
    status: 'active',
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
    passwordHash: await bcrypt.hash(input.password, SALT_ROUNDS),
  };

  const redis = getRedis();
  await redis.set(`${ACCOUNT_PREFIX}${account.id}`, JSON.stringify(account));
  await redis.set(`${EMAIL_INDEX}${email}`, account.id);
  await redis.zadd(ACCOUNT_SET, { score: Date.now(), member: account.id });

  // Wire the RBAC role so requirePermission() resolves this operator's role.
  await assignRole(account.id, role, input.createdBy, email);

  return { ok: true, account: publicView(account) };
}

/** Verify an email/password login. Returns the stored account if valid + active. */
export async function verifyAdminLogin(email: string, password: string): Promise<StoredAdminAccount | null> {
  const account = await getAdminAccountByEmail(email);
  if (!account || account.status !== 'active' || !account.passwordHash) return null;
  const ok = await bcrypt.compare(password, account.passwordHash);
  return ok ? account : null;
}

export async function setAdminAccountStatus(
  id: string,
  status: 'active' | 'disabled',
  actor: string,
): Promise<AdminAccount | null> {
  const account = await readAccount(id);
  if (!account) return null;
  account.status = status;
  account.updatedAt = new Date().toISOString();
  const redis = getRedis();
  await redis.set(`${ACCOUNT_PREFIX}${id}`, JSON.stringify(account));
  // Keep the RBAC record's status in lockstep so a disabled account also loses
  // permission-gated access immediately.
  if (status === 'disabled') await disableUser(id, actor);
  else await enableUser(id, actor);
  return publicView(account);
}

export async function setAdminPassword(
  id: string,
  newPassword: string,
  _actor: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!newPassword || newPassword.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters.' };
  }
  const account = await readAccount(id);
  if (!account) return { ok: false, error: 'Account not found.' };
  account.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  account.updatedAt = new Date().toISOString();
  const redis = getRedis();
  await redis.set(`${ACCOUNT_PREFIX}${id}`, JSON.stringify(account));
  return { ok: true };
}

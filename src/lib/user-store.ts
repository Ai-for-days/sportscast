import { getRedis } from './redis';
import type { User } from './user-types';

// ── Redis key helpers ────────────────────────────────────────────────────────

const KEY = {
  user: (id: string) => `user:${id}`,
  byEmail: (email: string) => `user:by-email:${email.toLowerCase()}`,
  byGoogle: (googleId: string) => `user:by-google:${googleId}`,
} as const;

function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `u_${ts}_${rand}`;
}

// ── CRUD operations ──────────────────────────────────────────────────────────

export async function createUser(data: {
  email: string;
  displayName: string;
  passwordHash?: string;
  googleId?: string;
  avatarUrl?: string;
  emailVerified?: boolean;
}): Promise<User> {
  const redis = getRedis();
  const id = generateId();
  const now = new Date().toISOString();

  const user: User = {
    id,
    email: data.email.toLowerCase(),
    displayName: data.displayName,
    passwordHash: data.passwordHash,
    googleId: data.googleId,
    avatarUrl: data.avatarUrl,
    createdAt: now,
    emailVerified: data.emailVerified ?? false,
  };

  const pipeline = redis.pipeline();
  pipeline.set(KEY.user(id), JSON.stringify(user));
  pipeline.set(KEY.byEmail(data.email), id);
  if (data.googleId) {
    pipeline.set(KEY.byGoogle(data.googleId), id);
  }
  await pipeline.exec();

  return user;
}

export async function getUserById(id: string): Promise<User | null> {
  const redis = getRedis();
  const raw = await redis.get(KEY.user(id));
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as User;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const redis = getRedis();
  const userId = await redis.get(KEY.byEmail(email.toLowerCase()));
  if (!userId) return null;
  return getUserById(userId as string);
}

export async function getUserByGoogleId(googleId: string): Promise<User | null> {
  const redis = getRedis();
  const userId = await redis.get(KEY.byGoogle(googleId));
  if (!userId) return null;
  return getUserById(userId as string);
}

export async function linkGoogleAccount(userId: string, googleId: string, avatarUrl?: string): Promise<User | null> {
  const user = await getUserById(userId);
  if (!user) return null;

  const updated: User = {
    ...user,
    googleId,
    avatarUrl: avatarUrl || user.avatarUrl,
    emailVerified: true,
  };

  const redis = getRedis();
  const pipeline = redis.pipeline();
  pipeline.set(KEY.user(userId), JSON.stringify(updated));
  pipeline.set(KEY.byGoogle(googleId), userId);
  await pipeline.exec();

  return updated;
}

/** Returns all registered users by scanning user:u_* keys */
export async function listAllUsers(): Promise<User[]> {
  const redis = getRedis();
  const users: User[] = [];
  let cursor = 0;

  do {
    const result = await redis.scan(cursor, { match: 'user:u_*', count: 100 });
    cursor = Number(result[0]);
    const keys = result[1] as string[];

    if (keys.length > 0) {
      const pipeline = redis.pipeline();
      for (const key of keys) {
        pipeline.get(key);
      }
      const results = await pipeline.exec();
      for (const raw of results) {
        if (raw) {
          const user = typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as User;
          users.push(user);
        }
      }
    }
  } while (cursor !== 0);

  return users;
}

/** Freeze or unfreeze a user */
export async function freezeUser(userId: string, frozen: boolean): Promise<User | null> {
  const user = await getUserById(userId);
  if (!user) return null;

  const updated: User = { ...user, frozen };
  const redis = getRedis();
  await redis.set(KEY.user(userId), JSON.stringify(updated));
  return updated;
}

/** Delete a user and all associated keys */
export async function deleteUser(userId: string): Promise<boolean> {
  const user = await getUserById(userId);
  if (!user) return false;

  const redis = getRedis();
  const pipeline = redis.pipeline();
  pipeline.del(KEY.user(userId));
  pipeline.del(KEY.byEmail(user.email));
  if (user.googleId) {
    pipeline.del(KEY.byGoogle(user.googleId));
  }
  // Clean up balance and transaction keys
  pipeline.del(`balance:${userId}`);
  pipeline.del(`transactions:${userId}`);
  await pipeline.exec();
  return true;
}

/** Returns a sanitized user (no passwordHash) for API responses */
export function sanitizeUser(user: User): Omit<User, 'passwordHash'> {
  const { passwordHash, ...safe } = user;
  return safe;
}

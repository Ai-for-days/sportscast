import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import { listAllUsers, sanitizeUser } from '../../../lib/user-store';
import { getBalance } from '../../../lib/wallet-store';
import { getRedis } from '../../../lib/redis';

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const allUsers = await listAllUsers();
    const redis = getRedis();

    const users = await Promise.all(
      allUsers.map(async (user) => {
        const [balanceCents, betCount] = await Promise.all([
          getBalance(user.id),
          redis.zcard(`bets:by-user:${user.id}`),
        ]);
        return {
          ...sanitizeUser(user),
          hasPassword: !!user.passwordHash,
          balanceCents,
          betCount,
        };
      })
    );

    // Sort by newest first
    users.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return new Response(JSON.stringify({ users }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

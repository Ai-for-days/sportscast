import type { APIRoute } from 'astro';
import { listWagers } from '../../lib/wager-store';
import type { WagerStatus } from '../../lib/wager-types';

const VALID_STATUSES: WagerStatus[] = ['open', 'locked', 'graded', 'void'];

export const GET: APIRoute = async ({ url }) => {
  try {
    const status = url.searchParams.get('status') as WagerStatus | null;
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 50);
    const cursor = parseInt(url.searchParams.get('cursor') || '0', 10) || 0;

    if (status && !VALID_STATUSES.includes(status)) {
      return new Response(JSON.stringify({ error: `Invalid status. Must be: ${VALID_STATUSES.join(', ')}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await listWagers({ status: status || undefined, limit, cursor });

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=60, max-age=60',
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'Failed to fetch wagers' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

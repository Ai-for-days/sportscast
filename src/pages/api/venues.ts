import type { APIRoute } from 'astro';
import { venues } from '../../lib/venue-data';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const sport = url.searchParams.get('sport') || '';
  const state = url.searchParams.get('state') || '';
  const search = url.searchParams.get('q') || '';

  let filtered = [...venues];

  if (sport) {
    filtered = filtered.filter(v => v.sport === sport);
  }
  if (state) {
    filtered = filtered.filter(v => v.state.toLowerCase() === state.toLowerCase());
  }
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(v =>
      v.name.toLowerCase().includes(q) ||
      v.city.toLowerCase().includes(q) ||
      v.state.toLowerCase().includes(q)
    );
  }

  return new Response(JSON.stringify(filtered), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=86400',
    },
  });
};

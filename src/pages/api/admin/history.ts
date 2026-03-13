import type { APIRoute } from 'astro';
import {
  listSnapshots,
  getSnapshot,
  getSnapshotsByFamily,
  getSnapshotsByDate,
  getSnapshotsByDateRange,
  SNAPSHOT_FAMILIES,
} from '../../../lib/research-store';
import { buildDailySnapshot, buildFamilySnapshot } from '../../../lib/daily-snapshots';

/* ------------------------------------------------------------------ */
/*  GET                                                                 */
/* ------------------------------------------------------------------ */

export const GET: APIRoute = async ({ url }) => {
  try {
    const action = url.searchParams.get('action');

    if (action === 'get-snapshot') {
      const id = url.searchParams.get('id') || '';
      if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400 });
      const snap = await getSnapshot(id);
      if (!snap) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
      return new Response(JSON.stringify(snap), { status: 200 });
    }

    if (action === 'export-snapshot') {
      const id = url.searchParams.get('id') || '';
      if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400 });
      const snap = await getSnapshot(id);
      if (!snap) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
      return new Response(JSON.stringify(snap, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="snapshot-${snap.id}.json"` },
      });
    }

    // Filtered queries
    const family = url.searchParams.get('family');
    const date = url.searchParams.get('date');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    if (family && from && to) {
      const snaps = await getSnapshotsByDateRange(family, from, to);
      return new Response(JSON.stringify({ snapshots: snaps, families: SNAPSHOT_FAMILIES }), { status: 200 });
    }
    if (family) {
      const snaps = await getSnapshotsByFamily(family, 100);
      return new Response(JSON.stringify({ snapshots: snaps, families: SNAPSHOT_FAMILIES }), { status: 200 });
    }
    if (date) {
      const snaps = await getSnapshotsByDate(date);
      return new Response(JSON.stringify({ snapshots: snaps, families: SNAPSHOT_FAMILIES }), { status: 200 });
    }

    // Default: recent snapshots
    const snapshots = await listSnapshots(100);
    return new Response(JSON.stringify({ snapshots, families: SNAPSHOT_FAMILIES }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

/* ------------------------------------------------------------------ */
/*  POST                                                                */
/* ------------------------------------------------------------------ */

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'build-daily-snapshot': {
        const result = await buildDailySnapshot();
        return new Response(JSON.stringify({ ok: true, ...result }), { status: 200 });
      }

      case 'build-family-snapshot': {
        const { family } = body;
        if (!family) return new Response(JSON.stringify({ error: 'family required' }), { status: 400 });
        const snap = await buildFamilySnapshot(family);
        return new Response(JSON.stringify({ ok: true, snapshot: snap }), { status: 200 });
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400 });
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

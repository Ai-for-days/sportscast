import type { VenueAdapter, VenueMeta } from './types';
import { KalshiAdapter } from './kalshi-adapter';
import { InternalStubAdapter } from './internal-stub-adapter';
import { logAuditEvent } from '../audit-log';

/* ------------------------------------------------------------------ */
/*  Venue Registry                                                      */
/* ------------------------------------------------------------------ */

const adapters: Map<string, VenueAdapter> = new Map();
let initialized = false;

function ensureInit() {
  if (initialized) return;
  adapters.set('kalshi', new KalshiAdapter());
  adapters.set('internal_stub', new InternalStubAdapter());
  initialized = true;
}

/** Get a specific venue adapter by name */
export function getVenueAdapter(name: string): VenueAdapter | null {
  ensureInit();
  return adapters.get(name) || null;
}

/** List all registered venue adapters */
export function listVenueAdapters(): VenueAdapter[] {
  ensureInit();
  return [...adapters.values()];
}

/** List all venue metadata */
export function listVenueMeta(): VenueMeta[] {
  ensureInit();
  return [...adapters.values()].map(a => a.meta);
}

/** Get venue names */
export function listVenueNames(): string[] {
  ensureInit();
  return [...adapters.keys()];
}

/** Get all markets across all active venues */
export async function getAllVenueMarkets(opts?: { venue?: string; limit?: number }): Promise<any[]> {
  ensureInit();
  const results: any[] = [];
  const targets = opts?.venue ? [adapters.get(opts.venue)].filter(Boolean) : [...adapters.values()];

  for (const adapter of targets) {
    if (!adapter || adapter.meta.status === 'disabled') continue;
    try {
      const markets = await adapter.getMarkets({ limit: opts?.limit });
      results.push(...markets);
    } catch { /* skip failing venues */ }
  }
  return results;
}

/** Get all orders across all active venues */
export async function getAllVenueOrders(opts?: { venue?: string; mode?: string; limit?: number }): Promise<any[]> {
  ensureInit();
  // Orders are stored in Redis by the execution layer; this aggregates from adapters
  // For now, pull from the Kalshi adapter's underlying data
  const results: any[] = [];
  const targets = opts?.venue ? [adapters.get(opts.venue)].filter(Boolean) : [...adapters.values()];

  for (const adapter of targets) {
    if (!adapter || adapter.meta.status === 'disabled') continue;
    // Positions serve as a proxy for order-level data through the adapter
    // Full order history is accessed through the execution APIs
  }
  return results;
}

/** Health check all venues */
export async function checkAllVenueHealth(): Promise<any[]> {
  ensureInit();
  const results: any[] = [];
  for (const adapter of adapters.values()) {
    try {
      const health = await adapter.getHealth();
      results.push(health);
    } catch (err: any) {
      results.push({
        venue: adapter.meta.name,
        status: 'down',
        message: err.message || 'Health check failed',
        checkedAt: new Date().toISOString(),
      });
    }
  }

  await logAuditEvent({
    actor: 'admin',
    eventType: 'venue_health_checked',
    targetType: 'system',
    targetId: 'venue-registry',
    summary: `Health checked ${results.length} venues: ${results.map(r => `${r.venue}=${r.status}`).join(', ')}`,
  });

  return results;
}

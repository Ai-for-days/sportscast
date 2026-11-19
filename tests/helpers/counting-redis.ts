// A command-counting stand-in for the Upstash client (WOW-034).
//
// Upstash bills every command: a pipeline of 12 GETs is 12 commands, an MGET
// of 12 keys is ONE. This fake counts the same way. Every call is logged once
// (a pipelined call is logged when exec() runs it, so each pipeline entry
// counts as one), and exec() itself is not a command. MGET logs once whatever
// the number of keys.
//
// Unknown commands throw, so a code path cannot quietly skip a command the
// fake does not model and report a falsely low count.

import { FakeRedis } from './fake-redis';

export class CountingRedis extends FakeRedis {
  sets = new Map<string, Set<string>>();
  lists = new Map<string, unknown[]>();

  /** Total billed commands since the last reset(). */
  count(): number {
    return this.calls.length;
  }
  /** Billed commands by command name. */
  byCmd(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const c of this.calls) out[c.cmd] = (out[c.cmd] ?? 0) + 1;
    return out;
  }
  /** Forget the call log (data stays). */
  reset(): void {
    this.calls = [];
  }
  private rec(cmd: string, key: string, args: unknown[]) {
    this.calls.push({ cmd, key, args });
  }

  override async mget(...keys: any[]) {
    const flat: string[] = keys.length === 1 && Array.isArray(keys[0]) ? keys[0] : keys;
    return super.mget(...flat);
  }

  override async zrange(key: string, min: number | string, max: number | string, opts: { byScore?: boolean; withScores?: boolean; rev?: boolean } = {}) {
    if (!opts.rev) return super.zrange(key, min, max, opts);
    this.rec('zrange', key, [min, max, opts]);
    const z = [...(this.zsets.get(key) ?? new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1]);
    let picked = z;
    if (opts.byScore) {
      // With rev + byScore Upstash takes (max, min).
      const hi = Number(min);
      const lo = Number(max);
      picked = z.filter(([, s]) => s >= lo && s <= hi);
    } else {
      const a = Number(min);
      const b = Number(max);
      picked = z.slice(a, b < 0 ? z.length + b + 1 : b + 1);
    }
    return opts.withScores ? picked.flatMap(([m, s]) => [m, s]) : picked.map(([m]) => m);
  }

  async zremrangebyrank(key: string, start: number, stop: number) {
    this.rec('zremrangebyrank', key, [start, stop]);
    const z = this.zsets.get(key);
    if (!z) return 0;
    const sorted = [...z.entries()].sort((a, b) => a[1] - b[1]);
    const n = sorted.length;
    const a = start < 0 ? n + start : start;
    const b = stop < 0 ? n + stop : stop;
    let removed = 0;
    sorted.forEach(([m], i) => {
      if (i >= a && i <= b) { z.delete(m); removed++; }
    });
    return removed;
  }
  async zcard(key: string) {
    this.rec('zcard', key, []);
    return this.zsets.get(key)?.size ?? 0;
  }
  async zscore(key: string, member: string) {
    this.rec('zscore', key, [member]);
    return this.zsets.get(key)?.get(member) ?? null;
  }
  async del(...keys: string[]) {
    this.rec('del', keys.join(','), keys);
    let n = 0;
    for (const k of keys) if (this.kv.delete(k) || this.hashes.delete(k) || this.zsets.delete(k) || this.sets.delete(k)) n++;
    return n;
  }
  async exists(...keys: string[]) {
    this.rec('exists', keys.join(','), keys);
    return keys.filter((k) => this.kv.has(k) || this.hashes.has(k) || this.zsets.has(k) || this.sets.has(k)).length;
  }
  async incr(key: string) { return this.incrby(key, 1, 'incr'); }
  async incrby(key: string, by: number, cmd = 'incrby') {
    this.rec(cmd, key, [by]);
    const v = Number(this.kv.get(key) ?? 0) + by;
    this.kv.set(key, v);
    return v;
  }
  async hincrby(key: string, field: string, by: number) {
    this.rec('hincrby', key, [field, by]);
    const h = this.hashes.get(key) ?? new Map();
    const v = Number(h.get(field) ?? 0) + by;
    h.set(field, v);
    this.hashes.set(key, h);
    return v;
  }
  async sadd(key: string, ...members: string[]) {
    this.rec('sadd', key, members);
    const s = this.sets.get(key) ?? new Set<string>();
    for (const m of members) s.add(m);
    this.sets.set(key, s);
    return members.length;
  }
  async srem(key: string, ...members: string[]) {
    this.rec('srem', key, members);
    const s = this.sets.get(key);
    for (const m of members) s?.delete(m);
    return members.length;
  }
  async smembers(key: string) {
    this.rec('smembers', key, []);
    return [...(this.sets.get(key) ?? [])];
  }
  async sismember(key: string, member: string) {
    this.rec('sismember', key, [member]);
    return this.sets.get(key)?.has(member) ? 1 : 0;
  }
  override async lpush(key: string, ...values: unknown[]) {
    const r = await super.lpush(key, ...values);
    const l = this.lists.get(key) ?? [];
    l.unshift(...values.slice().reverse());
    this.lists.set(key, l);
    return r;
  }
  async lrange(key: string, a: number, b: number) {
    this.rec('lrange', key, [a, b]);
    const l = this.lists.get(key) ?? [];
    return l.slice(a, b < 0 ? l.length + b + 1 : b + 1);
  }
}

/**
 * Wrap a CountingRedis so any command it does not model throws instead of
 * returning undefined. Pipelines get the same treatment.
 */
export function strict(r: CountingRedis): CountingRedis {
  const wrap = (target: any): any => new Proxy(target, {
    get(t, prop, recv) {
      const v = Reflect.get(t, prop, recv);
      if (prop === 'pipeline' || prop === 'multi') {
        return () => {
          const p = t.pipeline();
          return new Proxy(p, {
            get(pt, pp) {
              if (pp === 'exec') return pt.exec;
              if (typeof pp === 'string' && typeof (t as any)[pp] !== 'function') throw new Error(`CountingRedis: unmodelled pipeline command ${pp}`);
              return Reflect.get(pt, pp);
            },
          });
        };
      }
      if (v === undefined && typeof prop === 'string' && prop !== 'then' && !prop.startsWith('__') && prop !== 'toJSON') {
        throw new Error(`CountingRedis: unmodelled command ${prop}`);
      }
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
  return wrap(r);
}

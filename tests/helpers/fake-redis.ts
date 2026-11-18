// A tiny in-memory stand-in for the Upstash client, covering only the calls
// the code under test makes. Values are stored as given (strings for JSON),
// TTLs are recorded but never expire, and every call is logged so a test can
// assert what was (and was not) written.

export interface FakeCall {
  cmd: string;
  key: string;
  args: unknown[];
}

export class FakeRedis {
  kv = new Map<string, unknown>();
  hashes = new Map<string, Map<string, unknown>>();
  zsets = new Map<string, Map<string, number>>();
  ttl = new Map<string, number>();
  calls: FakeCall[] = [];

  private log(cmd: string, key: string, args: unknown[]) {
    this.calls.push({ cmd, key, args });
  }

  async get(key: string) {
    this.log('get', key, []);
    return this.kv.has(key) ? this.kv.get(key) : null;
  }
  async mget(...keys: string[]) {
    this.log('mget', keys.join(','), keys);
    return keys.map((k) => (this.kv.has(k) ? this.kv.get(k) : null));
  }
  async set(key: string, value: unknown, opts: { ex?: number; nx?: boolean } = {}) {
    this.log('set', key, [value, opts]);
    if (opts.nx && this.kv.has(key)) return null;
    this.kv.set(key, value);
    if (opts.ex) this.ttl.set(key, opts.ex);
    else this.ttl.delete(key);
    return 'OK';
  }
  async hgetall(key: string) {
    this.log('hgetall', key, []);
    const h = this.hashes.get(key);
    return h && h.size ? Object.fromEntries(h) : null;
  }
  async hget(key: string, field: string) {
    this.log('hget', key, [field]);
    return this.hashes.get(key)?.get(field) ?? null;
  }
  async hmget(key: string, ...fields: string[]) {
    this.log('hmget', key, fields);
    const h = this.hashes.get(key);
    return Object.fromEntries(fields.map((f) => [f, h?.get(f) ?? null]));
  }
  async hset(key: string, fields: Record<string, unknown>) {
    this.log('hset', key, [fields]);
    const h = this.hashes.get(key) ?? new Map();
    for (const [f, v] of Object.entries(fields)) h.set(f, v);
    this.hashes.set(key, h);
    return Object.keys(fields).length;
  }
  async hdel(key: string, ...fields: string[]) {
    this.log('hdel', key, fields);
    const h = this.hashes.get(key);
    for (const f of fields) h?.delete(f);
    return fields.length;
  }
  async expire(key: string, seconds: number) {
    this.log('expire', key, [seconds]);
    this.ttl.set(key, seconds);
    return 1;
  }
  async lpush(key: string, ...values: unknown[]) {
    this.log('lpush', key, values);
    return values.length;
  }
  async ltrim(key: string, a: number, b: number) {
    this.log('ltrim', key, [a, b]);
    return 'OK';
  }
  async zadd(key: string, ...members: { score: number; member: string }[]) {
    this.log('zadd', key, members);
    const z = this.zsets.get(key) ?? new Map<string, number>();
    for (const m of members) z.set(m.member, m.score);
    this.zsets.set(key, z);
    return members.length;
  }
  async zrem(key: string, ...members: string[]) {
    this.log('zrem', key, members);
    const z = this.zsets.get(key);
    for (const m of members) z?.delete(m);
    return members.length;
  }
  async zrange(key: string, min: number | string, max: number | string, opts: { byScore?: boolean; withScores?: boolean } = {}) {
    this.log('zrange', key, [min, max, opts]);
    const z = [...(this.zsets.get(key) ?? new Map<string, number>()).entries()].sort((a, b) => a[1] - b[1]);
    let picked = z;
    if (opts.byScore) {
      const lo = Number(min);
      const hi = Number(max);
      picked = z.filter(([, s]) => s >= lo && s <= hi);
    } else {
      const a = Number(min);
      const b = Number(max);
      picked = z.slice(a, b < 0 ? z.length + b + 1 : b + 1);
    }
    return opts.withScores ? picked.flatMap(([m, s]) => [m, s]) : picked.map(([m]) => m);
  }

  /** Commands queue and run, in order, on exec(). */
  pipeline() {
    const queue: (() => Promise<unknown>)[] = [];
    const self = this;
    const p: any = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === 'exec') return async () => { const out = []; for (const q of queue) out.push(await q()); return out; };
        const fn = (self as any)[prop];
        if (typeof fn !== 'function') return undefined;
        return (...args: unknown[]) => { queue.push(() => fn.apply(self, args)); return p; };
      },
    });
    return p;
  }

  writes(prefix: string) {
    return this.calls.filter((c) => c.cmd === 'set' && c.key.startsWith(prefix));
  }
}

import { Redis } from '@upstash/redis';

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    const url = import.meta.env.KV_REST_API_URL;
    const token = import.meta.env.KV_REST_API_TOKEN;
    if (!url || !token) {
      throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
    }
    redis = new Redis({ url, token });
  }
  return redis;
}

/**
 * Tests only: install a stand-in client (the command-counting fake in
 * tests/helpers) so code that calls getRedis() runs with no network and no
 * credentials. Pass null to clear it. Never called by application code.
 */
export function setRedisForTests(client: unknown): void {
  redis = client as Redis | null;
}

import type Redis from 'ioredis';

import type { DistributedLock, RateLimiter } from '../../application/ports';

/**
 * Redis-backed rate limiting and distributed locking.
 *
 * Both are written as Lua scripts rather than as a sequence of commands. The reason is the
 * same in each case: the check and the write have to be one atomic operation, and a
 * GET-then-SET from the application is a race that two concurrent requests will win
 * together. Redis runs a script atomically, so the whole decision happens inside the
 * server.
 */

/**
 * Fixed-window rate limiter.
 *
 * INCR and EXPIRE in one script. The subtlety is the EXPIRE: setting it unconditionally on
 * every call slides the window forward for a caller who keeps knocking, so it is only set
 * when the counter is created. Without that, a caller sending continuously is never
 * released.
 *
 * A fixed window lets a caller get up to double the limit across a boundary. That is
 * acceptable for what this protects, brute-force attempts and write floods, and a sliding
 * window costs a sorted set per key.
 */
const CONSUME_SCRIPT = `
  local current = redis.call('INCR', KEYS[1])
  if current == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
  end
  local ttl = redis.call('TTL', KEYS[1])
  return { current, ttl }
`;

export class RedisRateLimiter implements RateLimiter {
  constructor(private readonly redis: Redis) {}

  async consume(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{ allowed: true; remaining: number } | { allowed: false; retryAfterSeconds: number }> {
    const result = (await this.redis.eval(
      CONSUME_SCRIPT,
      1,
      `ratelimit:${key}`,
      String(windowSeconds),
    )) as [number, number];

    const [count, ttl] = result;

    if (count > limit) {
      // A TTL of -1 means the key exists with no expiry, which should be impossible given
      // the script. Falling back to the full window is the safe direction: it tells the
      // caller to wait longer rather than letting it through.
      return { allowed: false, retryAfterSeconds: ttl > 0 ? ttl : windowSeconds };
    }

    return { allowed: true, remaining: limit - count };
  }
}

/**
 * Distributed lock.
 *
 * SET NX PX to acquire, and a compare-and-delete script to release. The token matters: a
 * plain DEL on release will delete a lock that has already expired and been acquired by
 * somebody else, so the holder ends up releasing a lock it no longer owns. Checking the
 * token first makes release safe.
 *
 * This is not Redlock. A single Redis instance can lose a lock on failover, and every
 * caller here is written so that losing the lock means duplicated work rather than
 * corrupted data. That is stated so nobody builds something on it that needs more.
 */
const RELEASE_SCRIPT = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
  end
  return 0
`;

export class RedisDistributedLock implements DistributedLock {
  constructor(
    private readonly redis: Redis,
    private readonly generateToken: () => string,
  ) {}

  async acquire(key: string, ttlMs: number): Promise<{ release: () => Promise<void> } | null> {
    const token = this.generateToken();
    const lockKey = `lock:${key}`;

    const acquired = await this.redis.set(lockKey, token, 'PX', ttlMs, 'NX');
    if (acquired === null) return null;

    return {
      release: async () => {
        await this.redis.eval(RELEASE_SCRIPT, 1, lockKey, token);
      },
    };
  }
}

/**
 * Operator presence.
 *
 * A sorted set keyed by last-seen timestamp, so "who is online" is a range query and
 * expiry is a range delete rather than a per-key TTL. Presence is the one piece of state
 * here that is genuinely fine to lose on a restart: everybody reconnects within seconds
 * and repopulates it.
 */
export class RedisPresence {
  private static readonly KEY = 'presence:operators';

  constructor(private readonly redis: Redis) {}

  async heartbeat(operatorId: string, now: Date): Promise<void> {
    await this.redis.zadd(RedisPresence.KEY, now.getTime(), operatorId);
  }

  async onlineOperators(now: Date, staleAfterMs = 60_000): Promise<string[]> {
    const cutoff = now.getTime() - staleAfterMs;
    await this.redis.zremrangebyscore(RedisPresence.KEY, '-inf', cutoff);
    return this.redis.zrangebyscore(RedisPresence.KEY, cutoff, '+inf');
  }

  async leave(operatorId: string): Promise<void> {
    await this.redis.zrem(RedisPresence.KEY, operatorId);
  }
}

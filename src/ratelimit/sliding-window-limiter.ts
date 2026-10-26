import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

export interface LimitResult {
    allowed: boolean;
    remaining: number;
    retryAfterSec: number;
}

export interface Limiter {
    consume(id: string): Promise<LimitResult>;
}

export interface SlidingWindowOptions {
    limit: number;
    windowMs: number;
    prefix?: string;
    failOpen?: boolean;
}

const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local member = ARGV[3]

local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = redis.call('ZCARD', key)

if count < limit then
    redis.call('ZADD', key, now, member)
    redis.call('PEXPIRE', key, window)
    return {1, limit - count - 1, 0}
end

local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local retryMs = tonumber(oldest[2]) + window - now
return {0, 0, retryMs}
`;

export class SlidingWindowLimiter implements Limiter {
    private readonly limit: number;
    private readonly windowMs: number;
    private readonly prefix: string;
    private readonly failOpen: boolean;

    constructor(
        private readonly redis: Redis,
        options: SlidingWindowOptions,
    ) {
        this.limit = options.limit;
        this.windowMs = options.windowMs;
        this.prefix = options.prefix ?? 'rl';
        this.failOpen = options.failOpen ?? true;
    }

    async consume(id: string): Promise<LimitResult> {
        try {
            const reply = (await this.redis.eval(
                SLIDING_WINDOW_LUA,
                1,
                `${this.prefix}:${id}`,
                String(this.windowMs),
                String(this.limit),
                randomUUID(),
            )) as [number, number, number];

            const [allowed, remaining, retryMs] = reply;
            return {
                allowed: allowed === 1,
                remaining,
                retryAfterSec: allowed === 1 ? 0 : Math.max(1, Math.ceil(retryMs / 1000)),
            };
        } catch (err) {
            if (!this.failOpen) {
                throw err;
            }
            console.warn(`rate-limit: Redis недоступний, пропускаємо запит (${(err as Error).message})`);
            return { allowed: true, remaining: this.limit, retryAfterSec: 0 };
        }
    }
}
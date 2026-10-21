import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

const RELEASE_LUA = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

export class RedisLock {
    constructor(private readonly redis: Redis) {}

    async acquire(name: string, ttlMs: number): Promise<string | null> {
        const token = randomUUID();
        const reply = await this.redis.set(name, token, 'PX', ttlMs, 'NX');
        return reply === 'OK' ? token : null;
    }

    async release(name: string, token: string): Promise<boolean> {
        try {
            const removed = await this.redis.eval(RELEASE_LUA, 1, name, token);
            return removed === 1;
        } catch {
            return false;
        }
    }
}
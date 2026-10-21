import type { Redis } from 'ioredis';

export type CacheLookup<T> = { hit: true; value: T } | { hit: false };

export interface CacheLogger {
    warn(message: string): void;
}

export class RedisCache {
    constructor(
        private readonly redis: Redis,
        private readonly logger: CacheLogger = console,
    ) {}

    async get<T>(key: string): Promise<CacheLookup<T>> {
        try {
            const raw = await this.redis.get(key);
            if (raw === null) {
                return { hit: false };
            }
            return { hit: true, value: JSON.parse(raw) as T };
        } catch (err) {
            this.logger.warn(`cache get ${key}: ${(err as Error).message}`);
            return { hit: false };
        }
    }

    async set(key: string, value: unknown, ttlSec: number): Promise<void> {
        try {
            await this.redis.set(key, JSON.stringify(value), 'EX', ttlSec);
        } catch (err) {
            this.logger.warn(`cache set ${key}: ${(err as Error).message}`);
        }
    }

    async del(key: string): Promise<void> {
        try {
            await this.redis.del(key);
        } catch (err) {
            this.logger.warn(`cache del ${key}: ${(err as Error).message}`);
        }
    }
}
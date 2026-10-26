import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { Limiter, SlidingWindowLimiter } from '../ratelimit/sliding-window-limiter';
import { openCacheClient } from './connect';
import { resolveCacheUrl } from './redis.config';
import { CACHE_REDIS, RATE_LIMITER } from './tokens';

export const ORDERS_RATE_LIMIT = 30;
export const ORDERS_RATE_WINDOW_MS = 60_000;

@Injectable()
class RedisShutdown implements OnApplicationShutdown {
    constructor(@Inject(CACHE_REDIS) private readonly redis: Redis | null) {}

    async onApplicationShutdown(): Promise<void> {
        await this.redis?.quit().catch(() => undefined);
    }
}

@Global()
@Module({
    providers: [
        {
            provide: CACHE_REDIS,
            useFactory: (): Redis | null => {
                const url = resolveCacheUrl();
                return url ? openCacheClient(url) : null;
            },
        },
        {
            provide: RATE_LIMITER,
            inject: [CACHE_REDIS],
            useFactory: (redis: Redis | null): Limiter | null =>
                redis
                    ? new SlidingWindowLimiter(redis, {
                        limit: ORDERS_RATE_LIMIT,
                        windowMs: ORDERS_RATE_WINDOW_MS,
                        prefix: 'rl:orders',
                    })
                    : null,
        },
        RedisShutdown,
    ],
    exports: [CACHE_REDIS, RATE_LIMITER],
})
export class RedisModule {}
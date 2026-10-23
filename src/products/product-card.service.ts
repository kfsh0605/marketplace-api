import type { RedisCache } from '../cache/redis-cache';
import type { RedisLock } from '../cache/redis-lock';
import {
    jitteredTtl,
    LOCK_POLL_MS,
    LOCK_TTL_MS,
    LOCK_WAIT_BUDGET_MS,
    NEGATIVE_TTL_SEC,
} from '../cache/ttl';
import { sleep } from '../lib/sleep';
import { cardKey, cardLockKey, ProductCard } from './product-card';
import type { ProductCardRepository } from './product-card.repository';

export interface ProductCardOptions {
    singleFlight?: boolean;
}

export class ProductCardService {
    private readonly singleFlight: boolean;

    constructor(
        private readonly repo: ProductCardRepository,
        private readonly cache: RedisCache | null,
        private readonly lock: RedisLock | null,
        options: ProductCardOptions = {},
    ) {
        this.singleFlight = options.singleFlight ?? true;
    }

    async getCard(productId: number): Promise<ProductCard | null> {
        if (!this.cache || !this.lock) {
            return this.repo.loadCard(productId);
        }
        const lookup = await this.cache.get<ProductCard | null>(cardKey(productId));
        if (lookup.hit) {
            return lookup.value;
        }
        return this.loadOnMiss(productId);
    }

    async invalidate(productId: number): Promise<void> {
        if (!this.cache) {
            return;
        }
        await this.cache.del(cardKey(productId));
    }

    private async loadOnMiss(productId: number): Promise<ProductCard | null> {
        if (!this.singleFlight) {
            return this.loadAndStore(productId);
        }

        const key = cardKey(productId);
        const lockName = cardLockKey(productId);
        const deadline = Date.now() + LOCK_WAIT_BUDGET_MS;

        while (Date.now() < deadline) {
            let token: string | null;
            try {
                token = await this.lock.acquire(lockName, LOCK_TTL_MS);
            } catch {
                return this.loadAndStore(productId);
            }

            if (token !== null) {
                try {
                    const again = await this.cache.get<ProductCard | null>(key);
                    if (again.hit) {
                        return again.value;
                    }
                    return await this.loadAndStore(productId);
                } finally {
                    await this.lock.release(lockName, token);
                }
            }

            await sleep(LOCK_POLL_MS);
            const lookup = await this.cache.get<ProductCard | null>(key);
            if (lookup.hit) {
                return lookup.value;
            }
        }

        return this.loadAndStore(productId);
    }

    private async loadAndStore(productId: number): Promise<ProductCard | null> {
        const fresh = await this.repo.loadCard(productId);
        await this.cache.set(cardKey(productId), fresh, fresh ? jitteredTtl() : NEGATIVE_TTL_SEC);
        return fresh;
    }
}
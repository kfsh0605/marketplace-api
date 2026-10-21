import { jitteredTtl, NEGATIVE_TTL_SEC } from '../cache/ttl';
import type { RedisCache } from '../cache/redis-cache';
import { cardKey, ProductCard } from './product-card';
import type { ProductCardRepository } from './product-card.repository';

export class ProductCardService {
    constructor(
        private readonly repo: ProductCardRepository,
        private readonly cache: RedisCache,
    ) {}

    async getCard(productId: number): Promise<ProductCard | null> {
        const lookup = await this.cache.get<ProductCard | null>(cardKey(productId));
        if (lookup.hit) {
            return lookup.value;
        }
        return this.loadAndStore(productId);
    }

    async invalidate(productId: number): Promise<void> {
        await this.cache.del(cardKey(productId));
    }

    private async loadAndStore(productId: number): Promise<ProductCard | null> {
        const fresh = await this.repo.loadCard(productId);
        await this.cache.set(cardKey(productId), fresh, fresh ? jitteredTtl() : NEGATIVE_TTL_SEC);
        return fresh;
    }
}
import 'reflect-metadata';
import type { Redis } from 'ioredis';
import { DataSource, DataSourceOptions } from 'typeorm';
import { RedisCache } from './cache/redis-cache';
import { AppDataSource } from './data-source';
import { expectAtLeast, expectEq, printLines, runStandalone } from './lib/demo-output';
import { QueryCounter } from './lib/query-counter';
import { CARD_QUERY_TAG, cardKey } from './products/product-card';
import { ProductCardRepository } from './products/product-card.repository';
import { ProductCardService } from './products/product-card.service';
import { createCacheClient } from './redis/connect';

const DEMO_PRODUCTS = 60;
const DEMO_PREFIX = 'cache-demo-';
const WARM_READS = 100;

async function readConfig(redis: Redis, name: string): Promise<string> {
    const reply = (await redis.call('CONFIG', 'GET', name)) as string[];
    return reply[1];
}

void runStandalone(async (failures) => {
    const counter = new QueryCounter([CARD_QUERY_TAG]);
    const dataSource = new DataSource({
        ...AppDataSource.options,
        logger: counter,
        logging: ['query'],
    } as DataSourceOptions);
    await dataSource.initialize();
    const redis = await createCacheClient();
    let keys: string[] = [];

    try {
        const policy = await readConfig(redis, 'maxmemory-policy');
        const maxmemory = Number(await readConfig(redis, 'maxmemory'));

        await dataSource.query(
            `INSERT INTO products (name, "priceCents", stock, currency)
             SELECT $1::text || g::text, 1000 + g, 100, 'UAH' FROM generate_series(1, $2::int) g
             ON CONFLICT (name) DO NOTHING`,
            [DEMO_PREFIX, DEMO_PRODUCTS],
        );
        const rows = await dataSource.query(`SELECT id FROM products WHERE name LIKE $1 ORDER BY id`, [
            `${DEMO_PREFIX}%`,
        ]);
        const ids: number[] = rows.map((r: { id: number }) => r.id);
        keys = ids.map(cardKey);
        await redis.del(...keys);

        const service = new ProductCardService(
            new ProductCardRepository(dataSource),
            new RedisCache(redis),
        );

        for (const id of ids) {
            await service.getCard(id);
        }
        const warmed = await redis.exists(...keys);
        const ttls = await Promise.all(keys.map((key) => redis.ttl(key)));
        const ttlDistinct = new Set(ttls).size;

        counter.reset();
        for (let i = 0; i < WARM_READS; i++) {
            await service.getCard(ids[i % ids.length]);
        }
        const dbCallsWarm = counter.count(CARD_QUERY_TAG);

        printLines({
            'cache-lru': policy !== 'noeviction' ? 1 : 0,
            'cache-maxmemory': maxmemory > 0 ? 1 : 0,
            warmed,
            'ttl-distinct': ttlDistinct,
            'ttl-min': Math.min(...ttls),
            'ttl-max': Math.max(...ttls),
            'db-calls-warm': dbCallsWarm,
        });

        expectEq(failures, 'cache-lru', policy !== 'noeviction', true);
        expectEq(failures, 'cache-maxmemory', maxmemory > 0, true);
        expectAtLeast(failures, 'warmed', warmed, 50);
        expectAtLeast(failures, 'ttl-distinct', ttlDistinct, 5);
        expectEq(failures, 'db-calls-warm', dbCallsWarm, 0);
    } finally {
        if (keys.length > 0) {
            await redis.del(...keys).catch(() => undefined);
        }
        await dataSource.query(`DELETE FROM products WHERE name LIKE $1`, [`${DEMO_PREFIX}%`]).catch(() => undefined);
        await redis.quit().catch(() => undefined);
        await dataSource.destroy().catch(() => undefined);
    }
});
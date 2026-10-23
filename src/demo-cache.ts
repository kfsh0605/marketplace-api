import 'reflect-metadata';
import type { Redis } from 'ioredis';
import { DataSource, DataSourceOptions } from 'typeorm';
import { RedisCache } from './cache/redis-cache';
import { RedisLock } from './cache/redis-lock';
import { AppDataSource } from './data-source';
import { expectAtLeast, expectEq, printLines, runStandalone } from './lib/demo-output';
import { QueryCounter } from './lib/query-counter';
import { CARD_QUERY_TAG, cardKey, cardLockKey } from './products/product-card';
import { ProductCardRepository } from './products/product-card.repository';
import { ProductCardService } from './products/product-card.service';
import { createCacheClient } from './redis/connect';

const DEMO_PRODUCTS = 60;
const DEMO_PREFIX = 'cache-demo-';
const WARM_READS = 100;
const CONCURRENT = 50;
const DEMO_LOCK_NAME = 'lock:cache-demo:foreign';

async function readConfig(redis: Redis, name: string): Promise<string> {
    const reply = (await redis.call('CONFIG', 'GET', name)) as string[];
    return reply[1];
}

async function stampede(
    service: ProductCardService,
    counter: QueryCounter,
    redis: Redis,
    productId: number,
): Promise<number> {
    await redis.del(cardKey(productId), cardLockKey(productId));
    counter.reset();
    await Promise.all(Array.from({ length: CONCURRENT }, () => service.getCard(productId)));
    return counter.count(CARD_QUERY_TAG);
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
    let cleanupKeys: string[] = [DEMO_LOCK_NAME];

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
        const keys = ids.map(cardKey);
        cleanupKeys = [...keys, ...ids.map(cardLockKey), DEMO_LOCK_NAME];
        await redis.del(...cleanupKeys);

        const repo = new ProductCardRepository(dataSource);
        const cache = new RedisCache(redis);
        const lock = new RedisLock(redis);
        const service = new ProductCardService(repo, cache, lock);
        const unprotected = new ProductCardService(repo, cache, lock, { singleFlight: false });

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

        const target = ids[0];
        const dbCallsNoLock = await stampede(unprotected, counter, redis, target);
        const dbCalls = await stampede(service, counter, redis, target);

        const ownerToken = await lock.acquire(DEMO_LOCK_NAME, 5000);
        const foreignRelease = await lock.release(DEMO_LOCK_NAME, 'chuzhyi-token');
        const survived = await redis.exists(DEMO_LOCK_NAME);
        const ownRelease = ownerToken ? await lock.release(DEMO_LOCK_NAME, ownerToken) : false;

        printLines({
            'cache-lru': policy !== 'noeviction' ? 1 : 0,
            'cache-maxmemory': maxmemory > 0 ? 1 : 0,
            warmed,
            'ttl-distinct': ttlDistinct,
            'ttl-min': Math.min(...ttls),
            'ttl-max': Math.max(...ttls),
            'db-calls-warm': dbCallsWarm,
            concurrent: CONCURRENT,
            'db-calls': dbCalls,
            'db-calls-nolock': dbCallsNoLock,
            'lock-foreign-release': foreignRelease ? 1 : 0,
            'lock-survived-foreign-release': survived,
            'lock-own-release': ownRelease ? 1 : 0,
        });

        expectEq(failures, 'cache-lru', policy !== 'noeviction', true);
        expectEq(failures, 'cache-maxmemory', maxmemory > 0, true);
        expectAtLeast(failures, 'warmed', warmed, 50);
        expectAtLeast(failures, 'ttl-distinct', ttlDistinct, 5);
        expectEq(failures, 'db-calls-warm', dbCallsWarm, 0);
        expectAtLeast(failures, 'concurrent', CONCURRENT, 20);
        expectEq(failures, 'db-calls', dbCalls, 1);
        expectAtLeast(failures, 'db-calls-nolock', dbCallsNoLock, 2);
        expectEq(failures, 'lock acquired', ownerToken !== null, true);
        expectEq(failures, 'lock-foreign-release', foreignRelease, false);
        expectEq(failures, 'lock-survived-foreign-release', survived, 1);
        expectEq(failures, 'lock-own-release', ownRelease, true);
    } finally {
        await redis.del(...cleanupKeys).catch(() => undefined);
        await dataSource.query(`DELETE FROM products WHERE name LIKE $1`, [`${DEMO_PREFIX}%`]).catch(() => undefined);
        await redis.quit().catch(() => undefined);
        await dataSource.destroy().catch(() => undefined);
    }
});
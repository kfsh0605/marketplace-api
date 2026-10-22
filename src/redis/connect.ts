import { Redis } from 'ioredis';
import { withTimeout } from '../lib/with-timeout';

export function requireUrl(name: string): string {
    const url = process.env[name];
    if (!url) {
        throw new Error(`${name} не заданий: запускай через scripts/with-secrets.sh або експортуй змінну (SKIP_VAULT=1)`);
    }
    return url;
}

async function connectClient(url: string, label: string): Promise<Redis> {
    const client = new Redis(url, {
        lazyConnect: true,
        connectTimeout: 2000,
        commandTimeout: 500,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        retryStrategy: (times) => Math.min(times * 200, 2000),
    });
    client.on('error', (err) => console.warn(`${label}: ${err.message}`));
    await withTimeout(client.connect(), 5000, `підключення до ${label}`);
    return client;
}

export function createCacheClient(url: string = requireUrl('REDIS_URL')): Promise<Redis> {
    return connectClient(url, 'Redis-кеш');
}

export function createSessionClient(url: string = requireUrl('REDIS_QUEUE_URL')): Promise<Redis> {
    return connectClient(url, 'Redis-сесії');
}
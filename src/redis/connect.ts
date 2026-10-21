import { Redis } from 'ioredis';
import { withTimeout } from '../lib/with-timeout';

export function requireUrl(name: string): string {
    const url = process.env[name];
    if (!url) {
        throw new Error(`${name} не заданий: запускай через scripts/with-secrets.sh або експортуй змінну (SKIP_VAULT=1)`);
    }
    return url;
}

export async function createCacheClient(url: string = requireUrl('REDIS_URL')): Promise<Redis> {
    const client = new Redis(url, {
        lazyConnect: true,
        connectTimeout: 2000,
        commandTimeout: 500,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        retryStrategy: (times) => Math.min(times * 200, 2000),
    });
    client.on('error', (err) => console.warn(`redis cache: ${err.message}`));
    await withTimeout(client.connect(), 5000, 'підключення до Redis-кешу');
    return client;
}
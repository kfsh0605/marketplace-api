import { Redis } from 'ioredis';
import { withTimeout } from '../lib/with-timeout';

export function requireUrl(name: string): string {
    const url = process.env[name];
    if (!url) {
        throw new Error(`${name} не заданий: запускай через scripts/with-secrets.sh або експортуй змінну (SKIP_VAULT=1)`);
    }
    return url;
}

function buildClient(url: string, label: string, lazyConnect: boolean): Redis {
    const client = new Redis(url, {
        lazyConnect,
        connectTimeout: 2000,
        commandTimeout: 500,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        retryStrategy: (times) => Math.min(times * 200, 2000),
    });
    client.on('error', (err) => console.warn(`${label}: ${err.message}`));
    return client;
}

async function connectClient(url: string, label: string): Promise<Redis> {
    const client = buildClient(url, label, true);
    await withTimeout(client.connect(), 5000, `підключення до ${label}`);
    return client;
}

export function createCacheClient(url: string = requireUrl('REDIS_URL')): Promise<Redis> {
    return connectClient(url, 'Redis-кеш');
}

export function createSessionClient(url: string = requireUrl('REDIS_QUEUE_URL')): Promise<Redis> {
    return connectClient(url, 'Redis-сесії');
}

export function openCacheClient(url: string = requireUrl('REDIS_URL')): Redis {
    return buildClient(url, 'Redis-кеш', false);
}

export type QueueRole = 'producer' | 'worker';

export function queueConnectionOptions(role: QueueRole, url: string = requireUrl('REDIS_QUEUE_URL')) {
    const parsed = new URL(url);
    return {
        host: parsed.hostname,
        port: Number(parsed.port || 6379),
        username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
        password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
        maxRetriesPerRequest: role === 'worker' ? null : 1,
    };
}

export const createQueueInstanceClient = createSessionClient;
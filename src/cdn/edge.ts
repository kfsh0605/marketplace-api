import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ASSETS_PREFIX } from './publish-asset';

export const DEFAULT_MAX_CACHE_BYTES = 64 * 1024 * 1024;

export interface OriginObject {
    body: Buffer;
    contentType?: string;
    cacheControl?: string;
    etag?: string;
}

export interface AssetOrigin {
    getObject(key: string): Promise<OriginObject | null>;
    getObjectIfChanged?(key: string, etag: string): Promise<OriginObject | 'not-modified' | null>;
}

export interface EdgeOptions {
    maxCacheBytes?: number;
}

export interface Edge {
    port: number;
    originFetches(): number;
    cacheBytes(): number;
    cacheEntries(): number;
    close(): Promise<void>;
}

interface Entry extends OriginObject {
    expiresAt: number;
}

type CacheState = 'HIT' | 'MISS' | 'REVALIDATED';

interface Resolved {
    object: OriginObject;
    state: CacheState;
}

export function cacheTtlSeconds(cacheControl: string | undefined): number {
    if (!cacheControl || !/\bpublic\b/i.test(cacheControl) || /\b(no-store|private)\b/i.test(cacheControl)) {
        return 0;
    }
    const match = /max-age=(\d+)/i.exec(cacheControl);
    return match ? Number(match[1]) : 0;
}

export function etagMatches(header: string | undefined, etag: string): boolean {
    if (!header) {
        return false;
    }
    if (header.trim() === '*') {
        return true;
    }
    const strip = (value: string): string => value.trim().replace(/^W\//, '');
    const target = strip(etag);
    return header.split(',').some((candidate) => strip(candidate) === target);
}

export function startEdge(origin: AssetOrigin, port = 0, options: EdgeOptions = {}): Promise<Edge> {
    const maxCacheBytes = options.maxCacheBytes ?? DEFAULT_MAX_CACHE_BYTES;
    const cache = new Map<string, Entry>();
    let cachedBytes = 0;
    let originFetches = 0;

    const drop = (key: string): void => {
        const entry = cache.get(key);
        if (entry) {
            cachedBytes -= entry.body.length;
            cache.delete(key);
        }
    };

    const store = (key: string, object: OriginObject, ttlSeconds: number): void => {
        drop(key);
        const size = object.body.length;
        if (ttlSeconds <= 0 || size > maxCacheBytes) {
            return;
        }
        for (const [oldest, entry] of cache) {
            if (cachedBytes + size <= maxCacheBytes) {
                break;
            }
            cache.delete(oldest);
            cachedBytes -= entry.body.length;
        }
        cache.set(key, { ...object, expiresAt: Date.now() + ttlSeconds * 1000 });
        cachedBytes += size;
    };

    const remember = (key: string, object: OriginObject | null): Resolved | null => {
        if (!object) {
            drop(key);
            return null;
        }
        store(key, object, cacheTtlSeconds(object.cacheControl));
        return { object, state: 'MISS' };
    };

    const resolve = async (key: string): Promise<Resolved | null> => {
        const cached = cache.get(key);
        if (cached && cached.expiresAt > Date.now()) {
            cache.delete(key);
            cache.set(key, cached);
            return { object: cached, state: 'HIT' };
        }

        originFetches += 1;
        if (cached?.etag && origin.getObjectIfChanged) {
            const result = await origin.getObjectIfChanged(key, cached.etag);
            if (result === 'not-modified') {
                store(key, cached, cacheTtlSeconds(cached.cacheControl));
                return { object: cached, state: 'REVALIDATED' };
            }
            return remember(key, result);
        }
        return remember(key, await origin.getObject(key));
    };

    const server = createServer(async (req, res) => {
        try {
            const key = decodeURIComponent(new URL(req.url ?? '/', 'http://edge').pathname.slice(1));
            const readOnly = req.method === 'GET' || req.method === 'HEAD';
            if (!readOnly || !key.startsWith(ASSETS_PREFIX) || key.includes('..')) {
                res.writeHead(404).end();
                return;
            }

            const resolved = await resolve(key);
            if (!resolved) {
                res.writeHead(404).end();
                return;
            }

            const { object, state } = resolved;
            const headers: Record<string, string> = { 'x-cache': state };
            if (object.cacheControl) headers['cache-control'] = object.cacheControl;
            if (object.etag) headers.etag = object.etag;

            if (object.etag && etagMatches(req.headers['if-none-match'], object.etag)) {
                res.writeHead(304, headers).end();
                return;
            }

            if (object.contentType) headers['content-type'] = object.contentType;
            headers['content-length'] = String(object.body.length);
            res.writeHead(200, headers);
            if (req.method === 'HEAD') {
                res.end();
            } else {
                res.end(object.body);
            }
        } catch {
            res.writeHead(502).end();
        }
    });

    return new Promise((resolve) => {
        server.listen(port, '127.0.0.1', () => {
            resolve({
                port: (server.address() as AddressInfo).port,
                originFetches: () => originFetches,
                cacheBytes: () => cachedBytes,
                cacheEntries: () => cache.size,
                close: () =>
                    new Promise<void>((done) => {
                        server.closeAllConnections();
                        server.close(() => done());
                    }),
            });
        });
    });
}
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ASSETS_PREFIX } from './publish-asset';

export interface OriginObject {
    body: Buffer;
    contentType?: string;
    cacheControl?: string;
    etag?: string;
}

export interface AssetOrigin {
    getObject(key: string): Promise<OriginObject | null>;
}

export interface Edge {
    port: number;
    originFetches(): number;
    close(): Promise<void>;
}

interface Entry extends OriginObject {
    expiresAt: number;
}

export function cacheTtlSeconds(cacheControl: string | undefined): number {
    if (!cacheControl || !/\bpublic\b/i.test(cacheControl) || /\b(no-store|private)\b/i.test(cacheControl)) {
        return 0;
    }
    const match = /max-age=(\d+)/i.exec(cacheControl);
    return match ? Number(match[1]) : 0;
}

export function startEdge(origin: AssetOrigin, port = 0): Promise<Edge> {
    const cache = new Map<string, Entry>();
    let originFetches = 0;

    const server = createServer(async (req, res) => {
        try {
            const key = decodeURIComponent(new URL(req.url ?? '/', 'http://edge').pathname.slice(1));
            if (req.method !== 'GET' || !key.startsWith(ASSETS_PREFIX) || key.includes('..')) {
                res.writeHead(404).end();
                return;
            }

            const cached = cache.get(key);
            const hit = cached !== undefined && cached.expiresAt > Date.now();
            let object: OriginObject | null = hit ? cached : null;
            if (!hit) {
                originFetches += 1;
                object = await origin.getObject(key);
                const ttl = object ? cacheTtlSeconds(object.cacheControl) : 0;
                if (object && ttl > 0) {
                    cache.set(key, { ...object, expiresAt: Date.now() + ttl * 1000 });
                }
            }
            if (!object) {
                res.writeHead(404).end();
                return;
            }

            const headers: Record<string, string> = { 'x-cache': hit ? 'HIT' : 'MISS' };
            if (object.contentType) headers['content-type'] = object.contentType;
            if (object.cacheControl) headers['cache-control'] = object.cacheControl;
            if (object.etag) headers.etag = object.etag;
            res.writeHead(200, headers).end(object.body);
        } catch {
            res.writeHead(502).end();
        }
    });

    return new Promise((resolve) => {
        server.listen(port, '127.0.0.1', () => {
            resolve({
                port: (server.address() as AddressInfo).port,
                originFetches: () => originFetches,
                close: () =>
                    new Promise<void>((done) => {
                        server.closeAllConnections();
                        server.close(() => done());
                    }),
            });
        });
    });
}
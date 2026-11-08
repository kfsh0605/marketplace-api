import type { IncomingMessage, ServerResponse } from 'node:http';
import { hostname } from 'node:os';
import type { K8sConfig } from './config';
import type { Lifecycle } from './lifecycle';

const CATALOG = [
    { id: 1, title: 'Клавіатура' },
    { id: 2, title: 'Миша' },
    { id: 3, title: 'Монітор' },
];

export function createHandler(config: K8sConfig, lifecycle: Lifecycle) {
    const pod = hostname();

    const send = (res: ServerResponse, status: number, body: unknown): void => {
        const payload = JSON.stringify(body);
        res.writeHead(status, {
            'content-type': 'application/json; charset=utf-8',
            'content-length': Buffer.byteLength(payload),
            'cache-control': 'no-store',
            ...(lifecycle.phase === 'draining' ? { connection: 'close' } : {}),
        });
        res.end(payload);
    };

    return (req: IncomingMessage, res: ServerResponse): void => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            send(res, 405, { error: 'method-not-allowed' });
            return;
        }

        const path = (req.url ?? '/').split('?')[0];

        if (path === '/healthz') {
            send(res, 200, { status: 'alive' });
            return;
        }

        if (path === '/readyz') {
            if (lifecycle.isReady) {
                send(res, 200, { status: 'ready' });
            } else {
                send(res, 503, { status: 'not-ready', phase: lifecycle.phase });
            }
            return;
        }

        if (path === '/products') {
            setTimeout(() => send(res, 200, { rev: config.REV, pod, items: CATALOG }), config.LATENCY_MS);
            return;
        }

        send(res, 404, { error: 'not-found' });
    };
}
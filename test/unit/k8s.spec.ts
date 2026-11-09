import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHandler } from '../../src/k8s/app';
import { loadK8sConfig } from '../../src/k8s/config';
import { createShutdown } from '../../src/k8s/graceful';
import { Lifecycle } from '../../src/k8s/lifecycle';

const baseEnv = { DB_PASSWORD: 'test-password', LATENCY_MS: '0', REV: 'test' };

async function listen(server: Server): Promise<string> {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function get(url: string) {
    const response = await fetch(url);
    const body = await response.text();
    return { status: response.status, headers: response.headers, body };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('k8s: конфіг', () => {
    it('дефолти: прогрів 4 с, дренаж 5 с', () => {
        const config = loadK8sConfig(baseEnv);
        expect(config.WARMUP_MS).toBe(4000);
        expect(config.DRAIN_MS).toBe(5000);
        expect(config.PORT).toBe(3000);
    });

    it('без DB_PASSWORD падає і називає змінну', () => {
        expect(() => loadK8sConfig({})).toThrow(/DB_PASSWORD/);
    });

    it('порожній DB_PASSWORD теж падає', () => {
        expect(() => loadK8sConfig({ DB_PASSWORD: '' })).toThrow(/DB_PASSWORD/);
    });
});

describe('k8s: життєвий цикл', () => {
    it('starting -> ready -> draining -> closed', () => {
        const lifecycle = new Lifecycle();
        expect(lifecycle.isReady).toBe(false);
        lifecycle.markReady();
        expect(lifecycle.isReady).toBe(true);
        lifecycle.beginDrain();
        expect(lifecycle.phase).toBe('draining');
        expect(lifecycle.isReady).toBe(false);
        lifecycle.markClosed();
        expect(lifecycle.phase).toBe('closed');
    });

    it('після початку дренажу готовність не воскресає', () => {
        const lifecycle = new Lifecycle();
        lifecycle.markReady();
        lifecycle.beginDrain();
        lifecycle.markReady();
        expect(lifecycle.isReady).toBe(false);
    });
});

describe('k8s: HTTP-обробник', () => {
    let server: Server;
    let base: string;
    let lifecycle: Lifecycle;

    beforeEach(async () => {
        lifecycle = new Lifecycle();
        server = createServer(createHandler(loadK8sConfig(baseEnv), lifecycle));
        base = await listen(server);
    });

    afterEach(async () => {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('/readyz 503 поки starting, 200 коли ready', async () => {
        expect((await get(`${base}/readyz`)).status).toBe(503);
        lifecycle.markReady();
        expect((await get(`${base}/readyz`)).status).toBe(200);
    });

    it('/healthz лишається 200 і під час дренажу', async () => {
        lifecycle.markReady();
        lifecycle.beginDrain();
        expect((await get(`${base}/healthz`)).status).toBe(200);
        expect((await get(`${base}/readyz`)).status).toBe(503);
    });

    it('/products віддає rev і pod', async () => {
        lifecycle.markReady();
        const { status, body } = await get(`${base}/products`);
        expect(status).toBe(200);
        expect(JSON.parse(body)).toMatchObject({ rev: 'test' });
    });

    it('невідомий шлях 404, не-GET 405', async () => {
        expect((await get(`${base}/nope`)).status).toBe(404);
        const post = await fetch(`${base}/products`, { method: 'POST' });
        expect(post.status).toBe(405);
    });

    it('під час дренажу відповідає Connection: close', async () => {
        lifecycle.markReady();
        lifecycle.beginDrain();
        expect((await get(`${base}/healthz`)).headers.get('connection')).toBe('close');
    });
});

describe('k8s: SIGTERM -> readyz червоний -> дренаж -> close', () => {
    it('у вікні дренажу readyz=503, але запити ще обслуговуються; після нього сокет закрито', async () => {
        const lifecycle = new Lifecycle();
        const server = createServer(createHandler(loadK8sConfig(baseEnv), lifecycle));
        const base = await listen(server);
        lifecycle.markReady();

        const logs: string[] = [];
        const exits: number[] = [];
        const shutdown = createShutdown(server, lifecycle, {
            drainMs: 300,
            log: (line) => logs.push(line),
            exit: (code) => exits.push(code),
        });

        expect((await get(`${base}/readyz`)).status).toBe(200);

        const finished = shutdown('SIGTERM');
        await sleep(80);

        expect((await get(`${base}/readyz`)).status).toBe(503);
        expect((await get(`${base}/products`)).status).toBe(200);
        expect(exits).toEqual([]);

        await finished;

        await expect(fetch(`${base}/healthz`)).rejects.toThrow();
        expect(exits).toEqual([0]);
        expect(logs[0]).toContain('SIGTERM');
        expect(logs[logs.length - 1]).toContain('closed');
    });

    it('другий сигнал не запускає завершення вдруге', async () => {
        const lifecycle = new Lifecycle();
        const server = createServer(createHandler(loadK8sConfig(baseEnv), lifecycle));
        await listen(server);
        lifecycle.markReady();

        const exits: number[] = [];
        const shutdown = createShutdown(server, lifecycle, {
            drainMs: 50,
            log: () => undefined,
            exit: (code) => exits.push(code),
        });

        await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')]);
        expect(exits).toEqual([0]);
    });
});
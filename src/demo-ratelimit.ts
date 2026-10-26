import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { Redis } from 'ioredis';
import { expectAtLeast, expectEq, printLines, runStandalone } from './lib/demo-output';
import { rateLimitMiddleware } from './ratelimit/rate-limit-middleware';
import { Limiter, LimitResult, SlidingWindowLimiter } from './ratelimit/sliding-window-limiter';
import { createCacheClient } from './redis/connect';

const INSTANCES = 3;
const LIMIT = 5;
const WINDOW_MS = 10_000;
const TOTAL_REQUESTS = 15;
const CLIENT_ID = 'demo-client';

class MemoryWindowLimiter implements Limiter {
    private count = 0;
    private windowStart = Date.now();

    constructor(
        private readonly limit: number,
        private readonly windowMs: number,
    ) {}

    async consume(): Promise<LimitResult> {
        const now = Date.now();
        if (now - this.windowStart >= this.windowMs) {
            this.windowStart = now;
            this.count = 0;
        }
        if (this.count < this.limit) {
            this.count++;
            return { allowed: true, remaining: this.limit - this.count, retryAfterSec: 0 };
        }
        const retryMs = this.windowStart + this.windowMs - now;
        return { allowed: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil(retryMs / 1000)) };
    }
}

interface Pod {
    server: Server;
    port: number;
}

async function startPod(limiter: Limiter): Promise<Pod> {
    const app = express();
    app.use(rateLimitMiddleware(limiter, () => CLIENT_ID));
    app.get('/ping', (_req, res) => {
        res.json({ ok: true });
    });
    const server: Server = await new Promise((resolve) => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    return { server, port: (server.address() as AddressInfo).port };
}

interface Reply {
    status: number;
    retryAfter: string | null;
}

async function burst(pods: Pod[]): Promise<Reply[]> {
    return Promise.all(
        Array.from({ length: TOTAL_REQUESTS }, async (_, i) => {
            const response = await fetch(`http://127.0.0.1:${pods[i % pods.length].port}/ping`);
            await response.arrayBuffer();
            return { status: response.status, retryAfter: response.headers.get('retry-after') };
        }),
    );
}

async function stopPods(pods: Pod[]): Promise<void> {
    await Promise.all(
        pods.map((pod) => new Promise<void>((resolve) => pod.server.close(() => resolve()))),
    );
}

void runStandalone(async (failures) => {
    const clients: Redis[] = [];
    const prefix = `rl-demo-${Date.now()}`;
    let pods: Pod[] = [];
    let memoryPods: Pod[] = [];

    try {
        const limiters: Limiter[] = [];
        for (let i = 0; i < INSTANCES; i++) {
            const client = await createCacheClient();
            clients.push(client);
            limiters.push(new SlidingWindowLimiter(client, { limit: LIMIT, windowMs: WINDOW_MS, prefix }));
        }
        pods = await Promise.all(limiters.map((limiter) => startPod(limiter)));
        const replies = await burst(pods);

        const allowed = replies.filter((r) => r.status === 200).length;
        const blockedReplies = replies.filter((r) => r.status !== 200);
        const lastBlocked = blockedReplies[blockedReplies.length - 1];
        const everyHasRetryAfter =
            blockedReplies.length > 0 && blockedReplies.every((r) => Number(r.retryAfter) >= 1);

        memoryPods = await Promise.all(
            Array.from({ length: INSTANCES }, () => startPod(new MemoryWindowLimiter(LIMIT, WINDOW_MS))),
        );
        const memoryReplies = await burst(memoryPods);
        const memoryAllowed = memoryReplies.filter((r) => r.status === 200).length;

        printLines({
            instances: INSTANCES,
            limit: LIMIT,
            requests: TOTAL_REQUESTS,
            allowed,
            blocked: blockedReplies.length,
            status: lastBlocked ? lastBlocked.status : 0,
            'retry-after': everyHasRetryAfter ? 1 : 0,
            'retry-after-sec': lastBlocked ? Number(lastBlocked.retryAfter) : 0,
            'memory-allowed': memoryAllowed,
        });

        expectAtLeast(failures, 'instances', INSTANCES, 2);
        expectEq(failures, 'allowed', allowed, LIMIT);
        expectAtLeast(failures, 'blocked', blockedReplies.length, 1);
        expectEq(failures, 'status', lastBlocked ? lastBlocked.status : 0, 429);
        expectEq(failures, 'retry-after', everyHasRetryAfter, true);
        expectAtLeast(failures, 'memory-allowed (лічильник у пам\'яті протікає)', memoryAllowed, LIMIT + 1);
    } finally {
        await stopPods([...pods, ...memoryPods]);
        if (clients.length > 0) {
            await clients[0].del(`${prefix}:${CLIENT_ID}`).catch(() => undefined);
        }
        await Promise.all(clients.map((client) => client.quit().catch(() => undefined)));
    }
});
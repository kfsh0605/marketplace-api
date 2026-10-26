import { spawn } from 'node:child_process';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import express from 'express';
import { expectAtLeast, expectEq, printLines, runStandalone } from './lib/demo-output';
import { sleep } from './lib/sleep';
import { createSessionClient } from './redis/connect';
import { sessionMiddleware, SessionRequest, startSession } from './sessions/session-middleware';
import { sessionKey, SessionStore } from './sessions/session-store';

const DEMO_TTL_SEC = 4;

function probeSession(sid: string): Promise<number> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [join(__dirname, 'session-probe.js'), sid, String(DEMO_TTL_SEC)], {
            env: process.env,
        });
        let out = '';
        child.stdout.on('data', (chunk) => {
            out += chunk.toString();
        });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`session-probe завершився з кодом ${code}`));
                return;
            }
            resolve(out.includes('found=1') ? 1 : 0);
        });
    });
}

void runStandalone(async (failures) => {
    const redis = await createSessionClient();
    const store = new SessionStore(redis, { ttlSec: DEMO_TTL_SEC });

    const app = express();
    app.use(sessionMiddleware(store));
    app.get('/login', async (_req, res, next) => {
        try {
            await startSession(store, res, { userId: 42 });
            res.json({ ok: true });
        } catch (err) {
            next(err);
        }
    });
    app.get('/me', (req, res) => {
        const session = (req as SessionRequest).session;
        if (!session) {
            res.status(401).json({ error: 'no session' });
            return;
        }
        res.json(session.values);
    });

    const server: Server = await new Promise((resolve) => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const port = (server.address() as AddressInfo).port;

    let requests = 0;
    const seenSids = new Set<string>();
    let lastSid = '';

    async function call(path: string, sid?: string): Promise<number> {
        requests++;
        const response = await fetch(`http://127.0.0.1:${port}${path}`, {
            headers: sid ? { cookie: `sid=${sid}` } : {},
        });
        await response.arrayBuffer();
        for (const cookie of response.headers.getSetCookie()) {
            const match = /^sid=([^;]+)/.exec(cookie);
            if (match) {
                lastSid = decodeURIComponent(match[1]);
                seenSids.add(lastSid);
            }
        }
        return response.status;
    }

    try {
        const loginStatus = await call('/login');
        const sid = lastSid;
        await sleep(2000);

        const ttlBefore = await redis.ttl(sessionKey(sid));
        const firstMeStatus = await call('/me', sid);
        const ttlAfter = await redis.ttl(sessionKey(sid));

        await sleep(3000);
        const secondMeStatus = await call('/me', sid);
        const inRedis = await redis.exists(sessionKey(sid));

        const foundByOtherProcess = await probeSession(sid);
        const anonymousStatus = await call('/me');

        await sleep((DEMO_TTL_SEC + 1.5) * 1000);
        const idleStatus = await call('/me', sid);

        printLines({
            requests,
            sessions: seenSids.size,
            'in-redis': inRedis,
            'ttl-renewed': ttlAfter > ttlBefore ? 1 : 0,
            'ttl-before': ttlBefore,
            'ttl-after': ttlAfter,
            'survived-original-ttl': secondMeStatus === 200 ? 1 : 0,
            'found-by-other-process': foundByOtherProcess,
            'anonymous-status': anonymousStatus,
            'idle-status': idleStatus,
        });

        expectEq(failures, 'login status', loginStatus, 200);
        expectEq(failures, 'first /me status', firstMeStatus, 200);
        expectEq(failures, 'second /me status', secondMeStatus, 200);
        expectAtLeast(failures, 'requests', requests, 3);
        expectEq(failures, 'sessions', seenSids.size, 1);
        expectEq(failures, 'in-redis', inRedis, 1);
        expectEq(failures, 'ttl-renewed', ttlAfter > ttlBefore, true);
        expectEq(failures, 'found-by-other-process', foundByOtherProcess, 1);
        expectEq(failures, 'anonymous-status', anonymousStatus, 401);
        expectEq(failures, 'idle-status', idleStatus, 401);

        await redis.del(sessionKey(sid));
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await redis.quit().catch(() => undefined);
    }
});
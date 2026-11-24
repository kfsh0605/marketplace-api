import 'reflect-metadata';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { join } from 'node:path';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { AppDataSource } from './data-source';
import { cleanupDemoData, createDemoUser, DEMO_PASSWORD, runTag } from './lib/auth-demo-kit';
import { expectAtLeast, expectEq, printLines, runStandalone, waitUntil } from './lib/demo-output';
import { makeTraceparent, newTraceId, parseLogLines } from './lib/obs-demo-kit';
import { sleep } from './lib/sleep';
import { startOrderPlacedConsumer } from './messaging/consumer';
import { openDemo } from './messaging/demo-kit';
import { EventPublisher } from './messaging/publisher';
import { QUEUE_ORDER_PLACED } from './messaging/rabbitmq.config';
import { relayLoop } from './outbox/relay';

/**
 * Наскрізний контур однією командою (ТЗ, розділ 4, ланки 1-8).
 *
 * Демо піднімає СПРАВЖНІЙ застосунок (dist/main.js) окремим процесом на власному порту, а relay і consumer
 * запускає в собі: ті самі relayLoop і startOrderPlacedConsumer, що й у `npm run relay` / `npm run consumer`.
 * Потім як клієнт проходить сценарій «замовлення від створення до доставки» і друкує `ключ=значення`.
 */

const PORT = Number(process.env.CONTOUR_PORT ?? 22921);
const BASE = `http://127.0.0.1:${PORT}`;

interface Res {
    status: number;
    headers: Headers;
    text: string;
    body: any;
}

interface CallOptions {
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
}

async function call(method: string, path: string, options: CallOptions = {}): Promise<Res> {
    const headers: Record<string, string> = { ...options.headers };
    if (options.token) {
        headers.authorization = `Bearer ${options.token}`;
    }
    if (options.body !== undefined) {
        headers['content-type'] = 'application/json';
    }
    const response = await fetch(`${BASE}${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    let body: any;
    try {
        body = text ? JSON.parse(text) : null;
    } catch {
        body = text;
    }
    return { status: response.status, headers: response.headers, text, body };
}

function isProblem(res: Res): boolean {
    return (res.headers.get('content-type') ?? '').includes('application/problem+json');
}

function portIsBusy(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = net.connect({ host: '127.0.0.1', port });
        socket.once('connect', () => {
            socket.destroy();
            resolve(true);
        });
        socket.once('error', () => resolve(false));
    });
}

interface ApiProcess {
    child: ChildProcess;
    lines: string[];
    stop(): Promise<void>;
}

function collectLines(stream: NodeJS.ReadableStream, target: string[]): void {
    let tail = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
        const parts = (tail + chunk).split('\n');
        tail = parts.pop() ?? '';
        for (const part of parts) {
            const line = part.replace(/\r$/, '');
            if (line.length > 0) {
                target.push(line);
            }
        }
    });
}

/** Справжній `node dist/main.js` на окремому порту; stdout і stderr зберігаємо, щоб потім звірити логи. */
async function startApi(): Promise<ApiProcess> {
    if (await portIsBusy(PORT)) {
        throw new Error(`порт ${PORT} зайнятий: звільни його або задай CONTOUR_PORT=<вільний порт>`);
    }
    const child = spawn(process.execPath, [join(__dirname, 'main.js')], {
        env: { ...process.env, PORT: String(PORT), OTEL_SERVICE_NAME: 'marketplace-api' },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const lines: string[] = [];
    collectLines(child.stdout!, lines);
    collectLines(child.stderr!, lines);

    let exited = false;
    child.on('exit', () => {
        exited = true;
    });

    const deadline = Date.now() + 40_000;
    for (;;) {
        if (exited) {
            throw new Error(`застосунок завершився на старті: ${lines.slice(-3).join(' | ')}`);
        }
        try {
            if ((await call('GET', '/health')).status === 200) {
                break;
            }
        } catch {
            // ще не слухає
        }
        if (Date.now() > deadline) {
            child.kill();
            throw new Error(`застосунок не відповів за 40 с на порту ${PORT}: ${lines.slice(-3).join(' | ')}`);
        }
        await sleep(200);
    }

    return {
        child,
        lines,
        async stop() {
            if (exited) {
                return;
            }
            child.kill();
            const until = Date.now() + 5000;
            while (!exited && Date.now() < until) {
                await sleep(50);
            }
        },
    };
}

async function settleLines(lines: string[], quietMs = 300, maxMs = 8000): Promise<void> {
    const started = Date.now();
    let last = lines.length;
    let changedAt = Date.now();
    while (Date.now() - started < maxMs) {
        await sleep(25);
        if (lines.length !== last) {
            last = lines.length;
            changedAt = Date.now();
        } else if (Date.now() - changedAt >= quietMs) {
            return;
        }
    }
}

async function login(email: string): Promise<string> {
    const res = await call('POST', '/auth/login', { body: { email, password: DEMO_PASSWORD } });
    if (res.status !== 200 || typeof res.body?.accessToken !== 'string') {
        throw new Error(`вхід ${email} не вдався: ${res.status} ${res.text.slice(0, 120)}`);
    }
    return res.body.accessToken;
}

void runStandalone(async (failures) => {
    const tag = runTag('contour');
    const customerEmail = `${tag}-customer@example.com`;
    const strangerEmail = `${tag}-stranger@example.com`;
    const sellerEmail = `${tag}-seller@example.com`;
    const productName = `CONTOUR_DEMO_${tag}`;
    const idempotencyKey = `contour-${tag}`;
    const emails = [customerEmail, strangerEmail, sellerEmail];

    const dataSource = new DataSource({ ...AppDataSource.options, logging: false } as DataSourceOptions);
    await dataSource.initialize();
    const demo = await openDemo();

    const stopRelay = new AbortController();
    const publisher = new EventPublisher();
    let relayDone: Promise<void> | undefined;
    let consumerTag: string | undefined;
    let api: ApiProcess | undefined;
    let orderId: number | undefined;
    const out: Record<string, string | number> = {};

    try {
        const queue = await demo.ch.checkQueue(QUEUE_ORDER_PLACED);
        if (queue.consumerCount > 0) {
            throw new Error(
                `на черзі ${QUEUE_ORDER_PLACED} уже висить consumer (${queue.consumerCount}): ` +
                'зупини "npm run consumer" (Ctrl+C) і запусти демо знову',
            );
        }

        await createDemoUser(dataSource, customerEmail, 'customer');
        await createDemoUser(dataSource, strangerEmail, 'customer');
        await createDemoUser(dataSource, sellerEmail, 'seller');
        const product = await demo.pool.query(
            `INSERT INTO products (name, "priceCents", stock, currency) VALUES ($1, 10000, 100, 'UAH') RETURNING id`,
            [productName],
        );
        const productId: number = product.rows[0].id;
        const startedAt: Date = (await demo.pool.query(`SELECT now() AS t`)).rows[0].t;

        api = await startApi();
        out.health = (await call('GET', '/health')).status;

        const customerToken = await login(customerEmail);
        const strangerToken = await login(strangerEmail);
        const sellerToken = await login(sellerEmail);

        // Ланки 2-3: валідація і права доступу
        const validBody = { customerEmail, items: [{ productId: String(productId), quantity: 1 }] };
        const noToken = await call('POST', '/orders', { headers: { 'idempotency-key': idempotencyKey }, body: validBody });
        const noKey = await call('POST', '/orders', { token: customerToken, body: validBody });
        const invalid = await call('POST', '/orders', {
            token: customerToken,
            headers: { 'idempotency-key': `${idempotencyKey}-bad` },
            body: { customerEmail: 'not-an-email', items: [] },
        });
        out['no-token'] = noToken.status;
        out['no-idempotency-key'] = noKey.status;
        out['invalid-body'] = invalid.status;
        out['problem-json'] = isProblem(invalid) && isProblem(noToken) ? 1 : 0;

        // Ланки 1, 4, 5: запит, бізнес-логіка, збереження
        const traceId = newTraceId();
        const created = await call('POST', '/orders', {
            token: customerToken,
            headers: { 'idempotency-key': idempotencyKey, traceparent: makeTraceparent(traceId) },
            body: validBody,
        });
        orderId = Number(created.body?.id);
        out.create = created.status;
        out['status-created'] = created.body?.status === 'created' ? 1 : 0;

        const replay = await call('POST', '/orders', {
            token: customerToken,
            headers: { 'idempotency-key': idempotencyKey },
            body: validBody,
        });
        const reuse = await call('POST', '/orders', {
            token: customerToken,
            headers: { 'idempotency-key': idempotencyKey },
            body: { customerEmail, items: [{ productId: String(productId), quantity: 2 }] },
        });
        out['replay-header'] = replay.headers.get('idempotency-replay') === 'true' ? 1 : 0;
        out['replay-same-order'] = Number(replay.body?.id) === orderId ? 1 : 0;
        out['key-reuse'] = reuse.status;

        const counts = await demo.pool.query(
            `SELECT (SELECT count(*) FROM orders WHERE "customerEmail" = $1)::int AS orders,
                    (SELECT count(*) FROM outbox WHERE aggregate_type = 'Order' AND aggregate_id = $2)::int AS outbox`,
            [customerEmail, String(orderId)],
        );
        out.orders = counts.rows[0].orders;
        out.outbox = counts.rows[0].outbox;

        // Ланка 6: фонова обробка. Relay і consumer ті самі, що в `npm run relay` і `npm run consumer`.
        relayDone = relayLoop(demo.pool, publisher, { signal: stopRelay.signal, notBefore: startedAt, pollMs: 200 });
        const started = await startOrderPlacedConsumer(demo.ch, demo.store, {});
        consumerTag = started.consumerTag;

        // Ланка 7: результат читається окремим запитом
        const waitStart = Date.now();
        let status = '';
        const reachedPending = await waitUntil(
            async () => {
                const res = await call('GET', `/orders/${orderId}`, { token: customerToken });
                status = String(res.body?.status ?? '');
                return status === 'pending';
            },
            20_000,
            200,
        );
        out['background-pending'] = reachedPending ? 1 : 0;
        out['background-ms'] = Date.now() - waitStart;

        out.foreign = (await call('GET', `/orders/${orderId}`, { token: strangerToken })).status;
        out['role-denied'] = (await call('PATCH', `/orders/${orderId}/status`, { token: customerToken, body: { status: 'paid' } })).status;

        const patch = (to: string) => call('PATCH', `/orders/${orderId}/status`, { token: sellerToken, body: { status: to } });
        out['to-paid'] = (await patch('paid')).status;
        const skip = await patch('shipped');
        out['bad-transition'] = skip.status;
        out['bad-transition-problem'] = isProblem(skip) ? 1 : 0;
        out['to-packed'] = (await patch('packed')).status;
        out['to-shipped'] = (await patch('shipped')).status;
        out['to-delivered'] = (await patch('delivered')).status;
        out['after-terminal'] = (await patch('cancelled')).status;

        const final = await call('GET', `/orders/${orderId}`, { token: customerToken });
        out['final-status'] = String(final.body?.status);

        // Збереження: ті самі факти, прочитані прямо з бази
        const db = await demo.pool.query(
            `SELECT o.status,
                    (SELECT count(*) FROM outbox WHERE aggregate_type = 'Order' AND aggregate_id = $2 AND published_at IS NOT NULL)::int AS published,
                    (SELECT count(*) FROM processed_order_events WHERE "orderId" = $1)::int AS effect,
                    (SELECT count(*) FROM processed_messages WHERE message_id = $3)::int AS processed
               FROM orders o WHERE o.id = $1`,
            [orderId, String(orderId), `order-placed:${orderId}`],
        );
        out['db-status'] = String(db.rows[0]?.status);
        out.published = db.rows[0]?.published ?? -1;
        out.effect = db.rows[0]?.effect ?? -1;
        out.processed = db.rows[0]?.processed ?? -1;

        // Ланка 8: контур видно в метриках і в логах
        const metrics = await call('GET', '/metrics');
        out['metrics-route-template'] = /http_requests_total\{[^}]*route="\/orders\/:orderId"[^}]*\}/.test(metrics.text) ? 1 : 0;
        out['metrics-raw-id'] = new RegExp(`route="[^"]*/orders/${orderId}[/"]`).test(metrics.text) ? 1 : 0;

        await settleLines(api.lines);
        const { rows } = parseLogLines(api.lines);
        const forTrace = rows.filter((row) => row.trace_id === traceId);
        out['log-rows-for-trace'] = forTrace.length;
        out['log-request-row'] = forTrace.some(
            (row) => row.msg === 'request' && row.req?.url === '/orders' && row.req?.headers?.['idempotency-key'] === idempotencyKey,
        )
            ? 1
            : 0;
        out['secret-in-logs'] = api.lines.filter((line) => line.includes(customerToken) || line.includes(DEMO_PASSWORD)).length;
        out['trace-id'] = traceId;

        expectEq(failures, 'health', out.health, 200);
        expectEq(failures, 'no-token', out['no-token'], 401);
        expectEq(failures, 'no-idempotency-key', out['no-idempotency-key'], 400);
        expectEq(failures, 'invalid-body', out['invalid-body'], 400);
        expectEq(failures, 'problem-json', out['problem-json'], 1);
        expectEq(failures, 'create', out.create, 201);
        expectEq(failures, 'status-created', out['status-created'], 1);
        expectEq(failures, 'replay-header', out['replay-header'], 1);
        expectEq(failures, 'replay-same-order', out['replay-same-order'], 1);
        expectEq(failures, 'key-reuse', out['key-reuse'], 422);
        expectEq(failures, 'orders', out.orders, 1);
        expectEq(failures, 'outbox', out.outbox, 1);
        expectEq(failures, 'background-pending', out['background-pending'], 1);
        expectEq(failures, 'foreign', out.foreign, 404);
        expectEq(failures, 'role-denied', out['role-denied'], 403);
        expectEq(failures, 'to-paid', out['to-paid'], 200);
        expectEq(failures, 'bad-transition', out['bad-transition'], 409);
        expectEq(failures, 'bad-transition-problem', out['bad-transition-problem'], 1);
        expectEq(failures, 'to-packed', out['to-packed'], 200);
        expectEq(failures, 'to-shipped', out['to-shipped'], 200);
        expectEq(failures, 'to-delivered', out['to-delivered'], 200);
        expectEq(failures, 'after-terminal', out['after-terminal'], 409);
        expectEq(failures, 'final-status', out['final-status'], 'delivered');
        expectEq(failures, 'db-status', out['db-status'], 'delivered');
        expectEq(failures, 'published', out.published, 1);
        expectEq(failures, 'effect', out.effect, 1);
        expectEq(failures, 'processed', out.processed, 1);
        expectEq(failures, 'metrics-route-template', out['metrics-route-template'], 1);
        expectEq(failures, 'metrics-raw-id', out['metrics-raw-id'], 0);
        expectAtLeast(failures, 'log-rows-for-trace', Number(out['log-rows-for-trace']), 1);
        expectEq(failures, 'log-request-row', out['log-request-row'], 1);
        expectEq(failures, 'secret-in-logs', out['secret-in-logs'], 0);

        printLines(out);
    } finally {
        stopRelay.abort();
        await relayDone?.catch(() => undefined);
        if (consumerTag) {
            await demo.ch.cancel(consumerTag).catch(() => undefined);
        }
        await api?.stop().catch(() => undefined);
        await publisher.close().catch(() => undefined);

        try {
            if (orderId !== undefined && Number.isInteger(orderId)) {
                await demo.pool.query(`DELETE FROM processed_messages WHERE message_id = $1`, [`order-placed:${orderId}`]);
                await demo.pool.query(`DELETE FROM processed_order_events WHERE "orderId" = $1`, [orderId]);
            }
            await demo.pool.query(`DELETE FROM idempotency_keys WHERE idempotency_key LIKE $1`, [`%:${idempotencyKey}%`]);
            await demo.pool.query(
                `DELETE FROM order_items WHERE "orderId" IN (SELECT id FROM orders WHERE "customerEmail" = $1)`,
                [customerEmail],
            );
            const leftovers = await cleanupDemoData(dataSource, emails, [productName]);
            expectEq(failures, 'залишки демо-даних після cleanup', leftovers, 0);
        } catch (error) {
            failures.push(`cleanup: ${(error as Error).message}`);
        }
        await demo.close().catch(() => undefined);
        await dataSource.destroy().catch(() => undefined);
    }
});

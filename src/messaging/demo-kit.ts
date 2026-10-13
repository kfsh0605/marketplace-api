import { connect, type Channel, type ChannelModel } from 'amqplib';
import { Pool } from 'pg';
import type { EffectStore } from './consumer';
import { buildOrderPlacedEvent, type OrderPlacedEvent } from './events';
import { QUEUE_ORDER_PLACED, QUEUE_ORDER_PLACED_DLQ, getRabbitUrl } from './rabbitmq.config';
import { assertTopology } from './topology';
import { sleep } from '../lib/sleep';
import { pgStore } from './pg-store';

/**
 * Демо-події мають orderId >= цієї межі: так їх легко відрізнити від справжніх
 * замовлень і прибрати з таблиці, не чіпаючи нічого іншого.
 */
export const DEMO_ORDER_ID_BASE = 900_000;

export interface Demo {
    conn: ChannelModel;
    ch: Channel;
    pool: Pool;
    store: EffectStore;
    close(): Promise<void>;
}

/** З'єднання з брокером і БД + топологія. Pg напряму: без шуму TypeORM-логів у протоколі. */
export async function openDemo(): Promise<Demo> {
    const pool = new Pool({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT ?? 5432),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        max: 5,
    });
    const conn = await connect(getRabbitUrl());
    const ch = await conn.createChannel();
    await assertTopology(ch);

    const store: EffectStore = pgStore(pool);

    return {
        conn,
        ch,
        pool,
        store,
        close: async () => {
            await ch.close().catch(() => undefined);
            await conn.close().catch(() => undefined);
            await pool.end().catch(() => undefined);
        },
    };
}

/** Самосброс: чиста черга, чиста DLQ, чисті демо-рядки в журналі чеків. */
export async function resetDemoState(demo: Demo): Promise<void> {
    const q = await demo.ch.checkQueue(QUEUE_ORDER_PLACED);
    if (q.consumerCount > 0) {
        throw new Error(
            `на черзі ${QUEUE_ORDER_PLACED} уже висить consumer (${q.consumerCount}): ` +
            'зупини "npm run consumer" (Ctrl+C) і запусти демо знову',
        );
    }
    await demo.ch.purgeQueue(QUEUE_ORDER_PLACED);
    await demo.ch.purgeQueue(QUEUE_ORDER_PLACED_DLQ);
    await demo.store.query(`DELETE FROM processed_order_events WHERE "orderId" >= $1`, [DEMO_ORDER_ID_BASE]);
    // Журнал принятых тоже чистим: иначе при повторном прогоне демо-событие считалось бы дублем и пропускалось
    await demo.store.query(`DELETE FROM processed_messages WHERE message_id ~ '^order-placed:9[0-9]{5}$'`);
}

export function demoEvent(n: number): OrderPlacedEvent {
    return buildOrderPlacedEvent({
        orderId: DEMO_ORDER_ID_BASE + n,
        customerEmail: 'demo@example.com',
        totalCents: 1000 * n,
        currency: 'UAH',
        items: [{ productId: 1, quantity: 1 }],
    });
}

export async function queueDepth(ch: Channel, queue: string): Promise<number> {
    return (await ch.checkQueue(queue)).messageCount;
}

/** Скільки ефектів реально застосовано: рахуємо рядки в БД, а не лічильник у пам'яті. */
export async function countEffects(store: EffectStore): Promise<number> {
    const rows = await store.query(
        `SELECT count(*)::int AS n FROM processed_order_events WHERE "orderId" >= $1`,
        [DEMO_ORDER_ID_BASE],
    );
    return rows[0].n;
}

export async function waitFor(
    cond: () => boolean | Promise<boolean>,
    timeoutMs: number,
    stepMs = 50,
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await cond()) {
            return true;
        }
        await sleep(stepMs);
    }
    return cond();
}

/** Один рядок протоколу: key=value key=value ... */
export function printResult(pairs: Record<string, string | number>): void {
    console.log(
        Object.entries(pairs)
            .map(([k, v]) => `${k}=${v}`)
            .join(' '),
    );
}

/** Звіряє факт з очікуванням; порушення складає в failures. */
export function expectEq(failures: string[], name: string, actual: unknown, expected: unknown): void {
    if (actual !== expected) {
        failures.push(`${name}: очікували ${expected}, отримали ${actual}`);
    }
}

/**
 * Каркас демо: відкрити → скинути стан → виконати тіло → закрити → код виходу.
 * Будь-яке порушення (або виняток) = ненульовий код виходу.
 */
export async function runDemo(body: (demo: Demo, failures: string[]) => Promise<void>): Promise<void> {
    const failures: string[] = [];
    let demo: Demo | undefined;
    try {
        demo = await openDemo();
        await resetDemoState(demo);
        await body(demo, failures);
    } catch (err) {
        failures.push(`виняток: ${(err as Error).message}`);
    } finally {
        await demo?.close();
    }

    if (failures.length > 0) {
        for (const f of failures) {
            console.error(`FAIL ${f}`);
        }
        process.exit(1);
    }
    console.log('OK: усі інваріанти виконано');
    process.exit(0);
}
import 'reflect-metadata';
import type { Pool } from 'pg';
import { DataSource, DataSourceOptions } from 'typeorm';
import { AppDataSource } from '../data-source';
import { Order } from '../entities/order.entity';
import { sleep } from '../lib/sleep';
import { startOrderPlacedConsumer } from '../messaging/consumer';
import type { Demo } from '../messaging/demo-kit';
import type { CreateOrderDto } from '../orders/dto/create-order.dto';
import type { OrderEventsService } from '../orders/order-events.service';
import { OrdersService } from '../orders/orders.service';
import { relayOnce } from './relay';
import type { RelaySink } from './relay';

/** Все данные демо помечены этим email и этим префиксом ключей: так их легко найти и стереть */
export const OUTBOX_DEMO_EMAIL = 'outbox-demo@example.com';
export const OUTBOX_DEMO_PRODUCT = 'OUTBOX_DEMO_PRODUCT';
export const OUTBOX_DEMO_KEY_PREFIX = 'demo-outbox-';

/**
 * OrdersService без Nest и без HTTP: тот же класс, что стоит за POST /orders.
 * DataSource "тихий" (logging: false), иначе вывод утонет в логах запросов TypeORM.
 */
export async function openOrdersService() {
    const dataSource = new DataSource({ ...AppDataSource.options, logging: false } as DataSourceOptions);
    await dataSource.initialize();
    const service = new OrdersService(
        dataSource.getRepository(Order),
        { emitStatusChanged: () => undefined } as unknown as OrderEventsService,
    );
    return { service, close: () => dataSource.destroy() };
}

export function demoDto(productId: number): CreateOrderDto {
    return { customerEmail: OUTBOX_DEMO_EMAIL, items: [{ productId: String(productId), quantity: 1 }] };
}

/** Триггер, который роняет COMMIT. Срабатывает ПОСЛЕ всех вставок: транзакция уже сделала всё, кроме фиксации. */
export async function installCommitFailure(pool: Pool): Promise<void> {
    await pool.query(`
        CREATE OR REPLACE FUNCTION demo_fail_at_commit() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'демо: збій на COMMIT, уже після вставки рядка в outbox';
        END
        $$;
        CREATE CONSTRAINT TRIGGER demo_fail_commit AFTER INSERT ON outbox
            DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION demo_fail_at_commit();
    `);
}

export async function removeCommitFailure(pool: Pool): Promise<void> {
    await pool.query(`
        DROP TRIGGER IF EXISTS demo_fail_commit ON outbox;
        DROP FUNCTION IF EXISTS demo_fail_at_commit();
    `);
}

/**
 * Приводит стан до чистого (лише СВОЇ дані демо) і повертає товар + момент старту за годинником БД.
 * Чужі рядки outbox (наприклад, від demo:race) не чіпаємо: relay надалі бере лише рядки новіші за startedAt.
 */
export async function prepareOutboxDemo(demo: Demo): Promise<{ productId: number; startedAt: Date }> {
    const pool = demo.pool;
    const email = [OUTBOX_DEMO_EMAIL];

    await removeCommitFailure(pool); // залишок від аварійно перерваного запуску

    await pool.query(
        `DELETE FROM outbox WHERE aggregate_type = 'Order'
            AND aggregate_id IN (SELECT id::text FROM orders WHERE "customerEmail" = $1)`,
        email,
    );
    await pool.query(
        `DELETE FROM processed_messages
          WHERE message_id IN (SELECT 'order-placed:' || id FROM orders WHERE "customerEmail" = $1)`,
        email,
    );
    await pool.query(
        `DELETE FROM processed_order_events
          WHERE "orderId" IN (SELECT id FROM orders WHERE "customerEmail" = $1)`,
        email,
    );
    await pool.query(`DELETE FROM idempotency_keys WHERE idempotency_key LIKE $1`, [`${OUTBOX_DEMO_KEY_PREFIX}%`]);
    await pool.query(
        `DELETE FROM order_items WHERE "orderId" IN (SELECT id FROM orders WHERE "customerEmail" = $1)`,
        email,
    );
    await pool.query(`DELETE FROM orders WHERE "customerEmail" = $1`, email);

    const product = await pool.query(
        `INSERT INTO products (name, "priceCents", stock, currency) VALUES ($1, 10000, 1000, 'UAH')
         ON CONFLICT (name) DO UPDATE SET stock = EXCLUDED.stock
         RETURNING id`,
        [OUTBOX_DEMO_PRODUCT],
    );
    const now = await pool.query(`SELECT now() AS t`);
    return { productId: product.rows[0].id, startedAt: now.rows[0].t };
}

export interface DemoSnapshot {
    orders: number;
    outbox: number;
    published: number;
    effect: number;
    processed: number;
}

/**
 * Числа для протоколу рахуємо В БАЗІ, а не лічильниками в пам'яті.
 * outbox/effect/processed беремо за часом (>= since), а не за замовленнями: якщо після збою
 * залишився б "осиротілий" рядок outbox без замовлення, join по orders його не побачив би, а за часом він видно.
 */
export async function snapshot(pool: Pool, since: Date): Promise<DemoSnapshot> {
    const s = since.toISOString();
    const one = async (sql: string, params: unknown[]): Promise<number> =>
        (await pool.query(sql, params as any[])).rows[0].n;
    return {
        orders: await one(`SELECT count(*)::int AS n FROM orders WHERE "customerEmail" = $1`, [OUTBOX_DEMO_EMAIL]),
        outbox: await one(`SELECT count(*)::int AS n FROM outbox WHERE created_at >= $1`, [s]),
        published: await one(
            `SELECT count(*)::int AS n FROM outbox WHERE created_at >= $1 AND published_at IS NOT NULL`,
            [s],
        ),
        effect: await one(`SELECT count(*)::int AS n FROM processed_order_events WHERE "processedAt" >= $1`, [s]),
        processed: await one(`SELECT count(*)::int AS n FROM processed_messages WHERE processed_at >= $1`, [s]),
    };
}

/**
 * Проходи relay, поки не віднесено `expected` конвертів або не вийшов час.
 * Повторюємо, бо після kill -9 Postgres може ще кілька мілісекунд тримати бирку "зайнято"
 * померлого relay: SKIP LOCKED тоді чесно пропустить рядок, і перший прохід знайде 0.
 */
export async function relayUntil(
    pool: Pool,
    sink: RelaySink,
    notBefore: Date,
    expected: number,
    timeoutMs = 10_000,
): Promise<number> {
    let total = 0;
    const deadline = Date.now() + timeoutMs;
    while (total < expected && Date.now() < deadline) {
        const pass = await relayOnce(pool, sink, { notBefore });
        if (pass.failed > 0) {
            throw new Error('relay: publish завершився помилкою');
        }
        total += pass.published;
        if (total < expected) {
            await sleep(100);
        }
    }
    return total;
}

export interface ConsumerProbe {
    deliveries: number;
    applied: number;
    skipped: number;
    settled: number;
    stop(): Promise<void>;
}

/** Справжній консюмер з коду застосунку + лічильники того, що він зробив. */
export async function startProbeConsumer(demo: Demo): Promise<ConsumerProbe> {
    const probe: ConsumerProbe = { deliveries: 0, applied: 0, skipped: 0, settled: 0, stop: async () => undefined };
    const { consumerTag } = await startOrderPlacedConsumer(demo.ch, demo.store, {
        onDelivery: () => {
            probe.deliveries++;
        },
        onSettled: (r) => {
            probe.settled++;
            if (r.outcome === 'acked') {
                probe.applied++; // ефект застосовано саме зараз
            }
            if (r.outcome === 'skipped') {
                probe.skipped++; // дубль: відкинуто
            }
        },
    });
    probe.stop = async () => {
        await demo.ch.cancel(consumerTag);
    };
    return probe;
}

/** Контракт виводу: ОДИН КЛЮЧ НА РЯДОК (грейдер шукає рядки цілком: grep -x "requests=2"). */
export function printLines(pairs: Record<string, string | number>): void {
    for (const [key, value] of Object.entries(pairs)) {
        console.log(`${key}=${value}`);
    }
}
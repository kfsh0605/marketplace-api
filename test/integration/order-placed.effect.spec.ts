import { Pool } from 'pg';
import { DataSource } from 'typeorm';
import { PgHandle, startPg } from './testkit/pg-container';
import { resetDatabase } from './testkit/reset-database';
import { insertProduct, insertUser } from './testkit/builders';
import { checkout } from '../../src/checkout';
import { Order } from '../../src/entities/order.entity';
import { applyOrderPlacedEffect } from '../../src/messaging/consumer';
import { buildOrderPlacedEvent } from '../../src/messaging/events';
import { pgStore } from '../../src/messaging/pg-store';

describe('ефект order.placed: фонова частина змінює статус замовлення (Postgres, testcontainers)', () => {
    let pg: PgHandle;
    let dataSource: DataSource;
    let pool: Pool;

    const eventFor = (orderId: number) =>
        buildOrderPlacedEvent({ orderId, customerEmail: 'buyer@example.com', totalCents: 0, currency: 'UAH', items: [] });

    async function insertOrder(status: string): Promise<number> {
        const user = await insertUser(dataSource);
        const repo = dataSource.getRepository(Order);
        const saved = await repo.save(
            repo.create({ user, customerEmail: user.email, status, totalCents: 0, currency: 'UAH' }),
        );
        return saved.id;
    }

    async function statusOf(orderId: number): Promise<string> {
        const rows = await dataSource.query('SELECT status FROM orders WHERE id = $1', [orderId]);
        return rows[0].status;
    }

    beforeAll(async () => {
        pg = await startPg('order-placed-effect');
        dataSource = pg.dataSource;
        pool = new Pool({ connectionString: pg.container.getConnectionUri() });
    }, 60_000);

    afterEach(async () => {
        await resetDatabase(dataSource);
        await dataSource.query('TRUNCATE TABLE processed_messages, processed_order_events');
    });

    afterAll(async () => {
        await pool.end();
        await pg.stop();
    });

    it('created -> pending: результат фонової обробки читається з таблиці orders', async () => {
        const orderId = await insertOrder('created');

        const applied = await applyOrderPlacedEffect(pgStore(pool), eventFor(orderId));

        expect(applied).toBe(true);
        expect(await statusOf(orderId)).toBe('pending');
    });

    it('дубль повідомлення: ефект не повторюється і статус, що пішов далі, не відкочується', async () => {
        const orderId = await insertOrder('created');
        const store = pgStore(pool);
        await applyOrderPlacedEffect(store, eventFor(orderId));
        await dataSource.query(`UPDATE orders SET status = 'paid' WHERE id = $1`, [orderId]);

        const again = await applyOrderPlacedEffect(store, eventFor(orderId));

        expect(again).toBe(false);
        expect(await statusOf(orderId)).toBe('paid');
    });

    it('замовлення з checkout() вже paid: подію записано, статус не чіпаємо', async () => {
        const user = await insertUser(dataSource, { balanceCents: 100_000 });
        const product = await insertProduct(dataSource, { priceCents: 5000, stock: 10 });
        const { orderId } = await checkout(user.id, product.id, 1, { dataSource });

        const applied = await applyOrderPlacedEffect(pgStore(pool), eventFor(orderId));

        expect(applied).toBe(true);
        expect(await statusOf(orderId)).toBe('paid');
    });

    it('подія про замовлення, якого немає: ефект застосовано, жодного рядка не змінено і помилки немає', async () => {
        const applied = await applyOrderPlacedEffect(pgStore(pool), eventFor(999_999));

        expect(applied).toBe(true);
    });
});

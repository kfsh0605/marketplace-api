import { DataSource } from 'typeorm';
import { PgHandle, startPg } from './testkit/pg-container';
import { resetDatabase } from './testkit/reset-database';
import { insertProduct, insertUser } from './testkit/builders';
import { checkout, InsufficientStockError } from '../../src/checkout';
import { Order } from '../../src/entities/order.entity';
import { Product } from '../../src/entities/product.entity';
import { User } from '../../src/entities/user.entity';
import type { OrderEventsService } from '../../src/orders/order-events.service';
import { OrdersService } from '../../src/orders/orders.service';

interface OutboxRow {
    aggregate_type: string;
    aggregate_id: string;
    type: string;
    payload: any;
    published_at: Date | null;
}

async function outboxRows(dataSource: DataSource): Promise<OutboxRow[]> {
    return dataSource.query(
        'SELECT aggregate_type, aggregate_id, type, payload, published_at FROM outbox ORDER BY created_at, id',
    );
}

describe('outbox: заказ і подія фіксуються одним COMMIT (Postgres, testcontainers)', () => {
    let pg: PgHandle;
    let dataSource: DataSource;

    beforeAll(async () => {
        pg = await startPg('outbox');
        dataSource = pg.dataSource;
    }, 60_000);

    afterEach(async () => {
        await resetDatabase(dataSource);
    });

    afterAll(async () => {
        await pg.stop();
    });

    it('checkout() пише замовлення і рядок outbox разом; published_at порожній', async () => {
        const user = await insertUser(dataSource, { balanceCents: 100_000 });
        const product = await insertProduct(dataSource, { priceCents: 5000, stock: 10 });

        const { orderId } = await checkout(user.id, product.id, 2, { dataSource });

        const rows = await outboxRows(dataSource);
        expect(rows).toHaveLength(1);
        expect(rows[0].aggregate_type).toBe('Order');
        expect(rows[0].aggregate_id).toBe(String(orderId));
        expect(rows[0].type).toBe('order.placed');
        expect(rows[0].published_at).toBeNull(); // "ще не віднесли": це робота relay
        expect(rows[0].payload).toMatchObject({
            eventId: `order-placed:${orderId}`,
            type: 'order.placed',
            data: {
                orderId,
                customerEmail: user.email,
                totalCents: 10_000,
                currency: 'UAH',
                items: [{ productId: product.id, quantity: 2 }],
            },
        });
    });

    it('відмова checkout (мало товару) не залишає ні замовлення, ні події', async () => {
        const user = await insertUser(dataSource);
        const product = await insertProduct(dataSource, { stock: 1 });

        await expect(checkout(user.id, product.id, 5, { dataSource })).rejects.toBeInstanceOf(
            InsufficientStockError,
        );

        expect(await dataSource.getRepository(Order).count()).toBe(0);
        expect(await outboxRows(dataSource)).toHaveLength(0);
    });

    it('якщо запис у outbox не вдався, відкочується ВСЕ: замовлення, склад і баланс', async () => {
        const user = await insertUser(dataSource, { balanceCents: 100_000 });
        const product = await insertProduct(dataSource, { priceCents: 5000, stock: 10 });

        // Ламаємо саме запис у outbox: NOT VALID перевіряє нові INSERT-и, старі рядки не чіпає
        await dataSource.query('ALTER TABLE outbox ADD CONSTRAINT outbox_always_fails CHECK (false) NOT VALID');
        try {
            await expect(checkout(user.id, product.id, 2, { dataSource })).rejects.toThrow();
        } finally {
            await dataSource.query('ALTER TABLE outbox DROP CONSTRAINT outbox_always_fails');
        }

        expect(await dataSource.getRepository(Order).count()).toBe(0);
        expect((await dataSource.getRepository(Product).findOneByOrFail({ id: product.id })).stock).toBe(10);
        expect((await dataSource.getRepository(User).findOneByOrFail({ id: user.id })).balanceCents).toBe(100_000);
        expect(await outboxRows(dataSource)).toHaveLength(0);
    });

    it('POST /orders (OrdersService.create) теж кладе подію в outbox, того ж контракту', async () => {
        const user = await insertUser(dataSource, { balanceCents: 100_000 });
        const product = await insertProduct(dataSource, { priceCents: 5000, stock: 10 });

        // шлях 1: OrdersService.create (його викликає POST /orders)
        const ordersService = new OrdersService(
            dataSource.getRepository(Order),
            { emitStatusChanged: jest.fn() } as unknown as OrderEventsService,
        );
        await ordersService.create({
            customerEmail: user.email,
            items: [{ productId: String(product.id), quantity: 2 }],
        });
        // шлях 2: checkout()
        await checkout(user.id, product.id, 2, { dataSource });

        const rows = await outboxRows(dataSource);
        expect(rows).toHaveLength(2);
        const [viaOrders, viaCheckout] = rows.map((r) => r.payload);
        expect(Object.keys(viaCheckout).sort()).toEqual(Object.keys(viaOrders).sort());
        expect(Object.keys(viaCheckout.data).sort()).toEqual(Object.keys(viaOrders.data).sort());
        expect(viaCheckout.data.items).toEqual(viaOrders.data.items);
        expect(viaCheckout.data.totalCents).toBe(viaOrders.data.totalCents);
        // різні замовлення мають різні eventId
        expect(viaCheckout.eventId).not.toBe(viaOrders.eventId);
    });
});
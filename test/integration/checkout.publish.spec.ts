import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PgHandle, startPg } from './testkit/pg-container';
import { resetDatabase } from './testkit/reset-database';
import { insertProduct, insertUser } from './testkit/builders';
import { checkout, InsufficientStockError } from '../../src/checkout';
import { Order } from '../../src/entities/order.entity';
import type { OrderPlacedEvent } from '../../src/messaging/events';
import type { OrderPlacedSink } from '../../src/messaging/publish-order-placed';
import type { EventPublisher } from '../../src/messaging/publisher';
import type { OrderEventsService } from '../../src/orders/order-events.service';
import { OrdersService } from '../../src/orders/orders.service';

interface FakeSinkOptions {
    mode?: 'ok' | 'fail' | 'disabled';
    /** Викликається в момент publish: тут видно, що вже зафіксовано в БД */
    onPublish?: (event: OrderPlacedEvent) => Promise<void>;
}

/** Продюсер без брокера: запам'ятовує події, які йому віддали. */
class FakeSink implements OrderPlacedSink {
    readonly published: OrderPlacedEvent[] = [];

    constructor(private readonly options: FakeSinkOptions = {}) {}

    isEnabled(): boolean {
        return this.options.mode !== 'disabled';
    }

    async publish(event: OrderPlacedEvent): Promise<void> {
        if (this.options.mode === 'fail') {
            throw new Error('брокер недоступний');
        }
        await this.options.onPublish?.(event);
        this.published.push(event);
    }
}

describe('order.placed з обох шляхів створення замовлення (Postgres, testcontainers)', () => {
    let pg: PgHandle;
    let dataSource: DataSource;

    beforeAll(async () => {
        pg = await startPg('order-placed');
        dataSource = pg.dataSource;
    }, 60_000);

    afterEach(async () => {
        jest.restoreAllMocks();
        await resetDatabase(dataSource);
    });

    afterAll(async () => {
        await pg.stop();
    });

    it('checkout() публікує order.placed після успішної оплати', async () => {
        const user = await insertUser(dataSource, { balanceCents: 100_000 });
        const product = await insertProduct(dataSource, { priceCents: 5000, stock: 10 });
        const sink = new FakeSink();

        const { orderId } = await checkout(user.id, product.id, 2, { publisher: sink, dataSource });

        expect(sink.published).toHaveLength(1);
        expect(sink.published[0]).toMatchObject({
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

    it('подію публікують ПІСЛЯ коміту: у момент publish замовлення вже видно з іншого з\'єднання', async () => {
        const user = await insertUser(dataSource);
        const product = await insertProduct(dataSource);
        let rowsVisibleAtPublish = -1;
        const sink = new FakeSink({
            onPublish: async (event) => {
                const rows: unknown[] = await dataSource.query('SELECT 1 FROM orders WHERE id = $1', [
                    event.data.orderId,
                ]);
                rowsVisibleAtPublish = rows.length;
            },
        });

        await checkout(user.id, product.id, 1, { publisher: sink, dataSource });

        expect(rowsVisibleAtPublish).toBe(1);
    });

    it('відмова checkout (мало товару) нічого не публікує', async () => {
        const user = await insertUser(dataSource);
        const product = await insertProduct(dataSource, { stock: 1 });
        const sink = new FakeSink();

        await expect(checkout(user.id, product.id, 5, { publisher: sink, dataSource })).rejects.toBeInstanceOf(
            InsufficientStockError,
        );

        expect(sink.published).toHaveLength(0);
    });

    it('збій брокера не ламає checkout: замовлення збережене, втрата події залогована', async () => {
        const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
        const user = await insertUser(dataSource);
        const product = await insertProduct(dataSource);

        const { orderId } = await checkout(user.id, product.id, 1, {
            publisher: new FakeSink({ mode: 'fail' }),
            dataSource,
        });

        expect(await dataSource.getRepository(Order).countBy({ id: orderId })).toBe(1);
        expect(errorLog).toHaveBeenCalledWith(expect.stringContaining(`order-placed:${orderId}`));
    });

    it('брокер вимкнено (isEnabled=false, як у CI) або publisher=null: checkout працює, подій немає', async () => {
        const user = await insertUser(dataSource);
        const product = await insertProduct(dataSource);
        const disabled = new FakeSink({ mode: 'disabled' });

        await checkout(user.id, product.id, 1, { publisher: disabled, dataSource });
        const { orderId } = await checkout(user.id, product.id, 1, { publisher: null, dataSource });

        expect(disabled.published).toHaveLength(0);
        expect(await dataSource.getRepository(Order).countBy({ id: orderId })).toBe(1);
    });

    it('POST /orders і checkout() видають подію одного контракту', async () => {
        const user = await insertUser(dataSource, { balanceCents: 100_000 });
        const product = await insertProduct(dataSource, { priceCents: 5000, stock: 10 });
        const sink = new FakeSink();

        // шлях 1: OrdersService.create (його викликає POST /orders)
        const ordersService = new OrdersService(
            dataSource.getRepository(Order),
            { emitStatusChanged: jest.fn() } as unknown as OrderEventsService,
            sink as unknown as EventPublisher,
        );
        await ordersService.create({
            customerEmail: user.email,
            items: [{ productId: String(product.id), quantity: 2 }],
        });
        // шлях 2: checkout()
        await checkout(user.id, product.id, 2, { publisher: sink, dataSource });

        expect(sink.published).toHaveLength(2);
        const [viaOrders, viaCheckout] = sink.published;
        expect(Object.keys(viaCheckout).sort()).toEqual(Object.keys(viaOrders).sort());
        expect(Object.keys(viaCheckout.data).sort()).toEqual(Object.keys(viaOrders.data).sort());
        expect(viaCheckout.type).toBe(viaOrders.type);
        expect(viaCheckout.data.items).toEqual(viaOrders.data.items);
        expect(viaCheckout.data.totalCents).toBe(viaOrders.data.totalCents);
        expect(viaCheckout.data.currency).toBe(viaOrders.data.currency);
        // різні замовлення мають різні eventId: споживач не вважатиме одну подію дублем іншої
        expect(viaCheckout.eventId).not.toBe(viaOrders.eventId);
    });
});

import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PgHandle, startPg } from './testkit/pg-container';
import { resetDatabase } from './testkit/reset-database';
import { insertProduct } from './testkit/builders';
import { Order } from '../../src/entities/order.entity';
import type { OrderEventsService } from '../../src/orders/order-events.service';
import { OrdersService } from '../../src/orders/orders.service';

describe('Idempotency-Key на краю API (Postgres, testcontainers)', () => {
    let pg: PgHandle;
    let dataSource: DataSource;
    let service: OrdersService;

    const count = async (table: string): Promise<number> =>
        (await dataSource.query(`SELECT count(*)::int AS n FROM ${table}`))[0].n;

    const dtoFor = (productId: number, quantity = 2) => ({
        customerEmail: 'ada@example.com',
        items: [{ productId: String(productId), quantity }],
    });

    beforeAll(async () => {
        pg = await startPg('idempotency');
        dataSource = pg.dataSource;
        service = new OrdersService(
            dataSource.getRepository(Order),
            { emitStatusChanged: jest.fn() } as unknown as OrderEventsService,
        );
    }, 60_000);

    afterEach(async () => {
        await resetDatabase(dataSource);
    });

    afterAll(async () => {
        await pg.stop();
    });

    it('два запроса подряд с одним ключом: одно замовлення, одна подія, вторая ответ помечен как повтор', async () => {
        const product = await insertProduct(dataSource);

        const first = await service.createIdempotent(dtoFor(product.id), 'key-1');
        const second = await service.createIdempotent(dtoFor(product.id), 'key-1');

        expect(first.replayed).toBe(false);
        expect(second.replayed).toBe(true);
        expect(second.order).toEqual(first.order);
        expect(await count('orders')).toBe(1);
        expect(await count('outbox')).toBe(1);
    });

    it('два ОДНОВРЕМЕННЫХ запроса с одним ключом: тоже одно замовлення (уникальный индекс ставит их в очередь)', async () => {
        const product = await insertProduct(dataSource);

        const [a, b] = await Promise.all([
            service.createIdempotent(dtoFor(product.id), 'key-race'),
            service.createIdempotent(dtoFor(product.id), 'key-race'),
        ]);

        expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
        expect(a.order.id).toBe(b.order.id);
        expect(await count('orders')).toBe(1);
        expect(await count('outbox')).toBe(1);
    });

    it('тот же ключ, но другое тело: 422, нового замовлення нет', async () => {
        const product = await insertProduct(dataSource);
        await service.createIdempotent(dtoFor(product.id, 2), 'key-reuse');

        await expect(service.createIdempotent(dtoFor(product.id, 5), 'key-reuse')).rejects.toBeInstanceOf(
            UnprocessableEntityException,
        );

        expect(await count('orders')).toBe(1);
    });

    it('два РАЗНЫХ ключа с одинаковым телом: два замовлення (ключ = намерение, а не хеш тела)', async () => {
        const product = await insertProduct(dataSource);

        const a = await service.createIdempotent(dtoFor(product.id), 'key-a');
        const b = await service.createIdempotent(dtoFor(product.id), 'key-b');

        expect(a.order.id).not.toBe(b.order.id);
        expect(await count('orders')).toBe(2);
        expect(await count('outbox')).toBe(2);
    });

    it('сбой посередине откатывает и ключ: повтор с исправленным запросом проходит', async () => {
        const product = await insertProduct(dataSource);

        await expect(service.createIdempotent(dtoFor(999_999), 'key-retry')).rejects.toBeInstanceOf(
            BadRequestException,
        );
        expect(await count('idempotency_keys')).toBe(0); // номерок не остался занятым

        const ok = await service.createIdempotent(dtoFor(product.id), 'key-retry');
        expect(ok.replayed).toBe(false);
        expect(await count('orders')).toBe(1);
    });
});
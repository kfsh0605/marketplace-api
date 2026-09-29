import { DataSource } from 'typeorm';
import { PgHandle, startPg } from './testkit/pg-container';
import { resetDatabase } from './testkit/reset-database';
import { insertProduct, insertUser } from './testkit/builders';
import { Order } from '../../src/entities/order.entity';
import { OrderItem } from '../../src/entities/order-item.entity';

describe('OrdersRepository / OrderItem (Postgres, testcontainers)', () => {
    let pg: PgHandle;
    let dataSource: DataSource;

    beforeAll(async () => {
        pg = await startPg('orders');
        dataSource = pg.dataSource;
    }, 60_000);

    afterEach(async () => {
        await resetDatabase(dataSource);
    });

    afterAll(async () => {
        await pg.stop();
    });

    it('зберігає замовлення разом з позиціями каскадно (cascade: true)', async () => {
        const user = await insertUser(dataSource);
        const product = await insertProduct(dataSource, { priceCents: 5000 });

        const orderRepo = dataSource.getRepository(Order);
        const order = await orderRepo.save(
            orderRepo.create({
                user,
                customerEmail: user.email,
                status: 'created',
                totalCents: 10000,
                currency: 'UAH',
                items: [{ product, quantity: 2, priceAtPurchaseCents: 5000 } as OrderItem],
            }),
        );

        const itemsCount = await dataSource.getRepository(OrderItem).countBy({ order: { id: order.id } });
        expect(itemsCount).toBe(1);
    });

    it('читає замовлення разом з позиціями і товарами через JOIN', async () => {
        const user = await insertUser(dataSource);
        const productA = await insertProduct(dataSource, { name: 'A', priceCents: 1000 });
        const productB = await insertProduct(dataSource, { name: 'B', priceCents: 2000 });

        const orderRepo = dataSource.getRepository(Order);
        const saved = await orderRepo.save(
            orderRepo.create({
                user,
                customerEmail: user.email,
                status: 'created',
                totalCents: 1000 + 2000 * 2,
                currency: 'UAH',
                items: [
                    { product: productA, quantity: 1, priceAtPurchaseCents: 1000 } as OrderItem,
                    { product: productB, quantity: 2, priceAtPurchaseCents: 2000 } as OrderItem,
                ],
            }),
        );

        const found = await orderRepo.findOne({ where: { id: saved.id }, relations: ['items', 'items.product'] });

        expect(found?.items).toHaveLength(2);
        expect(found?.items.map((i) => i.product.name).sort()).toEqual(['A', 'B']);
    });

    it('не дає створити order_item з неіснуючим productId (FK constraint)', async () => {
        const user = await insertUser(dataSource);
        const orderRepo = dataSource.getRepository(Order);
        const order = await orderRepo.save(
            orderRepo.create({ user, customerEmail: user.email, status: 'created', totalCents: 0, currency: 'UAH' }),
        );

        const itemRepo = dataSource.getRepository(OrderItem);
        await expect(
            itemRepo.save(
                itemRepo.create({ order, product: { id: 999999 } as any, quantity: 1, priceAtPurchaseCents: 100 }),
            ),
        ).rejects.toThrow(/violates foreign key constraint/);
    });
});
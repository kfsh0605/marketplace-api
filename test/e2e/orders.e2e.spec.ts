import request from 'supertest';
import { E2eApp, bootstrapE2eApp } from './testkit/bootstrap-app';
import { Product } from '../../src/entities/product.entity';

describe('Orders E2E (повний Nest-застосунок, Postgres через testcontainer)', () => {
    let e2e: E2eApp;

    beforeAll(async () => {
        e2e = await bootstrapE2eApp();
    }, 60_000);

    afterAll(async () => {
        await e2e.close();
    });

    afterEach(async () => {
        await e2e.dataSource.query(
            'TRUNCATE TABLE idempotency_keys, outbox, post_processing_jobs, order_items, orders, products, users RESTART IDENTITY CASCADE',        );
    });

    it('POST /orders -> 201, GET /orders/:id -> 200 з тим самим тілом', async () => {
        const productRepo = e2e.dataSource.getRepository(Product);
        const product = await productRepo.save(
            productRepo.create({ name: 'E2E товар', priceCents: 1000, stock: 5, currency: 'UAH' }),
        );

        const created = await request(e2e.app.getHttpServer())
            .post('/orders')
            .set('Idempotency-Key', 'e2e-key-1')
            .send({ customerEmail: 'ada@example.com', items: [{ productId: String(product.id), quantity: 2 }] })
            .expect(201);

        const fetched = await request(e2e.app.getHttpServer())
            .get(`/orders/${created.body.id}`)
            .expect(200);

        expect(fetched.body).toEqual(created.body);
        expect(fetched.body.totalCents).toBe(2000);
    });

    it('GET /orders/:id для неіснуючого замовлення -> 404', async () => {
        await request(e2e.app.getHttpServer()).get('/orders/999999').expect(404);
    });

    it('повторный POST с тем же Idempotency-Key: то же замовлення, заголовок Idempotency-Replay', async () => {
        const productRepo = e2e.dataSource.getRepository(Product);
        const product = await productRepo.save(
            productRepo.create({ name: 'E2E товар 2', priceCents: 1000, stock: 5, currency: 'UAH' }),
        );
        const body = { customerEmail: 'ada@example.com', items: [{ productId: String(product.id), quantity: 1 }] };

        const first = await request(e2e.app.getHttpServer())
            .post('/orders').set('Idempotency-Key', 'e2e-key-2').send(body).expect(201);
        const second = await request(e2e.app.getHttpServer())
            .post('/orders').set('Idempotency-Key', 'e2e-key-2').send(body).expect(201);

        expect(second.body).toEqual(first.body);
        expect(first.headers['idempotency-replay']).toBeUndefined();
        expect(second.headers['idempotency-replay']).toBe('true');
        const [{ n }] = await e2e.dataSource.query('SELECT count(*)::int AS n FROM orders');
        expect(n).toBe(1);
    });

    it('POST /orders без Idempotency-Key: 400', async () => {
        await request(e2e.app.getHttpServer())
            .post('/orders')
            .send({ customerEmail: 'ada@example.com', items: [{ productId: '1', quantity: 1 }] })
            .expect(400);
    });
});
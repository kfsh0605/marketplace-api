import request from 'supertest';
import { Order } from '../../src/entities/order.entity';
import { Product } from '../../src/entities/product.entity';
import { User } from '../../src/entities/user.entity';
import { bearer, createUser, loginAs } from './testkit/auth-helpers';
import { E2eApp, bootstrapE2eApp } from './testkit/bootstrap-app';

describe('Orders E2E: владіння замовленням (403 на чужий) і ізоляція даних', () => {
    let e2e: E2eApp;
    let productId: string;
    let ownerId: number;
    let ownerToken: string;
    let strangerToken: string;
    let sellerToken: string;
    let adminToken: string;

    const http = () => request(e2e.app.getHttpServer());

    const orderBody = () => ({
        customerEmail: 'ada@example.com',
        items: [{ productId, quantity: 1 }],
    });

    async function placeOrder(token: string, key: string): Promise<string> {
        const res = await http()
            .post('/orders')
            .set(bearer(token))
            .set('Idempotency-Key', key)
            .send(orderBody())
            .expect(201);
        return res.body.id as string;
    }

    beforeAll(async () => {
        e2e = await bootstrapE2eApp();
    }, 120_000);

    afterAll(async () => {
        await e2e.close();
    });

    beforeEach(async () => {
        const products = e2e.dataSource.getRepository(Product);
        const product = await products.save(
            products.create({ name: 'Ownership товар', priceCents: 1000, stock: 100, currency: 'UAH' }),
        );
        productId = String(product.id);

        const owner = await createUser(e2e, 'owner@example.com', 'customer');
        ownerId = owner.id;
        await createUser(e2e, 'stranger@example.com', 'customer');
        await createUser(e2e, 'seller@example.com', 'seller');
        await createUser(e2e, 'admin@example.com', 'admin');
        ownerToken = await loginAs(e2e, 'owner@example.com');
        strangerToken = await loginAs(e2e, 'stranger@example.com');
        sellerToken = await loginAs(e2e, 'seller@example.com');
        adminToken = await loginAs(e2e, 'admin@example.com');
    });

    afterEach(async () => {
        await e2e.dataSource.query(
            'TRUNCATE TABLE refresh_tokens, idempotency_keys, outbox, post_processing_jobs, order_items, orders, products, users RESTART IDENTITY CASCADE',
        );
    });

    it('POST /orders прив\'язує замовлення до користувача з токена, а не з тіла запиту', async () => {
        const orderId = await placeOrder(ownerToken, 'own-1');

        const saved = await e2e.dataSource
            .getRepository(Order)
            .findOneOrFail({ where: { id: Number(orderId) }, relations: ['user'] });
        expect(saved.user.id).toBe(ownerId);
    });

    it('власник бачить своє замовлення: 200', async () => {
        const orderId = await placeOrder(ownerToken, 'own-2');

        const res = await http().get(`/orders/${orderId}`).set(bearer(ownerToken)).expect(200);

        expect(res.body.id).toBe(orderId);
    });

    it('чужий customer: 403 problem+json, без WWW-Authenticate (це не 401)', async () => {
        const orderId = await placeOrder(ownerToken, 'own-3');

        const res = await http().get(`/orders/${orderId}`).set(bearer(strangerToken)).expect(403);

        expect(res.headers['content-type']).toContain('application/problem+json');
        expect(res.body.title).toBe('Forbidden');
        expect(res.headers['www-authenticate']).toBeUndefined();
    });

    it('seller не отримує чужі замовлення лише через роль: 403', async () => {
        const orderId = await placeOrder(ownerToken, 'own-4');

        await http().get(`/orders/${orderId}`).set(bearer(sellerToken)).expect(403);
    });

    it('admin бачить чужі замовлення: 200', async () => {
        const orderId = await placeOrder(ownerToken, 'own-5');

        await http().get(`/orders/${orderId}`).set(bearer(adminToken)).expect(200);
    });

    it('неіснуюче замовлення -> 404 (не 403)', async () => {
        await http().get('/orders/999999').set(bearer(strangerToken)).expect(404);
        await http().get('/orders/abc').set(bearer(strangerToken)).expect(404);
    });

    it('понижений admin втрачає доступ до чужого одразу, хоча його токен ще дійсний', async () => {
        const orderId = await placeOrder(ownerToken, 'own-6');
        await http().get(`/orders/${orderId}`).set(bearer(adminToken)).expect(200);

        await e2e.dataSource.getRepository(User).update({ email: 'admin@example.com' }, { role: 'customer' });

        await http().get(`/orders/${orderId}`).set(bearer(adminToken)).expect(403);
    });

    it('GET /orders: customer бачить лише свої, admin бачить усі', async () => {
        await placeOrder(ownerToken, 'list-a1');
        await placeOrder(ownerToken, 'list-a2');
        await placeOrder(strangerToken, 'list-b1');

        const mine = await http().get('/orders').set(bearer(ownerToken)).expect(200);
        const theirs = await http().get('/orders').set(bearer(strangerToken)).expect(200);
        const all = await http().get('/orders').set(bearer(adminToken)).expect(200);

        expect(mine.body.items).toHaveLength(2);
        expect(theirs.body.items).toHaveLength(1);
        expect(all.body.items).toHaveLength(3);
    });

    it('Idempotency-Key належить користувачеві: чужий не отримує чуже замовлення через той самий ключ', async () => {
        const first = await placeOrder(ownerToken, 'shared-key');
        const second = await placeOrder(strangerToken, 'shared-key');
        const replay = await http()
            .post('/orders')
            .set(bearer(ownerToken))
            .set('Idempotency-Key', 'shared-key')
            .send(orderBody())
            .expect(201);

        expect(second).not.toBe(first);
        expect(replay.body.id).toBe(first);
        expect(replay.headers['idempotency-replay']).toBe('true');
        const [{ n }] = await e2e.dataSource.query('SELECT count(*)::int AS n FROM orders');
        expect(n).toBe(2);
    });

    it('PATCH /orders/:id/status: customer -> 403 за роллю, seller -> 200', async () => {
        const orderId = await placeOrder(ownerToken, 'status-1');

        await http().patch(`/orders/${orderId}/status`).set(bearer(ownerToken)).send({ status: 'paid' }).expect(403);
        const ok = await http().patch(`/orders/${orderId}/status`).set(bearer(sellerToken)).send({ status: 'paid' }).expect(200);

        expect(ok.body.status).toBe('paid');
    });

    it('SSE /orders/:id/events: чужий -> 403 до відкриття потоку, без токена -> 401', async () => {
        const orderId = await placeOrder(ownerToken, 'sse-1');

        const foreign = await http().get(`/orders/${orderId}/events`).set(bearer(strangerToken)).expect(403);
        await http().get(`/orders/${orderId}/events`).expect(401);

        expect(foreign.headers['content-type']).not.toContain('text/event-stream');
    });
});
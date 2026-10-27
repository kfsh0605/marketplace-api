import request from 'supertest';
import { User } from '../../src/entities/user.entity';
import { bearer, createUser, loginAs } from './testkit/auth-helpers';
import { E2eApp, bootstrapE2eApp } from './testkit/bootstrap-app';

const NEW_PRODUCT = { name: 'RBAC клавіатура', priceCents: 129900, stock: 10 };

describe('Products E2E: публічні маршрути й RBAC на запис (401 проти 403)', () => {
    let e2e: E2eApp;
    let customerToken: string;
    let sellerToken: string;
    let adminToken: string;

    const http = () => request(e2e.app.getHttpServer());

    beforeAll(async () => {
        e2e = await bootstrapE2eApp();
    }, 120_000);

    afterAll(async () => {
        await e2e.close();
    });

    beforeEach(async () => {
        await createUser(e2e, 'customer@example.com', 'customer');
        await createUser(e2e, 'seller@example.com', 'seller');
        await createUser(e2e, 'admin@example.com', 'admin');
        customerToken = await loginAs(e2e, 'customer@example.com');
        sellerToken = await loginAs(e2e, 'seller@example.com');
        adminToken = await loginAs(e2e, 'admin@example.com');
    });

    afterEach(async () => {
        await e2e.dataSource.query('TRUNCATE TABLE products, users RESTART IDENTITY CASCADE');
    });

    it('публічні маршрути відкриті без токена: GET /health, GET /products', async () => {
        await http().get('/health').expect(200);
        await http().get('/products').expect(200);
    });

    it('POST /products без токена -> 401 (не 403)', async () => {
        const res = await http().post('/products').send(NEW_PRODUCT).expect(401);

        expect(res.body.title).toBe('Unauthorized');
        expect(res.headers['www-authenticate']).toBe('Bearer');
    });

    it('POST /products від customer -> 403 problem+json, товар не створено', async () => {
        const res = await http().post('/products').set(bearer(customerToken)).send(NEW_PRODUCT).expect(403);

        expect(res.headers['content-type']).toContain('application/problem+json');
        expect(res.body.title).toBe('Forbidden');
        expect(res.headers['www-authenticate']).toBeUndefined();
        const [{ n }] = await e2e.dataSource.query('SELECT count(*)::int AS n FROM products');
        expect(n).toBe(0);
    });

    it('POST /products від seller і від admin -> 201', async () => {
        const bySeller = await http().post('/products').set(bearer(sellerToken)).send(NEW_PRODUCT).expect(201);
        const byAdmin = await http()
            .post('/products')
            .set(bearer(adminToken))
            .send({ ...NEW_PRODUCT, name: 'Інша назва', currency: 'USD' })
            .expect(201);

        expect(bySeller.body).toMatchObject({ name: NEW_PRODUCT.name, priceCents: 129900, currency: 'UAH' });
        expect(byAdmin.body.currency).toBe('USD');
        await http().get(`/products/${bySeller.body.id}`).expect(200);
    });

    it('роль береться з БД, а не з токена: понижений seller одразу втрачає право запису', async () => {
        await http().post('/products').set(bearer(sellerToken)).send(NEW_PRODUCT).expect(201);

        await e2e.dataSource.getRepository(User).update({ email: 'seller@example.com' }, { role: 'customer' });

        await http().post('/products').set(bearer(sellerToken)).send({ ...NEW_PRODUCT, name: 'Після пониження' }).expect(403);
    });

    it('підроблений токен (role=admin у payload, старий підпис) -> 401, а не 201', async () => {
        const [header, payload, signature] = customerToken.split('.');
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        const forged = Buffer.from(JSON.stringify({ ...claims, role: 'admin' })).toString('base64url');

        await http().post('/products').set(bearer(`${header}.${forged}.${signature}`)).send(NEW_PRODUCT).expect(401);
    });

    it('валідація тіла: некоректні дані й зайві поля -> 400, дубль назви -> 409', async () => {
        await http().post('/products').set(bearer(sellerToken)).send({ name: '', priceCents: -5, stock: 1 }).expect(400);
        await http().post('/products').set(bearer(sellerToken)).send({ ...NEW_PRODUCT, id: 999 }).expect(400);

        await http().post('/products').set(bearer(sellerToken)).send(NEW_PRODUCT).expect(201);
        const dup = await http().post('/products').set(bearer(sellerToken)).send(NEW_PRODUCT).expect(409);
        expect(dup.body.title).toBe('Conflict');
    });
});
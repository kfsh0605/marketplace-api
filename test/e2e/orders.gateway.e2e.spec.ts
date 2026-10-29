import { AddressInfo } from 'node:net';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { Product } from '../../src/entities/product.entity';
import { bearer, createUser, loginAs } from './testkit/auth-helpers';
import { E2eApp, bootstrapE2eApp } from './testkit/bootstrap-app';

interface JoinAck {
    joined: boolean;
    room?: string;
    reason?: string;
}

interface StatusEvent {
    id: number;
    status: string;
}

describe('Orders E2E: WebSocket з автентифікацією сокета', () => {
    let e2e: E2eApp;
    let baseUrl: string;
    let productId: string;
    let ownerToken: string;
    let strangerToken: string;
    let sellerToken: string;
    let adminToken: string;
    const sockets: Socket[] = [];

    const http = () => request(e2e.app.getHttpServer());

    function connect(token?: string): Promise<Socket> {
        return new Promise((resolve, reject) => {
            const socket = io(baseUrl, {
                forceNew: true,
                reconnection: false,
                transports: ['websocket'],
                auth: token ? { token } : {},
            });
            sockets.push(socket);
            socket.once('connect', () => resolve(socket));
            socket.once('connect_error', (error) => reject(error));
        });
    }

    function join(socket: Socket, payload: Record<string, unknown>): Promise<JoinAck> {
        return new Promise((resolve) => socket.emit('join', payload, resolve));
    }

    function nextStatusEvent(socket: Socket, timeoutMs: number): Promise<StatusEvent | null> {
        return new Promise((resolve) => {
            const timer = setTimeout(() => resolve(null), timeoutMs);
            socket.once('order.status', (event: StatusEvent) => {
                clearTimeout(timer);
                resolve(event);
            });
        });
    }

    async function placeOrder(token: string, key: string): Promise<string> {
        const res = await http()
            .post('/orders')
            .set(bearer(token))
            .set('Idempotency-Key', key)
            .send({ customerEmail: 'ada@example.com', items: [{ productId, quantity: 1 }] })
            .expect(201);
        return res.body.id as string;
    }

    beforeAll(async () => {
        e2e = await bootstrapE2eApp();
        await e2e.app.listen(0);
        const { port } = e2e.app.getHttpServer().address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${port}`;
    }, 120_000);

    afterAll(async () => {
        await e2e.close();
    });

    beforeEach(async () => {
        const products = e2e.dataSource.getRepository(Product);
        const product = await products.save(
            products.create({ name: 'WS товар', priceCents: 1000, stock: 100, currency: 'UAH' }),
        );
        productId = String(product.id);

        await createUser(e2e, 'owner@example.com', 'customer');
        await createUser(e2e, 'stranger@example.com', 'customer');
        await createUser(e2e, 'seller@example.com', 'seller');
        await createUser(e2e, 'admin@example.com', 'admin');
        ownerToken = await loginAs(e2e, 'owner@example.com');
        strangerToken = await loginAs(e2e, 'stranger@example.com');
        sellerToken = await loginAs(e2e, 'seller@example.com');
        adminToken = await loginAs(e2e, 'admin@example.com');
    });

    afterEach(async () => {
        sockets.splice(0).forEach((socket) => socket.close());
        await e2e.dataSource.query(
            'TRUNCATE TABLE refresh_tokens, idempotency_keys, outbox, post_processing_jobs, order_items, orders, products, users RESTART IDENTITY CASCADE',
        );
        await e2e.clearLoginThrottle();
    });

    it('підключення без токена відхиляється: unauthorized', async () => {
        await expect(connect()).rejects.toThrow('unauthorized');
    });

    it('сміттєвий токен відхиляється: unauthorized', async () => {
        await expect(connect('not.a.jwt')).rejects.toThrow('unauthorized');
    });

    it('токен після logout відхиляється: unauthorized', async () => {
        await http().post('/auth/logout').set(bearer(ownerToken)).expect(204);

        await expect(connect(ownerToken)).rejects.toThrow('unauthorized');
    });

    it('власник входить у кімнату свого замовлення і отримує подію, чужий слухач у своїй кімнаті ні', async () => {
        const ownerOrder = await placeOrder(ownerToken, 'ws-1');
        const strangerOrder = await placeOrder(strangerToken, 'ws-2');
        const owner = await connect(ownerToken);
        const stranger = await connect(strangerToken);

        const ownerAck = await join(owner, { orderId: ownerOrder });
        const strangerAck = await join(stranger, { orderId: strangerOrder });
        const ownerEvent = nextStatusEvent(owner, 2000);
        const strangerEvent = nextStatusEvent(stranger, 400);

        await http()
            .patch(`/orders/${ownerOrder}/status`)
            .set(bearer(sellerToken))
            .send({ status: 'paid' })
            .expect(200);

        expect(ownerAck.joined).toBe(true);
        expect(strangerAck.joined).toBe(true);
        expect(await ownerEvent).toEqual({ id: Number(ownerOrder), status: 'paid' });
        expect(await strangerEvent).toBeNull();
    });

    it('чуже замовлення: join відхилено, підставлений userId власника у payload не допомагає', async () => {
        const ownerOrder = await placeOrder(ownerToken, 'ws-3');
        const owner = await connect(ownerToken);
        const stranger = await connect(strangerToken);
        await join(owner, { orderId: ownerOrder });

        const forged = await join(stranger, { orderId: ownerOrder, userId: 1 });

        expect(forged).toEqual({ joined: false, reason: 'not_found' });
    });

    it('чуже й неіснуюче замовлення дають однакову відповідь на join', async () => {
        const ownerOrder = await placeOrder(ownerToken, 'ws-4');
        const stranger = await connect(strangerToken);

        const foreign = await join(stranger, { orderId: ownerOrder });
        const missing = await join(stranger, { orderId: 999999 });

        expect(foreign).toEqual(missing);
    });

    it('admin може увійти в кімнату чужого замовлення', async () => {
        const ownerOrder = await placeOrder(ownerToken, 'ws-5');
        const admin = await connect(adminToken);

        const ack = await join(admin, { orderId: ownerOrder });

        expect(ack.joined).toBe(true);
    });
});
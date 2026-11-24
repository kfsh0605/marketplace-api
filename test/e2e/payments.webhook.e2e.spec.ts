import request from 'supertest';
import { createUser } from './testkit/auth-helpers';
import { E2E_WEBHOOK_SECRET, E2eApp, bootstrapE2eApp } from './testkit/bootstrap-app';
import { buildSignatureHeader, SIGNATURE_HEADER } from '../../src/webhooks/signature';

describe('Payment webhook E2E: підпис, дедуп, звірка суми', () => {
    let e2e: E2eApp;
    let orderId: number;

    const http = () => request(e2e.app.getHttpServer());
    const now = () => Math.floor(Date.now() / 1000);

    const eventBody = (id: string, overrides: Partial<{ orderId: number; amountCents: number; currency: string }> = {}) =>
        JSON.stringify({
            id,
            type: 'payment.succeeded',
            data: { orderId, amountCents: 2500, currency: 'UAH', ...overrides },
        });

    /** Надсилає ТІ САМІ байти, які підписано: supertest із рядком і явним content-type нічого не перекодовує. */
    const deliver = (body: string, header: string | undefined = buildSignatureHeader(E2E_WEBHOOK_SECRET, Buffer.from(body), now())) => {
        const req = http().post('/webhooks/payments').set('Content-Type', 'application/json');
        if (header !== undefined) {
            req.set(SIGNATURE_HEADER, header);
        }
        return req.send(body);
    };

    const orderStatus = async (): Promise<string> => {
        const rows: Array<{ status: string }> = await e2e.dataSource.query('SELECT status FROM orders WHERE id = $1', [orderId]);
        return rows[0].status;
    };
    const ledger = (): Promise<Array<{ event_id: string; outcome: string }>> =>
        e2e.dataSource.query('SELECT event_id, outcome FROM payment_events ORDER BY id');

    beforeAll(async () => {
        e2e = await bootstrapE2eApp();
    }, 120_000);

    afterAll(async () => {
        await e2e.close();
    });

    beforeEach(async () => {
        const user = await createUser(e2e, 'payer@example.com', 'customer');
        const rows: Array<{ id: number }> = await e2e.dataSource.query(
            `INSERT INTO orders ("userId", "customerEmail", status, "totalCents", currency)
             VALUES ($1, 'payer@example.com', 'pending', 2500, 'UAH') RETURNING id`,
            [user.id],
        );
        orderId = rows[0].id;
    });

    afterEach(async () => {
        await e2e.dataSource.query(
            'TRUNCATE TABLE refresh_tokens, idempotency_keys, outbox, post_processing_jobs, order_items, orders, products, users RESTART IDENTITY CASCADE',
        );
    });

    it('вірний підпис і сума: 200 accepted, замовлення стає paid, подія лежить у леджері', async () => {
        const res = await deliver(eventBody('evt_ok')).expect(200);

        expect(res.body).toEqual({ status: 'accepted' });
        expect(await orderStatus()).toBe('paid');
        expect(await ledger()).toEqual([{ event_id: 'evt_ok', outcome: 'applied' }]);
    });

    it('ендпоінту не потрібен JWT: автентичність дає лише підпис', async () => {
        await deliver(eventBody('evt_nojwt')).expect(200);
    });

    it('без підпису, з чужим секретом, зі зміненим тілом і зі застарілою міткою: 401, нічого не змінилося', async () => {
        const body = eventBody('evt_bad');
        const stale = buildSignatureHeader(E2E_WEBHOOK_SECRET, Buffer.from(body), now() - 3600);

        await deliver(body, '').expect(401);
        await deliver(body, buildSignatureHeader('another-secret-0123456789', Buffer.from(body), now())).expect(401);
        await deliver(body, buildSignatureHeader(E2E_WEBHOOK_SECRET, Buffer.from(eventBody('evt_other')), now())).expect(401);
        await deliver(body, stale).expect(401);

        expect(await orderStatus()).toBe('pending');
        expect(await ledger()).toEqual([]);
    });

    it('підпис над перезаписаним JSON не збігається з сирим тілом: 401', async () => {
        const raw = JSON.stringify(JSON.parse(eventBody('evt_pretty')), null, 2);
        const signedOverCompact = buildSignatureHeader(E2E_WEBHOOK_SECRET, Buffer.from(eventBody('evt_pretty')), now());

        await deliver(raw, signedOverCompact).expect(401);
        expect(await orderStatus()).toBe('pending');
    });

    it('401 відповідає problem+json і не каже, чим саме поганий підпис', async () => {
        const res = await deliver(eventBody('evt_prob'), '').expect(401);

        expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
        expect(res.body.detail).toBe('Invalid webhook signature');
    });

    it('повторна доставка тієї самої події: 200 duplicate, ефект один', async () => {
        const body = eventBody('evt_dup');
        await deliver(body).expect(200);
        const second = await deliver(body).expect(200);

        expect(second.body).toEqual({ status: 'duplicate' });
        expect(await orderStatus()).toBe('paid');
        expect(await ledger()).toHaveLength(1);
    });

    it('п\'ять однакових подій одночасно: рівно один ефект', async () => {
        const body = eventBody('evt_parallel');
        const results = await Promise.all(Array.from({ length: 5 }, () => deliver(body)));

        const statuses = results.map((r) => r.body.status as string).sort();
        expect(statuses).toEqual(['accepted', 'duplicate', 'duplicate', 'duplicate', 'duplicate']);
        expect(await ledger()).toHaveLength(1);
        expect(await orderStatus()).toBe('paid');
    });

    it('сума не збігається із замовленням: 422, статус не змінився, відмова записана; повтор цієї події дає duplicate', async () => {
        const body = eventBody('evt_cheap', { amountCents: 1 });

        await deliver(body).expect(422);
        expect(await orderStatus()).toBe('pending');
        expect(await ledger()).toEqual([{ event_id: 'evt_cheap', outcome: 'amount_mismatch' }]);

        const replay = await deliver(body).expect(200);
        expect(replay.body).toEqual({ status: 'duplicate' });
        expect(await orderStatus()).toBe('pending');
    });

    it('інша валюта при тій самій сумі теж відхиляється', async () => {
        await deliver(eventBody('evt_usd', { currency: 'USD' })).expect(422);
        expect(await orderStatus()).toBe('pending');
    });

    it('нова подія для вже оплаченого замовлення: 409, статус paid лишається', async () => {
        await deliver(eventBody('evt_first')).expect(200);
        await deliver(eventBody('evt_second')).expect(409);

        expect(await orderStatus()).toBe('paid');
        expect((await ledger()).map((row) => row.outcome)).toEqual(['applied', 'not_payable']);
    });

    it('скасоване замовлення не оплачується: 409', async () => {
        await e2e.dataSource.query(`UPDATE orders SET status = 'cancelled' WHERE id = $1`, [orderId]);
        await deliver(eventBody('evt_cancelled')).expect(409);
        expect(await orderStatus()).toBe('cancelled');
    });

    it('замовлення немає: 404 і запису в леджері теж немає', async () => {
        await deliver(eventBody('evt_ghost', { orderId: orderId + 1000 })).expect(404);
        expect(await ledger()).toEqual([]);
    });

    it('інший тип події: 200 ignored; зіпсоване тіло: 400', async () => {
        const ignored = JSON.stringify({ id: 'evt_refund', type: 'payment.refunded' });
        const res = await deliver(ignored).expect(200);
        expect(res.body).toEqual({ status: 'ignored' });

        await deliver('not json').expect(400);
        await deliver(JSON.stringify({ id: 'evt_nodata', type: 'payment.succeeded' })).expect(400);
        expect(await ledger()).toEqual([]);
    });

    it('леджер лише додається: UPDATE заборонено тригером', async () => {
        await deliver(eventBody('evt_ledger')).expect(200);

        await expect(e2e.dataSource.query(`UPDATE payment_events SET outcome = 'amount_mismatch'`)).rejects.toThrow(
            /append-only/,
        );
        expect(await ledger()).toEqual([{ event_id: 'evt_ledger', outcome: 'applied' }]);
    });
});

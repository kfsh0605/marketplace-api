import { cleanupDemoData, createDemoUser, runTag, startDemoApp } from './lib/auth-demo-kit';
import type { DemoApp } from './lib/auth-demo-kit';
import { expectEq, printLines, runStandalone } from './lib/demo-output';
import { buildSignatureHeader, SIGNATURE_HEADER } from './webhooks/signature';

/**
 * Вхідний вебхук платежів, наживо на справжньому застосунку (in-process, порт 0, тимчасові дані).
 * Секрет береться зі сховища (secrets/payment_webhook_secret через with-secrets.sh); якщо його там немає,
 * демо підставляє власний одноразовий, щоб його можна було запускати й без сховища (SKIP_VAULT=1).
 */
async function post(app: DemoApp, body: string, header: string | undefined): Promise<{ status: number; body: any }> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (header !== undefined) {
        headers[SIGNATURE_HEADER] = header;
    }
    const response = await fetch(`http://127.0.0.1:${app.port}/webhooks/payments`, { method: 'POST', headers, body });
    const text = await response.text();
    let parsed: any;
    try {
        parsed = text ? JSON.parse(text) : null;
    } catch {
        parsed = text;
    }
    return { status: response.status, body: parsed };
}

void runStandalone(async (failures) => {
    process.env.PAYMENT_WEBHOOK_SECRET ||= `demo-webhook-secret-${runTag('wh')}`;
    const secret = process.env.PAYMENT_WEBHOOK_SECRET;
    const app = await startDemoApp();
    const tag = runTag('webhook');
    const email = `${tag}-payer@example.com`;
    const now = () => Math.floor(Date.now() / 1000);
    const sign = (body: string, key = secret, at = now()) => buildSignatureHeader(key, Buffer.from(body), at);

    try {
        const user = await createDemoUser(app.dataSource, email, 'customer');
        const newOrder = async (): Promise<number> => {
            const rows: Array<{ id: number }> = await app.dataSource.query(
                `INSERT INTO orders ("userId", "customerEmail", status, "totalCents", currency)
                 VALUES ($1, $2, 'pending', 2500, 'UAH') RETURNING id`,
                [user.id, email],
            );
            return rows[0].id;
        };
        const statusOf = async (id: number): Promise<string> => {
            const rows: Array<{ status: string }> = await app.dataSource.query('SELECT status FROM orders WHERE id = $1', [id]);
            return rows[0].status;
        };
        const event = (id: string, orderId: number, amountCents: number) =>
            JSON.stringify({ id, type: 'payment.succeeded', data: { orderId, amountCents, currency: 'UAH' } });

        const orderId = await newOrder();
        const goodBody = event(`${tag}-evt-1`, orderId, 2500);

        // 1. Підроблені запити: жоден не має змінити замовлення
        const noSignature = await post(app, goodBody, undefined);
        const wrongSecret = await post(app, goodBody, sign(goodBody, 'attacker-secret-0123456789'));
        const tampered = await post(app, event(`${tag}-evt-1`, orderId, 1), sign(goodBody));
        const stale = await post(app, goodBody, sign(goodBody, secret, now() - 3600));
        const statusAfterForged = await statusOf(orderId);

        // 2. Справжній запит, потім той самий ще раз
        const accepted = await post(app, goodBody, sign(goodBody));
        const duplicate = await post(app, goodBody, sign(goodBody));
        const statusAfterPaid = await statusOf(orderId);

        // 3. Підписаний, але із сумою, яка не збігається із замороженою в замовленні
        const secondOrder = await newOrder();
        const cheapBody = event(`${tag}-evt-2`, secondOrder, 1);
        const mismatch = await post(app, cheapBody, sign(cheapBody));
        const statusAfterMismatch = await statusOf(secondOrder);

        const ledger: Array<{ event_id: string; outcome: string }> = await app.dataSource.query(
            `SELECT event_id, outcome FROM payment_events WHERE order_id = ANY($1) ORDER BY id`,
            [[orderId, secondOrder]],
        );
        const appendOnly = await app.dataSource
            .query(`UPDATE payment_events SET outcome = 'applied' WHERE order_id = $1`, [secondOrder])
            .then(() => 0)
            .catch((error: Error) => (/append-only/.test(error.message) ? 1 : 0));

        printLines({
            'rejected-no-signature': noSignature.status === 401 ? 1 : 0,
            'rejected-signature': wrongSecret.status === 401 ? 1 : 0,
            'rejected-tampered': tampered.status === 401 ? 1 : 0,
            'rejected-stale': stale.status === 401 ? 1 : 0,
            'status-after-forged': statusAfterForged,
            accepted: accepted.status === 200 && accepted.body?.status === 'accepted' ? 1 : 0,
            duplicates: duplicate.status === 200 && duplicate.body?.status === 'duplicate' ? 1 : 0,
            'status-after-paid': statusAfterPaid,
            'amount-mismatch': mismatch.status === 422 ? 1 : 0,
            'status-after-mismatch': statusAfterMismatch,
            'ledger-rows': ledger.length,
            'ledger-applied': ledger.filter((row) => row.outcome === 'applied').length,
            'ledger-update-blocked': appendOnly,
        });

        expectEq(failures, 'rejected-no-signature', noSignature.status, 401);
        expectEq(failures, 'rejected-signature', wrongSecret.status, 401);
        expectEq(failures, 'rejected-tampered', tampered.status, 401);
        expectEq(failures, 'rejected-stale', stale.status, 401);
        expectEq(failures, 'status-after-forged', statusAfterForged, 'pending');
        expectEq(failures, 'accepted', accepted.body?.status, 'accepted');
        expectEq(failures, 'duplicates', duplicate.body?.status, 'duplicate');
        expectEq(failures, 'status-after-paid', statusAfterPaid, 'paid');
        expectEq(failures, 'amount-mismatch', mismatch.status, 422);
        expectEq(failures, 'status-after-mismatch', statusAfterMismatch, 'pending');
        expectEq(failures, 'ledger-rows', ledger.length, 2);
        expectEq(failures, 'ledger-applied', ledger.filter((row) => row.outcome === 'applied').length, 1);
        expectEq(failures, 'ledger-update-blocked', appendOnly, 1);
    } finally {
        const leftovers = await cleanupDemoData(app.dataSource, [email], []).catch((error: Error) => {
            failures.push(`cleanup: ${error.message}`);
            return 0;
        });
        expectEq(failures, 'залишки демо-даних після cleanup', leftovers, 0);
        await app.stop().catch(() => undefined);
    }
});

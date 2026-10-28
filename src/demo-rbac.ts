import { Product } from './entities/product.entity';
import {
    cleanupDemoData,
    createDemoUser,
    DEMO_PASSWORD,
    forgeAdminToken,
    runTag,
    startDemoApp,
    tokenOf,
} from './lib/auth-demo-kit';
import type { DemoApp } from './lib/auth-demo-kit';
import { expectEq, printLines, runStandalone } from './lib/demo-output';

async function loginToken(app: DemoApp, email: string): Promise<string> {
    const login = await app.call('POST', '/auth/login', { body: { email, password: DEMO_PASSWORD } });
    return tokenOf(login, 'accessToken');
}

async function placeOrder(app: DemoApp, token: string, productId: number, key: string): Promise<string> {
    const placed = await app.call('POST', '/orders', {
        token,
        headers: { 'idempotency-key': key },
        body: { customerEmail: 'demo@example.com', items: [{ productId: String(productId), quantity: 1 }] },
    });
    return String(placed.body?.id ?? '');
}

void runStandalone(async (failures) => {
    const app = await startDemoApp();
    const tag = runTag('rbac');
    const emails = {
        alice: `${tag}-alice@example.com`,
        bob: `${tag}-bob@example.com`,
        seller: `${tag}-seller@example.com`,
    };
    const demoProduct = `${tag}-product`;
    const sellerProduct = `${tag}-seller-product`;

    try {
        await createDemoUser(app.dataSource, emails.alice, 'customer');
        await createDemoUser(app.dataSource, emails.bob, 'customer');
        await createDemoUser(app.dataSource, emails.seller, 'seller');
        const products = app.dataSource.getRepository(Product);
        const product = await products.save(
            products.create({ name: demoProduct, priceCents: 1000, stock: 10, currency: 'UAH' }),
        );

        const aliceToken = await loginToken(app, emails.alice);
        const bobToken = await loginToken(app, emails.bob);
        const sellerToken = await loginToken(app, emails.seller);
        const aliceOrder = await placeOrder(app, aliceToken, product.id, `${tag}-alice`);
        const bobOrder = await placeOrder(app, bobToken, product.id, `${tag}-bob`);

        const anon = await app.call('GET', `/orders/${aliceOrder}`);
        const own = await app.call('GET', `/orders/${aliceOrder}`, { token: aliceToken });
        const foreign = await app.call('GET', `/orders/${bobOrder}`, { token: aliceToken });
        const newProduct = (name: string) => ({ name, priceCents: 5000, stock: 5 });
        const roleDenied = await app.call('POST', '/products', { token: aliceToken, body: newProduct(sellerProduct) });
        const roleAllowed = await app.call('POST', '/products', { token: sellerToken, body: newProduct(sellerProduct) });
        const tampered = await app.call('GET', `/orders/${bobOrder}`, { token: forgeAdminToken(aliceToken) });

        printLines({
            anon: anon.status,
            own: own.status,
            foreign: foreign.status,
            'role-denied': roleDenied.status,
            'role-allowed': roleAllowed.status,
            tampered: tampered.status,
        });

        expectEq(failures, 'підготовка: замовлення Alice створено', aliceOrder !== '', true);
        expectEq(failures, 'підготовка: замовлення Bob створено', bobOrder !== '', true);
        expectEq(failures, 'anon', anon.status, 401);
        expectEq(failures, 'own', own.status, 200);
        expectEq(failures, 'foreign', foreign.status, 403);
        expectEq(failures, 'role-denied', roleDenied.status, 403);
        expectEq(failures, 'role-allowed', [200, 201].includes(roleAllowed.status), true);
        expectEq(failures, 'tampered', tampered.status, 401);
    } finally {
        const leftovers = await cleanupDemoData(app.dataSource, Object.values(emails), [demoProduct, sellerProduct]).catch(
            (error: Error) => {
                failures.push(`cleanup: ${error.message}`);
                return 0;
            },
        );
        expectEq(failures, 'залишки демо-даних після cleanup', leftovers, 0);
        await app.stop().catch(() => undefined);
    }
});
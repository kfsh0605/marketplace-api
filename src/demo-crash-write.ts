import { sleep } from './lib/sleep';
import { expectEq, runDemo } from './messaging/demo-kit';
import { EventPublisher } from './messaging/publisher';
import { relayOnce } from './outbox/relay';
import {
    demoDto,
    installCommitFailure,
    openOrdersService,
    OUTBOX_DEMO_KEY_PREFIX,
    prepareOutboxDemo,
    printLines,
    removeCommitFailure,
    snapshot,
    startProbeConsumer,
} from './outbox/demo-kit';

void runDemo(async (demo, failures) => {
    const orders = await openOrdersService();
    const publisher = new EventPublisher();
    try {
        const { productId, startedAt } = await prepareOutboxDemo(demo);

        // 1. Ламаємо COMMIT: тригер спрацює, коли обидві вставки (замовлення й outbox) уже виконано
        await installCommitFailure(demo.pool);
        let writeFailed = 0;
        try {
            await orders.service.createIdempotent(demoDto(productId), `${OUTBOX_DEMO_KEY_PREFIX}crash-write`);
        } catch (err) {
            writeFailed = 1;
            console.log(`Транзакція впала: ${(err as Error).message}`);
        } finally {
            await removeCommitFailure(demo.pool);
        }

        // 2. Relay і консюмер шукають, що виносити. Якщо подія вижила без замовлення, вони її знайдуть
        await relayOnce(demo.pool, publisher, { notBefore: startedAt });
        const probe = await startProbeConsumer(demo);
        await sleep(700);
        await probe.stop();

        // 3. Протокол
        const snap = await snapshot(demo.pool, startedAt);
        printLines({
            'write-failed': writeFailed,
            orders: snap.orders,
            outbox: snap.outbox,
            published: snap.published,
            deliveries: probe.deliveries,
            effect: snap.effect,
        });

        // 4. Самоперевірка: ні замовлення, ні події
        expectEq(failures, 'write-failed', writeFailed, 1);
        expectEq(failures, 'orders', snap.orders, 0);
        expectEq(failures, 'outbox', snap.outbox, 0);
        expectEq(failures, 'published', snap.published, 0);
        expectEq(failures, 'deliveries', probe.deliveries, 0);
        expectEq(failures, 'effect', snap.effect, 0);
    } finally {
        await removeCommitFailure(demo.pool).catch(() => undefined);
        await publisher.close().catch(() => undefined);
        await orders.close().catch(() => undefined);
    }
});
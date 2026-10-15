import { sleep } from './lib/sleep';
import { expectEq, runDemo, waitFor } from './messaging/demo-kit';
import { EventPublisher } from './messaging/publisher';
import {
    demoDto,
    openOrdersService,
    OUTBOX_DEMO_KEY_PREFIX,
    prepareOutboxDemo,
    printLines,
    relayUntil,
    snapshot,
    startProbeConsumer,
} from './outbox/demo-kit';

void runDemo(async (demo, failures) => {
    const orders = await openOrdersService();
    const publisher = new EventPublisher();
    try {
        const { productId, startedAt } = await prepareOutboxDemo(demo);
        const key = `${OUTBOX_DEMO_KEY_PREFIX}happy-path`;

        // 1. Клієнт надсилає запит, не отримує відповіді й повторює його з ТИМ САМИМ ключем
        let requests = 0;
        requests++;
        const first = await orders.service.createIdempotent(demoDto(productId), key);
        requests++;
        const second = await orders.service.createIdempotent(demoDto(productId), key);
        console.log(
            `Запитів: ${requests}. Перший: замовлення ${first.order.id}, другий: замовлення ${second.order.id}` +
            ` (повтор: ${second.replayed}).`,
        );

        // 2. Relay відносить конверт брокеру
        await relayUntil(demo.pool, publisher, startedAt, 1);
        console.log('Relay виніс конверт у брокер.');

        // 3. Консюмер забирає подію й застосовує ефект
        const probe = await startProbeConsumer(demo);
        await waitFor(() => probe.settled >= 1, 10_000);
        await sleep(500); // чекаємо: чи не прийде щось зайве
        await probe.stop();

        // 4. Протокол: числа рахуємо в базі
        const snap = await snapshot(demo.pool, startedAt);
        printLines({
            requests,
            orders: snap.orders,
            outbox: snap.outbox,
            published: snap.published,
            deliveries: probe.deliveries,
            effect: snap.effect,
            processed: snap.processed,
        });

        // 5. Самоперевірка інваріанта
        expectEq(failures, 'requests', requests, 2);
        expectEq(failures, 'orders', snap.orders, 1);
        expectEq(failures, 'outbox', snap.outbox, 1);
        expectEq(failures, 'published', snap.published, 1);
        expectEq(failures, 'effect', snap.effect, 1);
        expectEq(failures, 'processed', snap.processed, 1);
        expectEq(failures, 'другий запит повернув той самий заказ', second.order.id, first.order.id);
        expectEq(failures, 'перший запит не повтор', first.replayed, false);
        expectEq(failures, 'другий запит повтор', second.replayed, true);
    } finally {
        await publisher.close().catch(() => undefined);
        await orders.close().catch(() => undefined);
    }
});
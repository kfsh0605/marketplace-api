import { startOrderPlacedConsumer } from './messaging/consumer';
import {
    countEffects,
    demoEvent,
    expectEq,
    printResult,
    queueDepth,
    runDemo,
    waitFor,
} from './messaging/demo-kit';
import { EventPublisher } from './messaging/publisher';
import { QUEUE_ORDER_PLACED, QUEUE_ORDER_PLACED_DLQ } from './messaging/rabbitmq.config';

const COUNT = 5;
/** Дефолтний consumer_timeout RabbitMQ: 30 хвилин */
const CONSUMER_TIMEOUT_MS = 30 * 60 * 1000;
/** quorum-черга сама обрізає prefetch до 2000 (щоб Raft-лог не розпухав) */
const QUORUM_PREFETCH_CAP = 2000;

void runDemo(async (demo, failures) => {
    const publisher = new EventPublisher();
    try {
        // 1. Публікація через confirm-канал: publish() чекає підтвердження і перевіряє basic.return
        let published = 0;
        for (let n = 1; n <= COUNT; n++) {
            await publisher.publish(demoEvent(n));
            published++;
        }
        const stored = await queueDepth(demo.ch, QUEUE_ORDER_PLACED);
        console.log(`Брокер зберіг ${stored} повідомлень, поки consumer'а ще немає: черга працює як склад.`);

        // 2. Запускаємо consumer: ручний ack після ефекту, prefetch задано явно
        let delivered = 0;
        let acked = 0;
        let settled = 0;
        const durations: number[] = [];
        const { consumerTag, prefetch } = await startOrderPlacedConsumer(demo.ch, demo.store, {
            onDelivery: () => {
                delivered++;
            },
            onSettled: (r) => {
                settled++;
                durations.push(r.durationMs);
                if (r.outcome === 'acked' || r.outcome === 'skipped') {
                    acked++;
                }
            },
        });
        await waitFor(() => settled >= COUNT, 15_000);
        await demo.ch.cancel(consumerTag);

        // 3. Доказ, що ack справді дійшли до брокера: закриваємо канал.
        // Непідтверджені повідомлення повернулись би в чергу, тож новий канал має побачити 0.
        await demo.ch.close();
        const probe = await demo.conn.createChannel();
        const leftover = await queueDepth(probe, QUEUE_ORDER_PLACED);
        const dlq = await queueDepth(probe, QUEUE_ORDER_PLACED_DLQ);
        await probe.close();

        const effect = await countEffects(demo.store);

        // 4. Цифри для обґрунтування prefetch (потрапляють у README).
        // Опора тут consumer_timeout, а не RTT: це фіксований параметр брокера, а RTT залежить від
        // машини (0.05 мс на одній, 0.7 мс на іншій), тож оцінка "час / RTT" розходиться в рази
        // і не відтворюється між середовищами.
        const avg = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
        const max = durations.length ? Math.max(...durations) : 0;
        const worst = Math.max(max, 1);
        const byTimeout = Math.floor(CONSUMER_TIMEOUT_MS / worst);
        const ceiling = Math.min(byTimeout, QUORUM_PREFETCH_CAP);
        const windowMs = prefetch * worst;
        console.log(`Обробка одного повідомлення: у середньому ${avg} мс, максимум ${max} мс.`);
        console.log(
            `Стеля prefetch за consumer_timeout: ${CONSUMER_TIMEOUT_MS} мс / ${worst} мс (найгірший час) = ${byTimeout}; ` +
            `quorum-черга обрізає prefetch до ${QUORUM_PREFETCH_CAP}; підсумкова стеля ${ceiling}.`,
        );
        console.log(
            `Найгірший час розібрати все вікно: ${prefetch} × ${worst} мс = ${windowMs} мс, ` +
            `це ${((windowMs / CONSUMER_TIMEOUT_MS) * 100).toFixed(3)}% від consumer_timeout; prefetch ${prefetch} ≤ стеля ${ceiling}.`,
        );

        // 5. Протокол і самоперевірка
        printResult({ published, delivered, effect, acked, dlq, prefetch });

        expectEq(failures, 'published', published, COUNT);
        expectEq(failures, 'delivered', delivered, COUNT);
        expectEq(failures, 'effect', effect, COUNT);
        expectEq(failures, 'acked', acked, COUNT);
        expectEq(failures, 'dlq', dlq, 0);
        expectEq(failures, 'залишок у черзі після закриття каналу', leftover, 0);
        if (prefetch < 1 || prefetch > ceiling) {
            failures.push(
                `prefetch ${prefetch} поза діапазоном 1..${ceiling} (стеля: consumer_timeout / найгірший час обробки і межа quorum-черги)`,
            );
        }
    } finally {
        await publisher.close().catch(() => undefined);
    }
});
import { startOrderPlacedConsumer } from './messaging/consumer';
import {
    countEffects,
    demoEvent,
    expectEq,
    measureRttMs,
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
        const rtt = await measureRttMs(demo.ch, QUEUE_ORDER_PLACED);

        // 3. Доказ, що ack справді дійшли до брокера: закриваємо канал.
        // Непідтверджені повідомлення повернулись би в чергу, тож новий канал має побачити 0.
        await demo.ch.close();
        const probe = await demo.conn.createChannel();
        const leftover = await queueDepth(probe, QUEUE_ORDER_PLACED);
        const dlq = await queueDepth(probe, QUEUE_ORDER_PLACED_DLQ);
        await probe.close();

        const effect = await countEffects(demo.store);

        // 4. Цифри для обґрунтування prefetch (потрапляють у README)
        const avg = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
        const max = durations.length ? Math.max(...durations) : 0;
        console.log(`Обробка одного повідомлення: у середньому ${avg} мс, максимум ${max} мс.`);
        console.log(
            `Перевірка безпеки prefetch: ${prefetch} повідомлень × ${max} мс → ${prefetch * max} мс, ` +
            `а ліміт consumer_timeout ${CONSUMER_TIMEOUT_MS} мс.`,
        );
        const estimate = Math.max(1, Math.floor(avg / rtt));
        console.log(`RTT до брокера (простий запит туди-назад): у середньому ${rtt.toFixed(2)} мс.`);
        console.log(
            `Оцінка prefetch за формулою час обробки / RTT: ${avg} мс / ${rtt.toFixed(2)} мс → ${estimate}; у проєкті prefetch ${prefetch}.`,
        );

        // 5. Протокол і самоперевірка
        printResult({ published, delivered, effect, acked, dlq, prefetch });

        expectEq(failures, 'published', published, COUNT);
        expectEq(failures, 'delivered', delivered, COUNT);
        expectEq(failures, 'effect', effect, COUNT);
        expectEq(failures, 'acked', acked, COUNT);
        expectEq(failures, 'dlq', dlq, 0);
        expectEq(failures, 'залишок у черзі після закриття каналу', leftover, 0);
        if (prefetch < 1 || prefetch > 2000) {
            failures.push(`prefetch поза діапазоном 1..2000: ${prefetch}`);
        }
        if (prefetch * max >= CONSUMER_TIMEOUT_MS) {
            failures.push('prefetch × час обробки не вкладається в consumer_timeout');
        }
    } finally {
        await publisher.close().catch(() => undefined);
    }
});
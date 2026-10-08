import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { startOrderPlacedConsumer } from './messaging/consumer';
import { countEffects, demoEvent, expectEq, printResult, queueDepth, runDemo, waitFor } from './messaging/demo-kit';
import { EventPublisher } from './messaging/publisher';
import { QUEUE_ORDER_PLACED, QUEUE_ORDER_PLACED_DLQ } from './messaging/rabbitmq.config';

/** Запускає crash-consumer окремим процесом і чекає його (аварійної) смерті. */
function runCrashingConsumer(): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [join(__dirname, 'messaging', 'crash-consumer.js')], {
            stdio: 'inherit', // env (RABBITMQ_URL, DB_*) успадковується від with-secrets.sh
        });
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error('crash-consumer не завершився за 20 с'));
        }, 20_000);
        child.on('error', reject);
        child.on('exit', (code, signal) => {
            clearTimeout(timer);
            resolve({ code, signal });
        });
    });
}

void runDemo(async (demo, failures) => {
    // 1. Публікуємо одну подію
    const event = demoEvent(1);
    const publisher = new EventPublisher();
    try {
        await publisher.publish(event);
    } finally {
        await publisher.close().catch(() => undefined);
    }
    console.log(`Опубліковано подію ${event.eventId}.`);

    // 2. Перший consumer робить ефект і гине до ack (справжній kill -9, не channel.close)
    const crash = await runCrashingConsumer();
    const diedAbruptly = crash.signal !== null || crash.code !== 0;
    console.log(`Споживач загинув аварійно (код ${crash.code}, сигнал ${crash.signal}).`);

    const effectAfterCrash = await countEffects(demo.store);
    console.log(`Ефектів у БД після аварії: ${effectAfterCrash}. Гроші видано, печатки немає.`);

    // 3. Брокер бачить обірване з'єднання і повертає непідтверджене повідомлення в чергу
    const returned = await waitFor(async () => (await queueDepth(demo.ch, QUEUE_ORDER_PLACED)) === 1, 10_000);
    console.log(
        returned
            ? 'Брокер помітив обрив і повернув повідомлення в чергу.'
            : 'Повідомлення не повернулось у чергу!',
    );

    // 4. Другий (здоровий) consumer отримує повтор: ефект уже є, його треба пропустити
    let deliveries = 0;
    let redelivered = false;
    let skipped = 0;
    let settled = 0;
    const { consumerTag } = await startOrderPlacedConsumer(demo.ch, demo.store, {
        onDelivery: (d) => {
            deliveries = Math.max(deliveries, d.deliveryCount);
            if (d.redelivered) {
                redelivered = true;
            }
        },
        onSettled: (r) => {
            settled++;
            if (r.outcome === 'skipped') {
                skipped++;
            }
        },
    });
    await waitFor(() => settled >= 1, 15_000);
    await demo.ch.cancel(consumerTag);
    console.log(
        `Другий consumer: доставка №${deliveries}${redelivered ? ' (повторна)' : ''}, ` +
        'ефект пропущено завдяки ON CONFLICT DO NOTHING.',
    );

    // 5. Закриваємо канал і дивимось чесну картину через новий: усе підтверджено, DLQ порожня
    await demo.ch.close();
    const probe = await demo.conn.createChannel();
    const leftover = await queueDepth(probe, QUEUE_ORDER_PLACED);
    const dlq = await queueDepth(probe, QUEUE_ORDER_PLACED_DLQ);
    await probe.close();

    const effect = await countEffects(demo.store);

    // 6. Протокол і самоперевірка
    printResult({ deliveries, effect, skipped });

    if (!diedAbruptly) {
        failures.push('crash-consumer завершився штатно, а мав загинути аварійно');
    }
    expectEq(failures, 'ефектів після аварії', effectAfterCrash, 1);
    if (!returned) {
        failures.push('повідомлення не повернулось у чергу після аварії');
    }
    if (deliveries < 2) {
        failures.push(`deliveries: очікували >= 2, отримали ${deliveries}`);
    }
    if (!redelivered) {
        failures.push('друга доставка не позначена як повторна (redelivered)');
    }
    expectEq(failures, 'effect', effect, 1);
    expectEq(failures, 'skipped', skipped, 1);
    expectEq(failures, 'залишок у черзі після закриття каналу', leftover, 0);
    expectEq(failures, 'dlq', dlq, 0);
});
import { startOrderPlacedConsumer } from './messaging/consumer';
import { countEffects, expectEq, printResult, queueDepth, runDemo, waitFor } from './messaging/demo-kit';
import { DEATH_REASONS, readDeathInfo } from './messaging/dlq';
import {
    EXCHANGE_EVENTS,
    QUEUE_ORDER_PLACED,
    QUEUE_ORDER_PLACED_DLQ,
    ROUTING_KEY_ORDER_PLACED,
} from './messaging/rabbitmq.config';

void runDemo(async (demo, failures) => {
    // 1. Публікуємо "отруйне" повідомлення: це не JSON, тож розібрати його неможливо ніколи
    const pubCh = await demo.conn.createConfirmChannel();
    pubCh.publish(EXCHANGE_EVENTS, ROUTING_KEY_ORDER_PLACED, Buffer.from('це не JSON {{{'), {
        persistent: true,
        mandatory: true,
        contentType: 'application/json',
    });
    await pubCh.waitForConfirms();
    await pubCh.close();
    console.log('Опубліковано отруйне повідомлення: брокер прийняв його як будь-яке інше.');

    // 2. Справжній consumer отримує його і відхиляє без повернення в чергу
    let rejected = 0;
    const { consumerTag } = await startOrderPlacedConsumer(demo.ch, demo.store, {
        onSettled: (r) => {
            if (r.outcome === 'dead') {
                rejected++;
            }
        },
    });
    await waitFor(() => rejected >= 1, 10_000);

    // 3. Мертві листи їдуть у DLQ асинхронно: чекаємо, поки вона отримає повідомлення
    await waitFor(async () => (await queueDepth(demo.ch, QUEUE_ORDER_PLACED_DLQ)) >= 1, 10_000);
    await demo.ch.cancel(consumerTag);

    // 4. Закриваємо канал consumer'а: непідтверджені повідомлення повернулись би в чергу.
    // Новий канал бачить чесну картину: що лишилось у робочій черзі і що лежить у DLQ
    await demo.ch.close();
    const probe = await demo.conn.createChannel();
    const work = await queueDepth(probe, QUEUE_ORDER_PLACED);
    const dlq = await queueDepth(probe, QUEUE_ORDER_PLACED_DLQ);

    // 5. Дивимось на листа в DLQ і читаємо штампи (x-death), а потім повертаємо його на місце
    let reason = 'unknown';
    const dead = await probe.get(QUEUE_ORDER_PLACED_DLQ, { noAck: false });
    if (dead) {
        const info = readDeathInfo(dead.properties.headers);
        reason = info.reason;
        console.log(`Штамп на конверті: черга ${info.queue}, причина ${info.reason}, разів ${info.count}.`);
        probe.nack(dead, false, true);
    }
    await probe.close();

    const effect = await countEffects(demo.store);

    // 6. Протокол і самоперевірка
    printResult({ rejected, work, dlq, 'dlq-reason': reason, effect });

    expectEq(failures, 'rejected', rejected, 1);
    expectEq(failures, 'work', work, 0);
    expectEq(failures, 'dlq', dlq, 1);
    expectEq(failures, 'effect', effect, 0);
    if (!(DEATH_REASONS as readonly string[]).includes(reason)) {
        failures.push(`dlq-reason: очікували одну з ${DEATH_REASONS.join('|')}, отримали ${reason}`);
    }
});
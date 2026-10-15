import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { sleep } from './lib/sleep';
import { expectEq, queueDepth, runDemo, waitFor } from './messaging/demo-kit';
import { EventPublisher } from './messaging/publisher';
import { QUEUE_ORDER_PLACED } from './messaging/rabbitmq.config';
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

/** Запускає relay, який сам себе вбиває, окремим процесом і чекає його смерті. */
function runCrashingRelay(startedAt: Date): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [join(__dirname, 'outbox', 'crash-relay.js')], {
            stdio: 'inherit', // env (DB_*, RABBITMQ_URL) успадковується від with-secrets.sh або грейдера
            env: { ...process.env, RELAY_NOT_BEFORE: startedAt.toISOString() },
        });
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error('crash-relay не завершився за 20 с'));
        }, 20_000);
        child.on('error', reject);
        child.on('exit', (code, signal) => {
            clearTimeout(timer);
            resolve({ code, signal });
        });
    });
}

void runDemo(async (demo, failures) => {
    const orders = await openOrdersService();
    try {
        const { productId, startedAt } = await prepareOutboxDemo(demo);

        // 1. Одне замовлення: рядок у orders і рядок у outbox одним COMMIT
        await orders.service.createIdempotent(demoDto(productId), `${OUTBOX_DEMO_KEY_PREFIX}crash-relay`);
        console.log('Замовлення створено, конверт лежить в outbox.');

        // 2. Перший relay виносить конверт у брокер і гине до UPDATE (справжній kill -9)
        const crash = await runCrashingRelay(startedAt);
        console.log(`Relay загинув аварійно (код ${crash.code}, сигнал ${crash.signal}).`);
        if (crash.code === 2) {
            failures.push('crash-relay не зміг стартувати (код 2), див. помилку вище');
        }
        if (crash.code === 0 && crash.signal === null) {
            failures.push('crash-relay завершився штатно, а мав загинути аварійно');
        }

        // 3. Наслідки: у брокері конверт є, а в outbox "винесено" не відмічено (транзакцію relay відкотило)
        const afterCrash = await snapshot(demo.pool, startedAt);
        const queuedAfterCrash = await queueDepth(demo.ch, QUEUE_ORDER_PLACED);
        console.log(
            `Після аварії: у брокері ${queuedAfterCrash}, відмічено винесеним в outbox ${afterCrash.published}.`,
        );

        // 4. Другий relay (перезапуск) не знає, що конверт уже поїхав, і відносить його ще раз
        const publisher = new EventPublisher();
        try {
            await relayUntil(demo.pool, publisher, startedAt, 1);
        } finally {
            await publisher.close().catch(() => undefined);
        }

        // 5. Консюмер отримує дві копії однієї події
        const probe = await startProbeConsumer(demo);
        await waitFor(() => probe.settled >= 2, 10_000);
        await sleep(500); // чекаємо: чи не прийде щось зайве
        await probe.stop();

        // 6. Протокол
        const snap = await snapshot(demo.pool, startedAt);
        printLines({
            published: snap.published,
            deliveries: probe.deliveries,
            applied: probe.applied,
            effect: snap.effect,
            processed: snap.processed,
        });

        // 7. Самоперевірка: доставлено щонайменше двічі, а ефект один
        expectEq(failures, 'у брокері після аварії', queuedAfterCrash, 1);
        expectEq(failures, 'відмічено винесеним після аварії', afterCrash.published, 0);
        if (probe.deliveries < 2) {
            failures.push(`deliveries: очікували >= 2, отримали ${probe.deliveries}`);
        }
        expectEq(failures, 'published', snap.published, 1);
        expectEq(failures, 'applied', probe.applied, 1);
        expectEq(failures, 'effect', snap.effect, 1);
        expectEq(failures, 'processed', snap.processed, 1);
    } finally {
        await orders.close().catch(() => undefined);
    }
});
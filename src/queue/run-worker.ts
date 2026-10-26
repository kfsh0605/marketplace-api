import { createPool } from '../outbox/pool';
import { queueConnectionOptions } from '../redis/connect';
import { OrderTasksQueue } from './order-tasks';
import { createOrderTasksWorker } from './order-tasks-worker';

const OUTBOX_RETENTION_DAYS = 7;
const DEFAULT_CLEANUP_EVERY_MS = 60 * 60 * 1000;

function readCleanupInterval(): number {
    const value = Number(process.env.OUTBOX_CLEANUP_EVERY_MS ?? DEFAULT_CLEANUP_EVERY_MS);
    if (!Number.isFinite(value) || value < 1000) {
        throw new Error('OUTBOX_CLEANUP_EVERY_MS має бути числом не менше 1000');
    }
    return value;
}

async function main(): Promise<void> {
    const cleanupEveryMs = readCleanupInterval();
    const pool = createPool(2);
    const tasks = new OrderTasksQueue(queueConnectionOptions('producer'));
    await tasks.upsertCleanupScheduler(cleanupEveryMs);

    const worker = createOrderTasksWorker(queueConnectionOptions('worker'), {
        sendReceipt: async (data, attempt) => {
            console.log(`[worker] чек для замовлення ${data.orderId} → ${data.customerEmail} (спроба ${attempt})`);
        },
        cleanupOutbox: async () => {
            const result = await pool.query(
                `DELETE FROM outbox
                 WHERE published_at IS NOT NULL
                   AND published_at < now() - make_interval(days => $1)`,
                [OUTBOX_RETENTION_DAYS],
            );
            console.log(
                `[worker] очистка outbox: видалено ${result.rowCount ?? 0} рядків, надісланих понад ${OUTBOX_RETENTION_DAYS} днів тому`,
            );
        },
    });

    worker.on('completed', (job) => console.log(`[worker] ${job.name} #${job.id} виконано`));
    worker.on('failed', (job, err) =>
        console.warn(`[worker] ${job?.name} #${job?.id} збій (спроба ${job?.attemptsMade}): ${err.message}`),
    );

    console.log(`worker запущено: планувальник очистки кожні ${cleanupEveryMs} мс`);

    let stopping = false;
    const shutdown = async () => {
        if (stopping) {
            return;
        }
        stopping = true;
        console.log('[worker] зупинка: чекаємо активні задачі...');
        await worker.close().catch(() => undefined);
        await tasks.close().catch(() => undefined);
        await pool.end().catch(() => undefined);
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((err) => {
    console.error('worker failed:', err);
    process.exit(1);
});
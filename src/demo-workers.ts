import 'reflect-metadata';
import { AppDataSource } from './data-source';
import { sleep } from './lib/sleep';

const JOB_COUNT = 12;
const WORKER_COUNT = 4;
const WORK_MS = 100;

async function claimOne(worker: string): Promise<'claimed' | 'empty'> {
    return AppDataSource.transaction(async (manager) => {
        const rows: { id: number }[] = await manager.query(
            `SELECT id FROM post_processing_jobs
             WHERE status = 'new' AND "orderId" IS NULL
             ORDER BY id
             LIMIT 1
             FOR UPDATE SKIP LOCKED`,
        );
        if (rows.length === 0) {
            return 'empty';
        }
        const jobId = rows[0].id;

        await sleep(WORK_MS); // імітація роботи — лок тримається весь цей час

        await manager.query(
            `UPDATE post_processing_jobs
             SET status = 'done', worker = $1, processed = processed + 1
             WHERE id = $2`,
            [worker, jobId],
        );
        return 'claimed';
    });
}

async function runWorker(name: string, stats: Record<string, number>): Promise<void> {
    stats[name] = 0;
    while (true) {
        const outcome = await claimOne(name);
        if (outcome === 'claimed') {
            stats[name]++;
            continue;
        }
        // 'empty' тут означає лише "вільних немає ЗАРАЗ", а не "черга порожня" —
        // перепитуємо реальний лічильник, перш ніж здаватися
        const remaining = await AppDataSource.query(
            `SELECT COUNT(*)::int AS cnt FROM post_processing_jobs
             WHERE status = 'new' AND "orderId" IS NULL`,
        );
        if (remaining[0].cnt === 0) break;
        await sleep(10);
    }
}

async function main() {
    await AppDataSource.initialize();

    // власний, ізольований набір задач — не залежимо від того, що вже лежить у черзі
    // після demo:race чи ручного тестування
    await AppDataSource.query(`DELETE FROM post_processing_jobs WHERE "orderId" IS NULL`);
    await AppDataSource.query(
        `INSERT INTO post_processing_jobs (status, "orderId") SELECT 'new', NULL FROM generate_series(1, $1)`,
        [JOB_COUNT],
    );

    console.log(`Задач у черзі: ${JOB_COUNT}, воркерів: ${WORKER_COUNT}, робота однієї задачі: ${WORK_MS} мс`);

    const stats: Record<string, number> = {};
    const start = Date.now();

    await Promise.all(
        Array.from({ length: WORKER_COUNT }, (_, i) => runWorker(`worker-${i + 1}`, stats)),
    );

    const elapsedMs = Date.now() - start;
    const sequentialMs = JOB_COUNT * WORK_MS;

    const check = await AppDataSource.query(
        `SELECT
            COUNT(*) FILTER (WHERE processed = 0)::int AS unprocessed,
            COUNT(*) FILTER (WHERE processed >= 2)::int AS double_processed
         FROM post_processing_jobs WHERE "orderId" IS NULL`,
    );
    const { unprocessed, double_processed: doubleProcessed } = check[0];

    console.log('Розподіл задач по воркерах:', stats);
    console.log(`Оброблено двічі: ${doubleProcessed}`);
    console.log(`Необроблено: ${unprocessed}`);
    console.log(`Час (паралельно): ${elapsedMs} мс`);
    console.log(`Час (послідовно, теоретично): ${sequentialMs} мс`);

    await AppDataSource.destroy();

    if (doubleProcessed > 0 || unprocessed > 0 || elapsedMs >= sequentialMs) {
        console.error('ІНВАРІАНТ ПОРУШЕНО.');
        process.exit(1);
    }
    console.log('OK: кожна задача оброблена рівно один раз, паралельно швидше за послідовне.');
    process.exit(0);
}

main().catch((err) => {
    console.error('demo:workers failed:', err);
    process.exit(1);
});
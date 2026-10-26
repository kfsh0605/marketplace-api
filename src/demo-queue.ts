import type { Worker } from 'bullmq';
import { expectAtLeast, expectEq, printLines, runStandalone, waitUntil } from './lib/demo-output';
import { sleep } from './lib/sleep';
import { OrderTasksQueue, receiptJobId } from './queue/order-tasks';
import { createOrderTasksWorker } from './queue/order-tasks-worker';
import { createQueueInstanceClient, queueConnectionOptions } from './redis/connect';

const DEMO_PREFIX = 'bull-demo';
const DEMO_ORDER_ID = 900001;
const FAILS_BEFORE_SUCCESS = 2;
const SCHEDULER_EVERY_MS = 500;
const OBSERVE_MS = 2600;

async function stateOf(tasks: OrderTasksQueue, jobId: string): Promise<string> {
    const job = await tasks.queue.getJob(jobId);
    return job ? job.getState() : 'missing';
}

void runStandalone(async (failures) => {
    const redis = await createQueueInstanceClient();
    const tasks = new OrderTasksQueue(queueConnectionOptions('producer'), {
        prefix: DEMO_PREFIX,
        backoffDelayMs: 200,
    });
    let worker: Worker | undefined;

    try {
        const policyReply = (await redis.call('CONFIG', 'GET', 'maxmemory-policy')) as string[];
        const policy = policyReply[1];

        await tasks.queue.obliterate({ force: true });

        const data = { orderId: DEMO_ORDER_ID, customerEmail: 'queue-demo@example.com' };
        let added = 0;
        await tasks.enqueueReceipt(data);
        added++;
        await tasks.enqueueReceipt(data);
        added++;
        const counts = await tasks.queue.getJobCounts('waiting', 'delayed', 'active', 'prioritized');
        const queued = counts.waiting + counts.delayed + counts.active + counts.prioritized;

        let attempts = 0;
        let scheduledRuns = 0;
        worker = createOrderTasksWorker(
            queueConnectionOptions('worker'),
            {
                sendReceipt: async () => {
                    attempts++;
                    if (attempts <= FAILS_BEFORE_SUCCESS) {
                        throw new Error('поштовий провайдер повернув 503');
                    }
                },
                cleanupOutbox: async () => {
                    scheduledRuns++;
                },
            },
            { prefix: DEMO_PREFIX },
        );

        const jobId = receiptJobId(DEMO_ORDER_ID);
        await waitUntil(async () => (await stateOf(tasks, jobId)) === 'completed', 15_000);
        const completed = (await stateOf(tasks, jobId)) === 'completed' ? 1 : 0;

        await tasks.upsertCleanupScheduler(SCHEDULER_EVERY_MS);
        await tasks.upsertCleanupScheduler(SCHEDULER_EVERY_MS);
        const schedulers = await tasks.schedulerCount();
        await sleep(OBSERVE_MS);
        const runs = scheduledRuns;

        printLines({
            'queue-noeviction': policy === 'noeviction' ? 1 : 0,
            attempts,
            completed,
            added,
            queued,
            schedulers,
            'scheduled-runs': runs,
        });

        expectEq(failures, 'queue-noeviction', policy === 'noeviction', true);
        expectAtLeast(failures, 'attempts', attempts, 3);
        expectEq(failures, 'completed', completed, 1);
        expectEq(failures, 'added', added, 2);
        expectEq(failures, 'queued', queued, 1);
        expectEq(failures, 'schedulers', schedulers, 1);
        expectAtLeast(failures, 'scheduled-runs', runs, 2);
    } finally {
        await worker?.close().catch(() => undefined);
        await tasks.queue.obliterate({ force: true }).catch(() => undefined);
        await tasks.close().catch(() => undefined);
        await redis.quit().catch(() => undefined);
    }
});
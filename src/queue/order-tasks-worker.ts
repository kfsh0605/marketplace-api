import { Worker } from 'bullmq';
import type { ConnectionOptions, Job } from 'bullmq';
import { JOB_OUTBOX_CLEANUP, JOB_SEND_RECEIPT, QUEUE_NAME, ReceiptJobData } from './order-tasks';

export interface TaskHandlers {
    sendReceipt(data: ReceiptJobData, attempt: number): Promise<void>;
    cleanupOutbox(): Promise<void>;
}

export interface TaskWorkerOptions {
    name?: string;
    prefix?: string;
    concurrency?: number;
}

export function createOrderTasksWorker(
    connection: ConnectionOptions,
    handlers: TaskHandlers,
    options: TaskWorkerOptions = {},
): Worker {
    const worker = new Worker(
        options.name ?? QUEUE_NAME,
        async (job: Job) => {
            switch (job.name) {
                case JOB_SEND_RECEIPT:
                    await handlers.sendReceipt(job.data as ReceiptJobData, job.attemptsMade + 1);
                    return;
                case JOB_OUTBOX_CLEANUP:
                    await handlers.cleanupOutbox();
                    return;
                default:
                    throw new Error(`невідомий тип задачі: ${job.name}`);
            }
        },
        {
            connection,
            concurrency: options.concurrency ?? 5,
            ...(options.prefix ? { prefix: options.prefix } : {}),
        },
    );
    worker.on('error', (err) => console.warn(`worker: ${err.message}`));
    return worker;
}
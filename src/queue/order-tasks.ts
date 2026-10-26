import { Queue } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';

export const QUEUE_NAME = 'order-tasks';
export const JOB_SEND_RECEIPT = 'send-receipt';
export const JOB_OUTBOX_CLEANUP = 'outbox-cleanup';
export const SCHEDULER_OUTBOX_CLEANUP = 'outbox-cleanup-scheduler';

export const RECEIPT_ATTEMPTS = 5;
export const RECEIPT_BACKOFF_DELAY_MS = 1000;
export const RECEIPT_BACKOFF_JITTER = 0.5;

const COMPLETED_KEEP_SEC = 24 * 3600;
const FAILED_KEEP_SEC = 7 * 24 * 3600;

export interface ReceiptJobData {
    orderId: number;
    customerEmail: string;
}

export const receiptJobId = (orderId: number): string => `receipt-order-${orderId}`;

export interface TaskQueueOptions {
    name?: string;
    prefix?: string;
    backoffDelayMs?: number;
}

export class OrderTasksQueue {
    readonly queue: Queue;
    private readonly backoffDelayMs: number;

    constructor(connection: ConnectionOptions, options: TaskQueueOptions = {}) {
        this.queue = new Queue(options.name ?? QUEUE_NAME, {
            connection,
            ...(options.prefix ? { prefix: options.prefix } : {}),
        });
        this.queue.on('error', (err) => console.warn(`queue: ${err.message}`));
        this.backoffDelayMs = options.backoffDelayMs ?? RECEIPT_BACKOFF_DELAY_MS;
    }

    async enqueueReceipt(data: ReceiptJobData): Promise<void> {
        await this.queue.add(JOB_SEND_RECEIPT, data, {
            jobId: receiptJobId(data.orderId),
            attempts: RECEIPT_ATTEMPTS,
            backoff: { type: 'exponential', delay: this.backoffDelayMs, jitter: RECEIPT_BACKOFF_JITTER },
            removeOnComplete: { age: COMPLETED_KEEP_SEC },
            removeOnFail: { age: FAILED_KEEP_SEC },
        });
    }

    async upsertCleanupScheduler(everyMs: number): Promise<void> {
        await this.queue.upsertJobScheduler(
            SCHEDULER_OUTBOX_CLEANUP,
            { every: everyMs },
            {
                name: JOB_OUTBOX_CLEANUP,
                data: {},
                opts: { removeOnComplete: true, removeOnFail: { age: FAILED_KEEP_SEC } },
            },
        );
    }

    schedulerCount(): Promise<number> {
        return this.queue.getJobSchedulersCount();
    }

    async close(): Promise<void> {
        await this.queue.close();
    }
}
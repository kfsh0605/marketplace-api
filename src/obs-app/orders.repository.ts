import { SpanStatusCode, trace } from '@opentelemetry/api';
import { randomUUID } from 'node:crypto';
import { sleep } from '../lib/sleep';
import { createLogger } from '../observability/logger';

export interface OrderItem {
    sku: string;
    qty: number;
}

export interface Order {
    id: string;
    userId: string;
    items: OrderItem[];
    total: number;
}

const log = createLogger('orders.repo');
const tracer = trace.getTracer('marketplace-api');

async function inSpan<T>(name: string, work: () => Promise<T>): Promise<T> {
    return tracer.startActiveSpan(name, async (span) => {
        try {
            return await work();
        } catch (error) {
            span.recordException(error as Error);
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            span.end();
        }
    });
}

export class OrdersRepository {
    private readonly orders = new Map<string, Order>();
    private readonly byKey = new Map<string, string>();

    findById(id: string): Promise<Order | undefined> {
        return inSpan('db.query orders.findById', async () => {
            await sleep(5 + Math.random() * 20);
            if (id === 'boom') {
                throw new Error('db connection lost');
            }
            log.info({ orderId: id }, 'order fetched');
            if (id === 'missing') {
                return undefined;
            }
            return this.orders.get(id) ?? { id, userId: 'seed', items: [], total: 0 };
        });
    }

    save(order: Omit<Order, 'id'>, idempotencyKey?: string): Promise<{ order: Order; replayed: boolean }> {
        return inSpan('db.query orders.insert', async () => {
            await sleep(20 + Math.random() * 40);
            const knownId = idempotencyKey ? this.byKey.get(idempotencyKey) : undefined;
            const known = knownId ? this.orders.get(knownId) : undefined;
            if (known) {
                log.info({ orderId: known.id }, 'order replayed');
                return { order: known, replayed: true };
            }
            const saved: Order = { id: randomUUID(), ...order };
            this.orders.set(saved.id, saved);
            if (idempotencyKey) {
                this.byKey.set(idempotencyKey, saved.id);
            }
            log.info({ orderId: saved.id }, 'order saved');
            return { order: saved, replayed: false };
        });
    }
}
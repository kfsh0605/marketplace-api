import type { Channel, ConsumeMessage } from 'amqplib';
import type { OrderPlacedEvent } from './events';
import { PREFETCH, QUEUE_ORDER_PLACED, ROUTING_KEY_ORDER_PLACED } from './rabbitmq.config';

export interface EffectStore {
    query(sql: string, params?: unknown[]): Promise<any>;
}

export interface DeliveryInfo {
    eventId: string | null;
    redelivered: boolean;
    deliveryCount: number;
}

export type SettledOutcome = 'acked' | 'skipped' | 'dead' | 'requeued' | 'failed';

export interface ConsumerOptions {
    prefetch?: number;
    onDelivery?: (info: DeliveryInfo) => void;
    afterEffect?: (info: DeliveryInfo, applied: boolean) => 'requeue' | void;
    onSettled?: (result: { eventId: string | null; outcome: SettledOutcome; durationMs: number }) => void;
}

export async function applyOrderPlacedEffect(store: EffectStore, event: OrderPlacedEvent): Promise<boolean> {
    const rows = await store.query(
        `INSERT INTO processed_order_events ("eventId", "orderId") VALUES ($1, $2)
         ON CONFLICT ("eventId") DO NOTHING
         RETURNING "eventId"`,
        [event.eventId, event.data.orderId],
    );
    return Array.isArray(rows) && rows.length > 0;
}

function parseOrderPlaced(msg: ConsumeMessage): OrderPlacedEvent | null {
    try {
        const body = JSON.parse(msg.content.toString('utf8'));
        if (
            typeof body?.eventId === 'string' &&
            body.type === ROUTING_KEY_ORDER_PLACED &&
            Number.isInteger(body?.data?.orderId)
        ) {
            return body as OrderPlacedEvent;
        }
    } catch {
    }
    return null;
}

export async function startOrderPlacedConsumer(
    ch: Channel,
    store: EffectStore,
    options: ConsumerOptions = {},
): Promise<{ consumerTag: string; prefetch: number }> {
    const prefetch = options.prefetch ?? PREFETCH;

    await ch.prefetch(prefetch);

    const { consumerTag } = await ch.consume(
        QUEUE_ORDER_PLACED,
        (msg) => {
            if (msg) {
                void handleMessage(ch, store, msg, options);
            }
        },
        { noAck: false },
    );

    return { consumerTag, prefetch };
}

async function handleMessage(
    ch: Channel,
    store: EffectStore,
    msg: ConsumeMessage,
    options: ConsumerOptions,
): Promise<void> {
    const started = Date.now();
    const event = parseOrderPlaced(msg);
    const info: DeliveryInfo = {
        eventId: event?.eventId ?? null,
        redelivered: msg.fields.redelivered,
        deliveryCount: Number(msg.properties.headers?.['x-delivery-count'] ?? 0) + 1,
    };
    const settle = (outcome: SettledOutcome) =>
        options.onSettled?.({ eventId: info.eventId, outcome, durationMs: Date.now() - started });

    options.onDelivery?.(info);

    try {
        if (!event) {
            // Отруйне повідомлення: повтор не допоможе. reject БЕЗ requeue → DLX → DLQ (reason: rejected)
            ch.reject(msg, false);
            settle('dead');
            return;
        }

        const applied = await applyOrderPlacedEffect(store, event);

        if (options.afterEffect?.(info, applied) === 'requeue') {
            ch.reject(msg, true);
            settle('requeued');
            return;
        }

        ch.ack(msg);
        settle(applied ? 'acked' : 'skipped');
    } catch (err) {
        console.error(`[consumer] помилка обробки ${info.eventId}: ${(err as Error).message}`);
        try {
            ch.reject(msg, true);
        } catch {
        }
        settle('failed');
    }
}
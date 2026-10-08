import type { Channel } from 'amqplib';
import {
    DELIVERY_LIMIT,
    EXCHANGE_DLX,
    EXCHANGE_EVENTS,
    EXCHANGE_UNROUTED,
    QUEUE_ORDER_PLACED,
    QUEUE_ORDER_PLACED_DLQ,
    QUEUE_UNROUTED,
    ROUTING_KEY_ORDER_PLACED,
    ROUTING_KEY_ORDER_PLACED_DEAD,
} from './rabbitmq.config';

/**
 * Порядок оголошення — від залежностей до головного:
 * запасний вихід → брак → головний контур. Головний exchange і черга
 * посилаються на перші два за іменем, тому вони мають існувати раніше.
 * Викликає той, хто споживає (або bootstrap), а НЕ продюсер.
 */
export async function assertTopology(ch: Channel): Promise<void> {
    // 1. Контур "лист без адреси": alternate exchange ловить усе, що не знайшло черги
    await ch.assertExchange(EXCHANGE_UNROUTED, 'fanout', { durable: true });
    await ch.assertQueue(QUEUE_UNROUTED, {
        durable: true,
        arguments: { 'x-queue-type': 'quorum' },
    });
    await ch.bindQueue(QUEUE_UNROUTED, EXCHANGE_UNROUTED, '');

    // 2. Контур "брак": DLX + DLQ. Це окремий контур, а не смітник
    await ch.assertExchange(EXCHANGE_DLX, 'direct', { durable: true });
    await ch.assertQueue(QUEUE_ORDER_PLACED_DLQ, {
        durable: true,
        arguments: { 'x-queue-type': 'quorum' },
    });
    await ch.bindQueue(QUEUE_ORDER_PLACED_DLQ, EXCHANGE_DLX, ROUTING_KEY_ORDER_PLACED_DEAD);

    // 3. Головний контур: topic exchange (з alternate exchange) → черга → binding
    await ch.assertExchange(EXCHANGE_EVENTS, 'topic', {
        durable: true,
        alternateExchange: EXCHANGE_UNROUTED,
    });
    await ch.assertQueue(QUEUE_ORDER_PLACED, {
        durable: true,
        arguments: {
            'x-queue-type': 'quorum', // classic з 4.0 не реплікується; delivery-limit є лише в quorum
            'x-dead-letter-exchange': EXCHANGE_DLX, // куди йде брак
            'x-dead-letter-routing-key': ROUTING_KEY_ORDER_PLACED_DEAD,
            'x-delivery-limit': DELIVERY_LIMIT, // скільки повернень, потім DLQ (reason: delivery_limit)
            'x-dead-letter-strategy': 'at-least-once', // брокер тримає повідомлення, доки DLQ не підтвердить
            'x-overflow': 'reject-publish', // ОБОВ'ЯЗКОВА пара до at-least-once, інакше мовчазний відкат
        },
    });
    await ch.bindQueue(QUEUE_ORDER_PLACED, EXCHANGE_EVENTS, ROUTING_KEY_ORDER_PLACED);
}
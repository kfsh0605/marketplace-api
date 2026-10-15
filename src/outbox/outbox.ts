import type { EntityManager } from 'typeorm';
import { buildOrderPlacedEvent } from '../messaging/events';
import type { OrderPlacedEvent } from '../messaging/events';

export const AGGREGATE_ORDER = 'Order';

/**
 * Кладёт событие order.placed в outbox ВНУТРИ уже открытой транзакции.
 * `manager` обязан быть тем самым, которым сохранялся заказ: тогда это тот же коннект и тот же COMMIT.
 * Брокер здесь не участвует вообще, его дело relay.
 */
export async function enqueueOrderPlaced(
    manager: EntityManager,
    data: OrderPlacedEvent['data'],
): Promise<OrderPlacedEvent> {
    const event = buildOrderPlacedEvent(data);
    await manager.query(
        `INSERT INTO outbox (aggregate_type, aggregate_id, type, payload)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [AGGREGATE_ORDER, String(data.orderId), event.type, JSON.stringify(event)],
    );
    return event;
}
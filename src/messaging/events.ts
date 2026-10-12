import { ROUTING_KEY_ORDER_PLACED } from './rabbitmq.config';

/**
 * Контракт події "замовлення оформлено". Це НЕ ORM-сутність: поля обрані
 * свідомо, щоб зміна схеми БД не ламала підписників.
 */
export interface OrderPlacedEvent {
    /** Стабільний ідентифікатор події: за ним споживач відсіює дублі */
    eventId: string;
    type: typeof ROUTING_KEY_ORDER_PLACED;
    occurredAt: string;
    data: {
        orderId: number;
        customerEmail: string;
        totalCents: number;
        currency: string;
        items: Array<{ productId: number; quantity: number }>;
    };
}

/**
 * eventId детермінований від orderId: повторна публікація тієї ж події
 * отримує ТОЙ САМИЙ id (випадковий randomUUID тут був би помилкою).
 */
export function orderPlacedEventId(orderId: number): string {
    return `order-placed:${orderId}`;
}

export function buildOrderPlacedEvent(input: OrderPlacedEvent['data'], occurredAt: Date = new Date()): OrderPlacedEvent {
    return {
        eventId: orderPlacedEventId(input.orderId),
        type: ROUTING_KEY_ORDER_PLACED,
        occurredAt: occurredAt.toISOString(),
        data: {
            orderId: input.orderId,
            customerEmail: input.customerEmail,
            totalCents: input.totalCents,
            currency: input.currency,
            items: input.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        },
    };
}
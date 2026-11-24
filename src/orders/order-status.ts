export const ORDER_STATUSES = ['created', 'pending', 'paid', 'packed', 'shipped', 'delivered', 'cancelled'] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Життєвий цикл замовлення: з якого статусу в які можна перейти.
 *
 * created    прийнято API (POST /orders), подію order.placed ще не оброблено
 * pending    подію оброблено consumer-ом (фонова частина відпрацювала), чекаємо оплату
 * paid       оплачено; checkout() створює замовлення одразу в цьому статусі
 * packed, shipped   виконання
 * delivered, cancelled   кінцеві: з них нікуди
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
    created: ['pending', 'paid', 'cancelled'],
    pending: ['paid', 'cancelled'],
    paid: ['packed', 'cancelled'],
    packed: ['shipped'],
    shipped: ['delivered'],
    delivered: [],
    cancelled: [],
};

export function canTransition(from: string, to: string): boolean {
    return (ORDER_TRANSITIONS[from as OrderStatus] ?? []).includes(to as OrderStatus);
}

/**
 * Статуси, з яких дозволено перейти в `to`.
 * Потрібні для атомарного UPDATE ... WHERE status IN (...): перевірка і зміна одним оператором.
 */
export function statusesBefore(to: OrderStatus): OrderStatus[] {
    return ORDER_STATUSES.filter((from) => ORDER_TRANSITIONS[from].includes(to));
}

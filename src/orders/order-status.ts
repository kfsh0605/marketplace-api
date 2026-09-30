export const ORDER_STATUSES = ['created', 'pending', 'paid', 'packed', 'shipped', 'delivered', 'cancelled'] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];
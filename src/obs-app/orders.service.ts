import { createLogger } from '../observability/logger';
import { getContext } from '../observability/request-context';
import { Order, OrderItem, OrdersRepository } from './orders.repository';

export class HttpError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
    }
}

const log = createLogger('orders.service');

export class OrdersService {
    constructor(private readonly repository: OrdersRepository) {}

    async getOrder(id: string): Promise<Order> {
        log.info({ orderId: id }, 'loading order');
        const order = await this.repository.findById(id);
        if (!order) {
            throw new HttpError(404, 'order not found');
        }
        return order;
    }

    async checkout(userId: string, items: OrderItem[]) {
        if (!Array.isArray(items) || items.length === 0) {
            throw new HttpError(400, 'items are required');
        }
        const total = items.reduce((sum, item) => sum + item.qty * 10, 0);
        log.info({ items: items.length, total }, 'checkout started');
        return this.repository.save({ userId, items, total }, getContext().idempotencyKey);
    }
}
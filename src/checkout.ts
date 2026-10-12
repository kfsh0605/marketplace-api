import { DataSource } from 'typeorm';
import { AppDataSource } from './data-source';
import { Product } from './entities/product.entity';
import { User } from './entities/user.entity';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { PostProcessingJob } from './entities/post-processing-job.entity';
import { publishOrderPlaced } from './messaging/publish-order-placed';
import type { OrderPlacedSink } from './messaging/publish-order-placed';

const CHECKOUT_CURRENCY = 'UAH';

export class InsufficientStockError extends Error {
    constructor(productId: number) {
        super(`Insufficient stock for product ${productId}`);
        this.name = 'InsufficientStockError';
    }
}

export class InsufficientFundsError extends Error {
    constructor(userId: number) {
        super(`Insufficient balance for user ${userId}`);
        this.name = 'InsufficientFundsError';
    }
}

export interface CheckoutDeps {
    /**
     * Куди публікувати order.placed. Параметр обов'язковий навмисно: checkout() — другий шлях
     * створення замовлення (поряд з POST /orders), і мовчазне "не публікувати" було б тим самим
     * дефектом, що вже траплявся. null — свідомо вимкнено (demo:race не потребує брокера).
     */
    publisher: OrderPlacedSink | null;
    /** Для тестів: власний DataSource (testcontainers). За замовчуванням AppDataSource. */
    dataSource?: DataSource;
}

export async function checkout(
    userId: number,
    productId: number,
    quantity: number,
    deps: CheckoutDeps,
): Promise<{ orderId: number }> {
    if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new Error(`quantity must be a positive integer, got ${quantity}`);
    }

    const dataSource = deps.dataSource ?? AppDataSource;

    const placed = await dataSource.transaction(async (manager) => {
        // 1. атомарно уменьшаем stock и в том же движении узнаём цену товара
        const stockResult = await manager
            .createQueryBuilder()
            .update(Product)
            .set({ stock: () => '"stock" - :qty' })
            .where('"id" = :productId AND "stock" >= :qty', { productId, qty: quantity })
            .returning(['priceCents'])
            .execute();

        if (stockResult.affected === 0) {
            throw new InsufficientStockError(productId);
        }
        const priceCents: number = stockResult.raw[0].priceCents;
        const totalCents = priceCents * quantity;

        // 2. атомарно списываем баланс покупателя
        const balanceResult = await manager
            .createQueryBuilder()
            .update(User)
            .set({ balanceCents: () => '"balanceCents" - :amount' })
            .where('"id" = :userId AND "balanceCents" >= :amount', { userId, amount: totalCents })
            .returning(['email'])
            .execute();

        if (balanceResult.affected === 0) {
            throw new InsufficientFundsError(userId);
        }
        const customerEmail: string = balanceResult.raw[0].email;

        // 3. записываем сам заказ и его позицию
        const order = await manager.save(
            manager.create(Order, {
                user: { id: userId } as User,
                customerEmail,
                status: 'paid',
                totalCents,
                currency: CHECKOUT_CURRENCY,
            }),
        );

        await manager.save(
            manager.create(OrderItem, {
                order,
                product: { id: productId } as Product,
                quantity,
                priceAtPurchaseCents: priceCents,
            }),
        );

        // 4. кладём "талончик" на постобработку — письмо/чек сделает воркер отдельно
        await manager.save(
            manager.create(PostProcessingJob, { order }),
        );

        return { orderId: order.id, customerEmail, totalCents };
    });

    // 5. ПІСЛЯ коміту: та сама подія order.placed, що й у POST /orders (спільний publishOrderPlaced)
    if (deps.publisher) {
        await publishOrderPlaced(deps.publisher, {
            orderId: placed.orderId,
            customerEmail: placed.customerEmail,
            totalCents: placed.totalCents,
            currency: CHECKOUT_CURRENCY,
            items: [{ productId, quantity }],
        });
    }

    return { orderId: placed.orderId };
}
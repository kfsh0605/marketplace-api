import { AppDataSource } from './data-source';
import { Product } from './entities/product.entity';
import { User } from './entities/user.entity';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { PostProcessingJob } from './entities/post-processing-job.entity';

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

export async function checkout(
    userId: number,
    productId: number,
    quantity: number,
): Promise<{ orderId: number }> {
    if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new Error(`quantity must be a positive integer, got ${quantity}`);
    }

    return AppDataSource.transaction(async (manager) => {
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
                currency: 'UAH',
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

        return { orderId: order.id };
    });
}
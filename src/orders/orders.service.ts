import { BadRequestException, Injectable, NotFoundException, Optional, UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'crypto';
import { ProductCardService } from '../products/product-card.service';
import { InjectRepository } from '@nestjs/typeorm';
import { enqueueOrderPlaced } from '../outbox/outbox';
import { EntityManager, MoreThan, Repository } from 'typeorm';
import { Order as OrderEntity } from '../entities/order.entity';
import { OrderItem as OrderItemEntity } from '../entities/order-item.entity';
import { Product as ProductEntity } from '../entities/product.entity';
import { decodeCursor, encodeCursor, PaginatedResult } from '../common/pagination';
import { CreateOrderDto } from './dto/create-order.dto';
import { Order } from './order';
import { OrderEventsService } from './order-events.service';

@Injectable()
export class OrdersService {
    constructor(
        @InjectRepository(OrderEntity)
        private readonly orderRepo: Repository<OrderEntity>,
        private readonly orderEventsService: OrderEventsService,
        @Optional() private readonly productCards?: ProductCardService,
    ) {}

    async findAll(limit: number, cursor?: string): Promise<PaginatedResult<Order>> {
        const decoded = cursor ? decodeCursor(cursor) : null;
        const afterId = decoded ? Number(decoded.id) : 0;

        const rows = await this.orderRepo.find({
            where: afterId ? { id: MoreThan(afterId) } : {},
            order: { id: 'ASC' },
            take: limit + 1,
            relations: ['items', 'items.product'],
        });

        const hasMore = rows.length > limit;
        const page = rows.slice(0, limit);
        const lastItem = page[page.length - 1];
        const next_cursor = hasMore && lastItem ? encodeCursor(String(lastItem.id)) : null;

        return { items: page.map((o) => this.toResponse(o)), next_cursor };
    }

    async findOne(orderId: string): Promise<Order> {
        const id = Number(orderId);
        const entity = Number.isNaN(id)
            ? null
            : await this.orderRepo.findOne({ where: { id }, relations: ['items', 'items.product'] });
        if (!entity) {
            throw new NotFoundException(`Order ${orderId} not found`);
        }
        return this.toResponse(entity);
    }

    async create(dto: CreateOrderDto): Promise<Order> {
        const saved = await this.orderRepo.manager.transaction((manager) => this.insertOrderWithEvent(manager, dto));
        await this.invalidateCards(saved);
        return this.toResponse(saved);
    }

    /**
     * POST /orders с Idempotency-Key. Ключ ИДЕНТИФИЦИРУЕТ НАМЕРЕНИЕ клиента, а не тело запроса:
     * два одинаковых, но осознанных заказа приходят с разными ключами и остаются двумя заказами.
     * request_hash нужен лишь чтобы поймать ошибку клиента: тот же ключ с другим телом.
     */
    async createIdempotent(
        dto: CreateOrderDto,
        idempotencyKey: string,
    ): Promise<{ order: Order; replayed: boolean }> {
        const requestHash = createHash('sha256').update(JSON.stringify(dto ?? null)).digest('hex');

        const outcome = await this.orderRepo.manager.transaction(async (manager) => {
            // 1. Занимаем номерок. Если другой запрос с этим ключом ещё в полёте, этот INSERT
            //    ЖДЁТ его конца (уникальный индекс), а потом либо видит конфликт, либо вставляет сам.
            const claimed: unknown[] = await manager.query(
                `INSERT INTO idempotency_keys (idempotency_key, request_hash) VALUES ($1, $2)
                 ON CONFLICT (idempotency_key) DO NOTHING
                 RETURNING idempotency_key`,
                [idempotencyKey, requestHash],
            );

            if (claimed.length === 0) {
                // Номерок уже занят закоммиченным запросом: читаем, какой заказ ему соответствует
                const rows: Array<{ request_hash: string; order_id: number }> = await manager.query(
                    `SELECT request_hash, order_id FROM idempotency_keys WHERE idempotency_key = $1`,
                    [idempotencyKey],
                );
                return { kind: 'replay' as const, existing: rows[0] };
            }

            // 2. Мы первые: бизнес-запись + событие в outbox + связь номерка с заказом, ОДИН COMMIT
            const saved = await this.insertOrderWithEvent(manager, dto);
            await manager.query(`UPDATE idempotency_keys SET order_id = $1 WHERE idempotency_key = $2`, [
                saved.id,
                idempotencyKey,
            ]);
            return { kind: 'created' as const, saved };
        });

        if (outcome.kind === 'created') {
            await this.invalidateCards(outcome.saved);
            return { order: this.toResponse(outcome.saved), replayed: false };
        }
        if (outcome.existing.request_hash !== requestHash) {
            throw new UnprocessableEntityException('Idempotency-Key already used with a different request body');
        }
        return { order: await this.findOne(String(outcome.existing.order_id)), replayed: true };
    }

    /** Бизнес-запись заказа и строка outbox: одна транзакция (manager приходит снаружи). */
    private async insertOrderWithEvent(manager: EntityManager, dto: CreateOrderDto): Promise<OrderEntity> {
        let totalCents = 0;
        let currency = 'UAH';
        const items: OrderItemEntity[] = [];

        for (const item of dto.items) {
            const productId = Number(item.productId);
            const product = Number.isNaN(productId)
                ? null
                : await manager.findOneBy(ProductEntity, { id: productId });
            if (!product) {
                throw new BadRequestException(`Product ${item.productId} not found`);
            }

            currency = product.currency;
            totalCents += product.priceCents * item.quantity;

            const orderItem = new OrderItemEntity();
            orderItem.product = product;
            orderItem.quantity = item.quantity;
            orderItem.priceAtPurchaseCents = product.priceCents;
            items.push(orderItem);
        }

        const order = new OrderEntity();
        order.customerEmail = dto.customerEmail;
        order.status = 'created';
        order.totalCents = totalCents;
        order.currency = currency;
        order.items = items;

        const saved = await manager.save(OrderEntity, order);

        await enqueueOrderPlaced(manager, {
            orderId: saved.id,
            customerEmail: saved.customerEmail,
            totalCents: saved.totalCents,
            currency: saved.currency,
            items: saved.items.map((i) => ({ productId: i.product.id, quantity: i.quantity })),
        });

        return saved;
    }
    private async invalidateCards(order: OrderEntity): Promise<void> {
        if (!this.productCards) {
            return;
        }
        const productIds = new Set(order.items.map((item) => item.product.id));
        await Promise.all([...productIds].map((id) => this.productCards.invalidate(id)));
    }

    async updateStatus(orderId: string, status: string): Promise<Order> {
        const id = Number(orderId);
        if (Number.isNaN(id)) {
            throw new NotFoundException(`Order ${orderId} not found`);
        }

        const result = await this.orderRepo
            .createQueryBuilder()
            .update(OrderEntity)
            .set({ status })
            .where('id = :id', { id })
            .execute();

        if (result.affected === 0) {
            throw new NotFoundException(`Order ${orderId} not found`);
        }

        // Emit йде звідси, з бізнес-логіки зміни статусу, а не з контролера напряму —
        // саме тут відбувається "факт" зміни, і саме тут ми на 100% знаємо, що UPDATE реально застосувався.
        this.orderEventsService.emitStatusChanged(id, status);

        return this.findOne(orderId);
    }

    async isOrderOwnedByUser(orderId: number, userId: number): Promise<boolean> {
        const rows: unknown[] = await this.orderRepo.query(
            `SELECT 1 FROM orders WHERE id = $1 AND "userId" = $2`,
            [orderId, userId],
        );
        return rows.length > 0;
    }

    private toResponse(entity: OrderEntity): Order {
        return {
            id: String(entity.id),
            items: (entity.items ?? []).map((item) => ({
                productId: String(item.product.id),
                quantity: item.quantity,
            })),
            totalCents: entity.totalCents,
            currency: entity.currency,
            status: entity.status,
        };
    }
}
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { Order as OrderEntity } from '../entities/order.entity';
import { OrderItem as OrderItemEntity } from '../entities/order-item.entity';
import { Product as ProductEntity } from '../entities/product.entity';
import { decodeCursor, encodeCursor, PaginatedResult } from '../common/pagination';
import { CreateOrderDto } from './dto/create-order.dto';
import { Order } from './order';

@Injectable()
export class OrdersService {
    constructor(
        @InjectRepository(OrderEntity)
        private readonly orderRepo: Repository<OrderEntity>,
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
        return this.orderRepo.manager.transaction(async (manager) => {
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

            return this.toResponse(await manager.save(OrderEntity, order));
        });
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
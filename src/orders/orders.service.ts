import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { paginate, PaginatedResult } from '../common/pagination';
import { ProductsService } from '../products/products.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { Order } from './order';

@Injectable()
export class OrdersService {
    private readonly orders: Order[] = [];
    private nextOrderId = 1;

    constructor(private readonly productsService: ProductsService) {}

    findAll(limit: number, cursor?: string): PaginatedResult<Order> {
        return paginate(this.orders, { limit, cursor });
    }

    findOne(orderId: string): Order {
        const order = this.orders.find((o) => o.id === orderId);
        if (!order) {
            throw new NotFoundException(`Order ${orderId} not found`);
        }
        return order;
    }

    create(dto: CreateOrderDto): Order {
        let totalCents = 0;
        let currency: string | null = null;

        for (const item of dto.items) {
            let product;
            try {
                product = this.productsService.findOne(item.productId);
            } catch {
                throw new BadRequestException(`Product ${item.productId} not found`);
            }
            if (currency === null) {
                currency = product.currency;
            }
            totalCents += product.priceCents * item.quantity;
        }

        const order: Order = {
            id: `o-${this.nextOrderId++}`,
            items: dto.items,
            totalCents,
            currency: currency ?? 'UAH',
            status: 'created',
        };

        this.orders.push(order);
        return order;
    }
}
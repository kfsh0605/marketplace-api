import { Injectable, NotFoundException } from '@nestjs/common';
import { paginate, PaginatedResult } from '../common/pagination';
import { Product } from './product';

@Injectable()
export class ProductsService {
    private readonly products: Product[] = [
        { id: 'p-1', name: 'Клавіатура', priceCents: 45000, currency: 'UAH' },
        { id: 'p-2', name: 'Мишка', priceCents: 15000, currency: 'UAH' },
        { id: 'p-3', name: 'Монітор', priceCents: 850000, currency: 'UAH' },
    ];

    findAll(limit: number, cursor?: string): PaginatedResult<Product> {
        return paginate(this.products, { limit, cursor });
    }

    findOne(productId: string): Product {
        const product = this.products.find((p) => p.id === productId);
        if (!product) {
            throw new NotFoundException(`Product ${productId} not found`);
        }
        return product;
    }
}
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { Product as ProductEntity } from '../entities/product.entity';
import { decodeCursor, encodeCursor, PaginatedResult } from '../common/pagination';
import { Product } from './product';

@Injectable()
export class ProductsService {
    constructor(
        @InjectRepository(ProductEntity)
        private readonly repo: Repository<ProductEntity>,
    ) {}

    async findAll(limit: number, cursor?: string): Promise<PaginatedResult<Product>> {
        const decoded = cursor ? decodeCursor(cursor) : null;
        const afterId = decoded ? Number(decoded.id) : 0;

        const rows = await this.repo.find({
            where: afterId ? { id: MoreThan(afterId) } : {},
            order: { id: 'ASC' },
            take: limit + 1,
        });

        const hasMore = rows.length > limit;
        const page = rows.slice(0, limit);
        const lastItem = page[page.length - 1];
        const next_cursor = hasMore && lastItem ? encodeCursor(String(lastItem.id)) : null;

        return { items: page.map((p) => this.toResponse(p)), next_cursor };
    }

    async findOne(productId: string): Promise<Product> {
        const id = Number(productId);
        const entity = Number.isNaN(id) ? null : await this.repo.findOneBy({ id });
        if (!entity) {
            throw new NotFoundException(`Product ${productId} not found`);
        }
        return this.toResponse(entity);
    }

    private toResponse(entity: ProductEntity): Product {
        return {
            id: String(entity.id),
            name: entity.name,
            priceCents: entity.priceCents,
            currency: entity.currency,
        };
    }
}
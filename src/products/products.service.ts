import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, QueryFailedError, Repository } from 'typeorm';
import { Product as ProductEntity } from '../entities/product.entity';
import { decodeCursor, encodeCursor, PaginatedResult } from '../common/pagination';
import { CreateProductDto } from './dto/create-product.dto';
import { Product } from './product';

const UNIQUE_VIOLATION = '23505';

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

    async create(dto: CreateProductDto): Promise<Product> {
        try {
            const saved = await this.repo.save(
                this.repo.create({
                    name: dto.name,
                    priceCents: dto.priceCents,
                    stock: dto.stock,
                    currency: dto.currency ?? 'UAH',
                }),
            );
            return this.toResponse(saved);
        } catch (error) {
            if (error instanceof QueryFailedError && (error.driverError as { code?: string }).code === UNIQUE_VIOLATION) {
                throw new ConflictException(`Товар з назвою "${dto.name}" вже існує`);
            }
            throw error;
        }
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
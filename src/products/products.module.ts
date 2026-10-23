import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import { RedisCache } from '../cache/redis-cache';
import { RedisLock } from '../cache/redis-lock';
import { Product } from '../entities/product.entity';
import { CACHE_REDIS } from '../redis/tokens';
import { ProductCardRepository } from './product-card.repository';
import { ProductCardService } from './product-card.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
    imports: [TypeOrmModule.forFeature([Product])],
    controllers: [ProductsController],
    providers: [
        ProductsService,
        {
            provide: ProductCardService,
            inject: [DataSource, CACHE_REDIS],
            useFactory: (dataSource: DataSource, redis: Redis | null) =>
                new ProductCardService(
                    new ProductCardRepository(dataSource),
                    redis ? new RedisCache(redis) : null,
                    redis ? new RedisLock(redis) : null,
                ),
        },
    ],
    exports: [ProductsService, ProductCardService],
})
export class ProductsModule {}
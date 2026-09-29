import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Pool } from 'pg';
import { Env } from '../config/env.schema';
import { User } from '../entities/user.entity';
import { Product } from '../entities/product.entity';
import { Order } from '../entities/order.entity';
import { OrderItem } from '../entities/order-item.entity';
import { PostProcessingJob } from '../entities/post-processing-job.entity';
import { resolvePgConnectionOptions } from './pg-connection-options';

export const PG_POOL = 'PG_POOL';

@Global()
@Module({
    imports: [
        ConfigModule,
        TypeOrmModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: async (configService: ConfigService<Env, true>) => {
                const options = await resolvePgConnectionOptions(configService);
                return {
                    type: 'postgres' as const,
                    ...options,
                    entities: [User, Product, Order, OrderItem, PostProcessingJob],
                    synchronize: false,
                };
            },
        }),
    ],
    providers: [
        {
            provide: PG_POOL,
            inject: [ConfigService],
            useFactory: async (configService: ConfigService<Env, true>) => {
                const options = await resolvePgConnectionOptions(configService);
                const pool = new Pool({
                    host: options.host,
                    port: options.port,
                    user: options.username,
                    password: options.password,
                    database: options.database,
                    max: 10,
                    idleTimeoutMillis: 30000,
                    connectionTimeoutMillis: 5000,
                });

                pool.on('error', (err) => {
                    console.error('Unexpected error on idle Postgres client', err);
                });

                return pool;
            },
        },
    ],
    exports: [PG_POOL, TypeOrmModule],
})
export class DatabaseModule {}
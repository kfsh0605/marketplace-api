import { Module } from '@nestjs/common';
import { RedisModule } from './redis/redis.module';
import { MessagingModule } from './messaging/messaging.module';
import { ConfigModule } from '@nestjs/config';
import { ProductsModule } from './products/products.module';
import { OrdersModule } from './orders/orders.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { validateEnv } from './config/env.schema';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            validate: validateEnv,
        }),
        DatabaseModule,
        ProductsModule,
        OrdersModule,
        HealthModule,
        DatabaseModule,
        MessagingModule,
        RedisModule,
        ProductsModule,
    ],
    controllers: [],
    providers: [],
})
export class AppModule {}
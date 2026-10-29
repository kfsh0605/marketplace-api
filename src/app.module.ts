import { Module } from '@nestjs/common';
import { RedisModule } from './redis/redis.module';
import { MessagingModule } from './messaging/messaging.module';
import { ConfigModule } from '@nestjs/config';
import { ProductsModule } from './products/products.module';
import { OrdersModule } from './orders/orders.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { validateEnv } from './config/env.schema';
import { validateAuthEnv } from './config/auth-env';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            validate: (config) => validateAuthEnv(validateEnv(config)),
        }),
        DatabaseModule,
        ProductsModule,
        OrdersModule,
        HealthModule,
        MessagingModule,
        RedisModule,
        AuthModule,
    ],
    controllers: [],
    providers: [],
})
export class AppModule {}
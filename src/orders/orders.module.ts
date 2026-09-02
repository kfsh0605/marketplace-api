import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor';

@Module({
    imports: [ProductsModule],
    controllers: [OrdersController],
    providers: [OrdersService, IdempotencyInterceptor],
})
export class OrdersModule {}
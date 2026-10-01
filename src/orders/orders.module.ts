import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from '../entities/order.entity';
import { OrderItem } from '../entities/order-item.entity';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrderEventsService } from './order-events.service';
import { OrdersGateway } from './orders.gateway';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor';

@Module({
    imports: [TypeOrmModule.forFeature([Order, OrderItem])],
    controllers: [OrdersController],
    providers: [OrdersService, OrderEventsService, OrdersGateway, IdempotencyInterceptor],
})
export class OrdersModule {}
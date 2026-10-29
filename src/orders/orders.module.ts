import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from '../entities/order.entity';
import { OrderItem } from '../entities/order-item.entity';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrderEventsService } from './order-events.service';
import { OrdersGateway } from './orders.gateway';
import { ProductsModule } from '../products/products.module';

@Module({
    imports: [TypeOrmModule.forFeature([Order, OrderItem]), ProductsModule, AuthModule],
    controllers: [OrdersController],
    providers: [OrdersService, OrderEventsService, OrdersGateway],
})
export class OrdersModule {}
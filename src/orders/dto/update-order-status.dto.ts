import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ORDER_STATUSES, OrderStatus } from '../order-status';

export class UpdateOrderStatusDto {
    @ApiProperty({ enum: ORDER_STATUSES, example: 'shipped' })
    @IsIn(ORDER_STATUSES)
    status: OrderStatus;
}
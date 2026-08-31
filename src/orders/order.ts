import { ApiProperty } from '@nestjs/swagger';
import { OrderItemDto } from './dto/order-item.dto';

export class Order {
    @ApiProperty({ example: 'o-1' })
    id: string;

    @ApiProperty({ type: [OrderItemDto] })
    items: OrderItemDto[];

    @ApiProperty({ example: 90000, description: 'Загальна сума замовлення в копійках' })
    totalCents: number;

    @ApiProperty({ example: 'UAH' })
    currency: string;

    @ApiProperty({ example: 'created' })
    status: string;
}
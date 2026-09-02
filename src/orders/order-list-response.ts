import { ApiProperty } from '@nestjs/swagger';
import { Order } from './order';

export class OrderListResponse {
    @ApiProperty({ type: [Order] })
    items: Order[];

    @ApiProperty({ example: null, nullable: true, type: String, description: 'Курсор для наступної сторінки або null, якщо сторінка остання' })
    next_cursor: string | null;
}
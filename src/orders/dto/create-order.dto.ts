import { ArrayMinSize, IsArray, IsEmail, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { OrderItemDto } from './order-item.dto';

export class CreateOrderDto {
    @ApiProperty({ example: 'ada@example.com', description: 'Email клієнта, що оформлює замовлення' })
    @IsEmail()
    customerEmail: string;

    @ApiProperty({ type: [OrderItemDto], minItems: 1 })
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => OrderItemDto)
    items: OrderItemDto[];
}
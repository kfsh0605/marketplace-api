import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class OrderItemDto {
    @ApiProperty({ example: 'p-1', description: 'Ідентифікатор товару' })
    @IsString()
    @IsNotEmpty()
    productId: string;

    @ApiProperty({ example: 2, minimum: 1, description: 'Кількість одиниць товару' })
    @IsInt()
    @Min(1)
    quantity: number;
}
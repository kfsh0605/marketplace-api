import { ApiProperty } from '@nestjs/swagger';

export class Product {
    @ApiProperty({ example: 'p-1', description: 'Ідентифікатор товару' })
    id: string;

    @ApiProperty({ example: 'Клавіатура', description: 'Назва товару' })
    name: string;

    @ApiProperty({ example: 45000, description: 'Ціна в найменших одиницях валюти (копійках)' })
    priceCents: number;

    @ApiProperty({ example: 'UAH', description: 'Код валюти' })
    currency: string;
}
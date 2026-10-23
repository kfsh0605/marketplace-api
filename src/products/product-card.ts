import { ApiProperty } from '@nestjs/swagger';

export class ProductCard {
    @ApiProperty({ example: '42', description: 'Ідентифікатор товару' })
    id: string;

    @ApiProperty({ example: 'Механічна клавіатура', description: 'Назва товару' })
    name: string;

    @ApiProperty({ example: 249900, description: 'Ціна в копійках' })
    priceCents: number;

    @ApiProperty({ example: 'UAH', description: 'Код валюти' })
    currency: string;

    @ApiProperty({ example: 50, description: 'Залишок на складі (може відставати до кінця TTL кешу)' })
    stock: number;

    @ApiProperty({ example: 1294, description: 'Скільки штук продано' })
    unitsSold: number;

    @ApiProperty({ example: 323730600, description: 'Виторг у копійках' })
    revenueCents: number;

    @ApiProperty({ example: 987, description: 'У скількох замовленнях зустрічається товар' })
    ordersCount: number;
}

export const CARD_QUERY_TAG = 'product-card';

export const cardKey = (productId: number): string => `product:card:${productId}`;

export const cardLockKey = (productId: number): string => `lock:product:card:${productId}`;
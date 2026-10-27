import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const PRODUCT_CURRENCIES = ['UAH', 'USD', 'EUR'] as const;

export class CreateProductDto {
    @ApiProperty({ example: 'Механічна клавіатура' })
    @IsString()
    @IsNotEmpty()
    @MaxLength(200)
    name: string;

    @ApiProperty({ example: 249900, description: 'Ціна в мінімальних одиницях валюти (копійки)' })
    @IsInt()
    @Min(1)
    @Max(1_000_000_000)
    priceCents: number;

    @ApiProperty({ example: 50, description: 'Початковий залишок на складі' })
    @IsInt()
    @Min(0)
    @Max(1_000_000)
    stock: number;

    @ApiPropertyOptional({ enum: PRODUCT_CURRENCIES, default: 'UAH' })
    @IsOptional()
    @IsIn(PRODUCT_CURRENCIES)
    currency?: string;
}
import { ApiProperty } from '@nestjs/swagger';
import { Product } from './product';

export class ProductListResponse {
    @ApiProperty({ type: [Product] })
    items: Product[];

    @ApiProperty({ example: null, nullable: true, type: String, description: 'Курсор для наступної сторінки або null, якщо сторінка остання' })
    next_cursor: string | null;
}
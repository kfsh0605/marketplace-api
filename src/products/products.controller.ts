import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { ProductListResponse } from './product-list-response';
import { Product } from './product';
import { ProductCard } from './product-card';
import { ProductCardService } from './product-card.service';

@ApiTags('products')
@Controller('products')
export class ProductsController {
    constructor(
        private readonly productsService: ProductsService,
        private readonly productCardService: ProductCardService,
    ) {}

    @Get()
    @ApiOperation({ operationId: 'listProducts', summary: 'Отримати список товарів' })
    @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Максимальна кількість елементів на сторінці' })
    @ApiQuery({ name: 'cursor', required: false, type: String, description: 'Курсор для пагінації' })
    @ApiOkResponse({ type: ProductListResponse })
    findAll(@Query('limit') limit?: string, @Query('cursor') cursor?: string) {
        const parsedLimit = limit ? parseInt(limit, 10) : 20;
        return this.productsService.findAll(parsedLimit, cursor);
    }

    @Get(':productId')
    @ApiOperation({ operationId: 'getProduct', summary: 'Отримати товар за id' })
    @ApiParam({ name: 'productId', example: 'p-1' })
    @ApiOkResponse({ type: Product })
    findOne(@Param('productId') productId: string) {
        return this.productsService.findOne(productId);
    }
    @Get(':productId/card')
    @ApiOperation({
        operationId: 'getProductCard',
        summary: 'Картка товару зі статистикою продажів (cache-aside, TTL з джитером, single-flight)',
    })
    @ApiParam({ name: 'productId', example: '42' })
    @ApiOkResponse({ type: ProductCard })
    async getCard(@Param('productId') productId: string): Promise<ProductCard> {
        const id = Number(productId);
        const card = Number.isInteger(id) && id > 0 ? await this.productCardService.getCard(id) : null;
        if (!card) {
            throw new NotFoundException(`Product ${productId} not found`);
        }
        return card;
    }
}
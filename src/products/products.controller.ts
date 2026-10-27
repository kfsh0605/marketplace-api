import { Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiConflictResponse,
    ApiCreatedResponse,
    ApiForbiddenResponse,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
    ApiQuery,
    ApiTags,
    ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { CreateProductDto } from './dto/create-product.dto';
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
    @Public()
    @ApiOperation({ operationId: 'listProducts', summary: 'Отримати список товарів' })
    @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Максимальна кількість елементів на сторінці' })
    @ApiQuery({ name: 'cursor', required: false, type: String, description: 'Курсор для пагінації' })
    @ApiOkResponse({ type: ProductListResponse })
    findAll(@Query('limit') limit?: string, @Query('cursor') cursor?: string) {
        const parsedLimit = limit ? parseInt(limit, 10) : 20;
        return this.productsService.findAll(parsedLimit, cursor);
    }

    @Post()
    @Roles('seller', 'admin')
    @ApiBearerAuth()
    @ApiOperation({ operationId: 'createProduct', summary: 'Створити товар (лише seller або admin)' })
    @ApiCreatedResponse({ type: Product })
    @ApiUnauthorizedResponse({ description: 'Немає або недійсний access-токен' })
    @ApiForbiddenResponse({ description: 'Роль користувача не seller і не admin' })
    @ApiConflictResponse({ description: 'Товар з такою назвою вже існує' })
    create(@Body() dto: CreateProductDto): Promise<Product> {
        return this.productsService.create(dto);
    }

    @Get(':productId')
    @Public()
    @ApiOperation({ operationId: 'getProduct', summary: 'Отримати товар за id' })
    @ApiParam({ name: 'productId', example: 'p-1' })
    @ApiOkResponse({ type: Product })
    findOne(@Param('productId') productId: string) {
        return this.productsService.findOne(productId);
    }

    @Get(':productId/card')
    @Public()
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
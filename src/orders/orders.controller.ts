import { Body, Controller, Get, HttpCode, Param, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrdersService } from './orders.service';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor';
import { Order } from './order';
import { OrderListResponse } from './order-list-response';

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
    constructor(private readonly ordersService: OrdersService) {}

    @Get()
    @ApiOperation({ operationId: 'listOrders', summary: 'Отримати список замовлень' })
    @ApiQuery({ name: 'limit', required: false, type: Number })
    @ApiQuery({ name: 'cursor', required: false, type: String })
    @ApiOkResponse({ type: OrderListResponse })
    findAll(@Query('limit') limit?: string, @Query('cursor') cursor?: string) {
        const parsedLimit = limit ? parseInt(limit, 10) : 20;
        return this.ordersService.findAll(parsedLimit, cursor);
    }

    @Get(':orderId')
    @ApiOperation({ operationId: 'getOrder', summary: 'Отримати замовлення за id' })
    @ApiParam({ name: 'orderId', example: 'o-1' })
    @ApiOkResponse({ type: Order })
    findOne(@Param('orderId') orderId: string) {
        return this.ordersService.findOne(orderId);
    }

    @Post()
    @HttpCode(201)
    @UseInterceptors(IdempotencyInterceptor)
    @ApiOperation({ operationId: 'createOrder', summary: 'Створити нове замовлення' })
    @ApiHeader({
        name: 'Idempotency-Key',
        required: true,
        description:
            'Унікальний ключ, який клієнт генерує самостійно для запобігання дублюванню замовлень при повторній відправці одного й того самого запиту (наприклад, при повторній спробі після таймауту мережі). Той самий ключ з тим самим тілом запиту поверне збережену раніше відповідь замість створення нового замовлення.',
    })
    @ApiCreatedResponse({ type: Order })
    create(@Body() dto: CreateOrderDto) {
        return this.ordersService.create(dto);
    }
}
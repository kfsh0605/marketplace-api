import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query, Req, Res, UseInterceptors } from '@nestjs/common';
import { ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrdersService } from './orders.service';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor';
import { Order } from './order';
import { OrderListResponse } from './order-list-response';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import type { Request, Response } from 'express';
import { OrderEventsService, OrderStatusEvent } from './order-events.service';

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
    constructor(
        private readonly ordersService: OrdersService,
        private readonly orderEventsService: OrderEventsService,
    ) {}

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
    @Patch(':orderId/status')
    @ApiOperation({ operationId: 'updateOrderStatus', summary: 'Змінити статус замовлення' })
    @ApiParam({ name: 'orderId', example: 'o-1' })
    @ApiOkResponse({ type: Order })
    updateStatus(@Param('orderId') orderId: string, @Body() dto: UpdateOrderStatusDto) {
        return this.ordersService.updateStatus(orderId, dto.status);
    }
    @Get(':orderId/events')
    @ApiOperation({ operationId: 'streamOrderEvents', summary: 'SSE-потік подій зміни статусу замовлення' })
    @ApiParam({ name: 'orderId', example: 'o-1' })
    streamEvents(
        @Param('orderId') orderId: string,
        @Headers('last-event-id') lastEventIdHeader: string | undefined,
        @Req() req: Request,
        @Res() res: Response,
    ): void {
        const id = Number(orderId);

        res.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
        });
        res.write('retry: 1000\n\n'); // темп реконекту клієнта, якщо зʼєднання обірветься

        const lastEventId = Number(lastEventIdHeader ?? 0);
        for (const event of this.orderEventsService.getEventsAfter(lastEventId)) {
            if (event.orderId === id) {
                this.writeEvent(res, event);
            }
        }

        const unsubscribe = this.orderEventsService.subscribe((event) => {
            if (event.orderId === id) {
                this.writeEvent(res, event);
            }
        });

        req.on('close', () => {
            unsubscribe();
        });
    }

    private writeEvent(res: Response, event: OrderStatusEvent): void {
        res.write(`id: ${event.id}\nevent: order.status\ndata: ${JSON.stringify({ id: event.orderId, status: event.status })}\n\n`);
    }
}
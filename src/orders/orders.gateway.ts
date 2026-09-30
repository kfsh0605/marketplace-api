import { Logger, OnModuleDestroy } from '@nestjs/common';
import {
    ConnectedSocket,
    MessageBody,
    OnGatewayInit,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { OrdersService } from './orders.service';
import { OrderEventsService } from './order-events.service';

interface JoinPayload {
    orderId: number | string;
    userId: number | string;
}

interface JoinAck {
    joined: boolean;
    room?: string;
    reason?: string;
}

@WebSocketGateway({ cors: { origin: '*' } })
export class OrdersGateway implements OnGatewayInit, OnModuleDestroy {
    private readonly logger = new Logger(OrdersGateway.name);

    @WebSocketServer()
    private server!: Server;

    private unsubscribe?: () => void;

    constructor(
        private readonly ordersService: OrdersService,
        private readonly orderEventsService: OrderEventsService,
    ) {}

    afterInit(): void {
        // Один раз на весь застосунок підписуємось на спільну шину подій і
        // ретранслюємо кожну подію лише в її кімнату — незалежно від того,
        // скільки клієнтів у ній зараз сидить.
        this.unsubscribe = this.orderEventsService.subscribe((event) => {
            this.server.to(this.roomName(event.orderId)).emit('order.status', {
                id: event.orderId,
                status: event.status,
            });
        });
    }

    onModuleDestroy(): void {
        this.unsubscribe?.();
    }

    @SubscribeMessage('join')
    async handleJoin(@MessageBody() payload: JoinPayload, @ConnectedSocket() client: Socket): Promise<JoinAck> {
        const orderId = Number(payload?.orderId);
        const userId = Number(payload?.userId);

        if (!Number.isInteger(orderId) || !Number.isInteger(userId)) {
            return { joined: false, reason: 'orderId and userId are required' };
        }

        const isOwner = await this.ordersService.isOrderOwnedByUser(orderId, userId);
        if (!isOwner) {
            this.logger.warn(`Rejected join: order ${orderId} does not belong to user ${userId}`);
            return { joined: false, reason: 'forbidden' };
        }

        const room = this.roomName(orderId);
        await client.join(room);
        return { joined: true, room };
    }

    private roomName(orderId: number): string {
        return `orders:${orderId}`;
    }
}
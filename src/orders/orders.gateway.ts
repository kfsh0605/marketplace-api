import { Logger, OnModuleDestroy } from '@nestjs/common';
import {
    ConnectedSocket,
    MessageBody,
    OnGatewayConnection,
    OnGatewayInit,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AccessDenylist } from '../auth/access-denylist';
import { AccessPrincipal, TokenService } from '../auth/token.service';
import { OrdersService } from './orders.service';
import { OrderEventsService } from './order-events.service';

const BEARER_PATTERN = /^Bearer\s+(\S+)$/i;

interface JoinPayload {
    orderId: number | string;
}

interface JoinAck {
    joined: boolean;
    room?: string;
    reason?: string;
}

@WebSocketGateway({ cors: { origin: '*' } })
export class OrdersGateway implements OnGatewayInit, OnGatewayConnection, OnModuleDestroy {
    private readonly logger = new Logger(OrdersGateway.name);

    @WebSocketServer()
    private server!: Server;

    private unsubscribe?: () => void;

    constructor(
        private readonly ordersService: OrdersService,
        private readonly orderEventsService: OrderEventsService,
        private readonly tokens: TokenService,
        private readonly denylist: AccessDenylist,
    ) {}

    afterInit(): void {
        this.server.use((socket, next) => {
            void this.authenticate(socket).then(
                () => next(),
                (error: Error) => next(error),
            );
        });

        this.unsubscribe = this.orderEventsService.subscribe((event) => {
            this.server.to(this.roomName(event.orderId)).emit('order.status', {
                id: event.orderId,
                status: event.status,
            });
        });
    }

    handleConnection(client: Socket): void {
        const principal = this.principalOf(client);
        if (!principal) {
            client.disconnect(true);
            return;
        }
        const timer = setTimeout(
            () => client.disconnect(true),
            Math.max(principal.expiresAt * 1000 - Date.now(), 0),
        );
        timer.unref();
        client.once('disconnect', () => clearTimeout(timer));
    }

    onModuleDestroy(): void {
        this.unsubscribe?.();
    }

    @SubscribeMessage('join')
    async handleJoin(@MessageBody() payload: JoinPayload, @ConnectedSocket() client: Socket): Promise<JoinAck> {
        const principal = this.principalOf(client);
        if (!principal || principal.expiresAt * 1000 <= Date.now()) {
            client.disconnect(true);
            return { joined: false, reason: 'unauthorized' };
        }

        const orderId = Number(payload?.orderId);
        if (!Number.isInteger(orderId)) {
            return { joined: false, reason: 'orderId is required' };
        }

        let denied: boolean;
        try {
            denied = await this.denylist.isDenied(principal);
        } catch (error) {
            this.logger.error(`денілист недоступний, join відхилено (fail-closed): ${(error as Error).message}`);
            return { joined: false, reason: 'service_unavailable' };
        }
        if (denied) {
            client.disconnect(true);
            return { joined: false, reason: 'unauthorized' };
        }

        if (!(await this.ordersService.canView(orderId, principal.userId))) {
            this.logger.warn(`Rejected join: order ${orderId} недоступне користувачу ${principal.userId}`);
            return { joined: false, reason: 'not_found' };
        }

        const room = this.roomName(orderId);
        await client.join(room);
        return { joined: true, room };
    }

    private async authenticate(socket: Socket): Promise<void> {
        const token = this.extractToken(socket);
        if (!token) {
            throw new Error('unauthorized');
        }

        let principal: AccessPrincipal;
        try {
            principal = this.tokens.verifyAccess(token);
        } catch {
            throw new Error('unauthorized');
        }

        let denied: boolean;
        try {
            denied = await this.denylist.isDenied(principal);
        } catch (error) {
            this.logger.error(`денілист недоступний, сокет відхилено (fail-closed): ${(error as Error).message}`);
            throw new Error('service_unavailable');
        }
        if (denied) {
            throw new Error('unauthorized');
        }

        socket.data.principal = principal;
    }

    private extractToken(socket: Socket): string | undefined {
        const fromAuth: unknown = socket.handshake.auth?.token;
        if (typeof fromAuth === 'string' && fromAuth.length > 0) {
            return fromAuth;
        }
        const header = socket.handshake.headers.authorization;
        const match = typeof header === 'string' ? BEARER_PATTERN.exec(header) : null;
        return match?.[1];
    }

    private principalOf(client: Socket): AccessPrincipal | undefined {
        return client.data.principal as AccessPrincipal | undefined;
    }

    private roomName(orderId: number): string {
        return `orders:${orderId}`;
    }
}
import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

export interface OrderStatusEvent {
    id: number;
    orderId: number;
    status: string;
}

const HISTORY_LIMIT = 200;

@Injectable()
export class OrderEventsService {
    private readonly stream$ = new Subject<OrderStatusEvent>();
    private readonly history: OrderStatusEvent[] = [];
    private nextEventId = 1;

    emitStatusChanged(orderId: number, status: string): OrderStatusEvent {
        const event: OrderStatusEvent = {
            id: this.nextEventId++,
            orderId,
            status,
        };

        this.history.push(event);
        if (this.history.length > HISTORY_LIMIT) {
            this.history.shift();
        }

        this.stream$.next(event);
        return event;
    }

    subscribe(onEvent: (event: OrderStatusEvent) => void): () => void {
        const subscription = this.stream$.subscribe(onEvent);
        return () => subscription.unsubscribe();
    }

    getEventsAfter(lastEventId: number): OrderStatusEvent[] {
        return this.history.filter((event) => event.id > lastEventId);
    }
}
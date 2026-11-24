import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrderEventsService } from '../orders/order-events.service';
import { canTransition } from '../orders/order-status';
import type { PaymentSucceeded } from './payment-event';

export type WebhookOutcome = 'accepted' | 'duplicate' | 'amount_mismatch' | 'not_payable' | 'order_not_found';

interface OrderRow {
    status: string;
    totalCents: number;
    currency: string;
}

@Injectable()
export class PaymentWebhookService {
    constructor(
        private readonly dataSource: DataSource,
        private readonly orderEvents: OrderEventsService,
    ) {}

    /**
     * Одна транзакція: блокуємо рядок замовлення, звіряємо суму із заморожену в ньому, пишемо подію в леджер
     * (UNIQUE event_id), і лише для нового й коректного платежу переводимо замовлення в `paid`.
     * Леджер і зміна статусу комітяться разом: платіж не може бути «записаний, але не застосований».
     * Відхилені події (сума, статус) теж лишаються в леджері: вони доказ того, що сталося, і повтор
     * тієї самої події (той самий id) вже не обробляється вдруге.
     */
    async applySucceeded(event: PaymentSucceeded): Promise<WebhookOutcome> {
        const { orderId, amountCents, currency } = event.data;

        const outcome = await this.dataSource.transaction(async (manager): Promise<WebhookOutcome> => {
            const rows: OrderRow[] = await manager.query(
                `SELECT status, "totalCents", currency FROM orders WHERE id = $1 FOR UPDATE`,
                [orderId],
            );
            if (rows.length === 0) {
                return 'order_not_found';
            }
            const order = rows[0];

            let verdict: 'applied' | 'amount_mismatch' | 'not_payable';
            if (order.totalCents !== amountCents || order.currency !== currency.toUpperCase()) {
                verdict = 'amount_mismatch';
            } else if (!canTransition(order.status, 'paid')) {
                verdict = 'not_payable';
            } else {
                verdict = 'applied';
            }

            const inserted: unknown[] = await manager.query(
                `INSERT INTO payment_events (event_id, order_id, amount_cents, currency, outcome)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (event_id) DO NOTHING
                 RETURNING id`,
                [event.id, orderId, amountCents, currency.toUpperCase(), verdict],
            );
            if (inserted.length === 0) {
                return 'duplicate';
            }

            if (verdict === 'applied') {
                await manager.query(`UPDATE orders SET status = 'paid' WHERE id = $1`, [orderId]);
                return 'accepted';
            }
            return verdict;
        });

        if (outcome === 'accepted') {
            // Після коміту: підписники SSE і сокетів не мають побачити статус, якого ще немає в БД
            this.orderEvents.emitStatusChanged(orderId, 'paid');
        }
        return outcome;
    }
}

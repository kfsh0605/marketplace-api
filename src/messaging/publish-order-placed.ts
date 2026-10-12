import { Logger } from '@nestjs/common';
import { withTimeout } from '../lib/with-timeout';
import { buildOrderPlacedEvent } from './events';
import type { OrderPlacedEvent } from './events';

export const PUBLISH_TIMEOUT_MS = 3000;

/**
 * Усе, що потрібно від продюсера. EventPublisher цьому відповідає;
 * тест підставляє фейк без брокера.
 */
export interface OrderPlacedSink {
    isEnabled(): boolean;
    publish(event: OrderPlacedEvent): Promise<void>;
}

const defaultLogger = new Logger('order.placed');

/**
 * ЄДИНЕ місце, де замовлення стає подією order.placed. Його викликають обидва шляхи створення
 * замовлення: OrdersService.create (POST /orders) і checkout(). Третій шлях, коли з'явиться,
 * має піти сюди ж, а не збирати подію сам: так контракт події не розійдеться між шляхами.
 *
 * Викликати ПІСЛЯ коміту транзакції замовлення. Помилка публікації не кидається: замовлення вже
 * збережене, а подія втрачена (dual write, див. README, "Межі"; лікується outbox у ДЗ №22).
 * Повертає true, лише якщо брокер підтвердив прийом (publisher confirm).
 */
export async function publishOrderPlaced(
    sink: OrderPlacedSink,
    data: OrderPlacedEvent['data'],
    logger: Pick<Logger, 'log' | 'error'> = defaultLogger,
): Promise<boolean> {
    if (!sink.isEnabled()) {
        return false;
    }
    const event = buildOrderPlacedEvent(data);
    try {
        await withTimeout(sink.publish(event), PUBLISH_TIMEOUT_MS, 'publish order.placed');
        logger.log(`Подію ${event.eventId} опубліковано (confirm отримано)`);
        return true;
    } catch (err) {
        logger.error(`Подію ${event.eventId} НЕ опубліковано: ${(err as Error).message}`);
        return false;
    }
}

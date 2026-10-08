/**
 * ДЗ №19: єдине місце, де живуть імена та числа RabbitMQ-топології.
 * Publisher, consumer і demo-скрипти імпортують звідси — тоді одруківка
 * в routing key не перетворюється на "тихо зниклі" повідомлення.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// exchange'і
export const EXCHANGE_EVENTS = 'shop.events'; // topic: головний вхід для доменних подій
export const EXCHANGE_UNROUTED = 'shop.events.unrouted'; // alternate exchange: лист без адреси
export const EXCHANGE_DLX = 'shop.events.dlx'; // dead-letter exchange: брак

// черги
export const QUEUE_ORDER_PLACED = 'orders.order-placed';
export const QUEUE_ORDER_PLACED_DLQ = 'orders.order-placed.dlq';
export const QUEUE_UNROUTED = 'shop.unrouted';

// routing keys
export const ROUTING_KEY_ORDER_PLACED = 'order.placed';
export const ROUTING_KEY_ORDER_PLACED_DEAD = 'order.placed.dead';

// після скількох повернень (reject requeue=true) повідомлення йде в DLQ
export const DELIVERY_LIMIT = 3;

// скільки НЕпідтверджених повідомлень брокер тримає в руках одного споживача.
// Дефолт RabbitMQ — 0, а це "без ліміту", тому число задаємо явно.
// Обґрунтування за формулою з лекції — у README (розділ про RabbitMQ).
export const PREFETCH = 20;

/**
 * Де брати адрес брокера:
 * 1) RABBITMQ_URL (його збирає scripts/with-secrets.sh, або задає грейдер);
 * 2) інакше складаємо з RABBITMQ_HOST/PORT/USER + secrets/rabbitmq_password
 *    (так само, як застосунок читає secrets/db_password для БД, коли запущений через `npm start`);
 * 3) інакше null, і публікацію подій вимкнено.
 * RABBITMQ_DISABLED=1 вимикає явно (e2e-тести не повинні писати в живий брокер).
 */
export function resolveRabbitUrl(): string | null {
    if (process.env.RABBITMQ_DISABLED === '1') {
        return null;
    }
    if (process.env.RABBITMQ_URL) {
        return process.env.RABBITMQ_URL;
    }
    const passwordFile = join(process.cwd(), 'secrets', 'rabbitmq_password');
    if (!existsSync(passwordFile)) {
        return null;
    }
    const password = readFileSync(passwordFile, 'utf8').trim(); // trim прибирає і \r з Windows-файлів
    const user = process.env.RABBITMQ_USER ?? 'marketplace';
    const host = process.env.RABBITMQ_HOST ?? 'localhost';
    const port = process.env.RABBITMQ_PORT ?? '5672'; // AMQP, не 15672 (то веб-панель)
    return `amqp://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}`;
}

export function getRabbitUrl(): string {
    const url = resolveRabbitUrl();
    if (!url) {
        throw new Error(
            'RabbitMQ не налаштований: задай RABBITMQ_URL (amqp://..., порт 5672) ' +
            'або запускай через scripts/with-secrets.sh (npm run ...).',
        );
    }
    return url;
}
import { connect } from 'amqplib';
import type { ChannelModel, ConfirmChannel } from 'amqplib';
import type { OrderPlacedEvent } from './events';
import { EXCHANGE_EVENTS, getRabbitUrl, resolveRabbitUrl, ROUTING_KEY_ORDER_PLACED } from './rabbitmq.config';

/** Брокер повернув повідомлення (basic.return): жодна черга його не прийняла. */
export class UnroutableMessageError extends Error {
    constructor(eventId: string, routingKey: string) {
        super(`Подію ${eventId} не маршрутизовано: для routing key "${routingKey}" немає черги`);
        this.name = 'UnroutableMessageError';
    }
}

/**
 * Публікація подій. Тут навмисно НЕМАЄ assertQueue/bindQueue: продюсер не знає,
 * хто слухає. Він лише перевіряє, що exchange існує (checkExchange).
 */
export class EventPublisher {
    private conn: ChannelModel | null = null;
    private channelPromise: Promise<ConfirmChannel> | null = null;
    /** messageId повідомлень, які брокер повернув через basic.return */
    private readonly returned = new Set<string>();

    constructor(private readonly urlProvider: () => string = getRabbitUrl) {}

    /** Чи налаштований RabbitMQ. Без нього публікація вимкнена (наприклад, у CI). */
    isEnabled(): boolean {
        return resolveRabbitUrl() !== null;
    }

    /** Nest викличе це при зупинці застосунку */
    async onModuleDestroy(): Promise<void> {
        await this.close();
    }

    async publish(event: OrderPlacedEvent, routingKey: string = ROUTING_KEY_ORDER_PLACED): Promise<void> {
        const ch = await this.getChannel();

        ch.publish(EXCHANGE_EVENTS, routingKey, Buffer.from(JSON.stringify(event)), {
            persistent: true, // переживе рестарт брокера
            mandatory: true, // немаршрутизоване повернеться через basic.return
            messageId: event.eventId,
            type: event.type,
            contentType: 'application/json',
        });

        // confirm = "брокер взяв відповідальність", а не "доставлено споживачу"
        await ch.waitForConfirms();

        // basic.return приходить РАНІШЕ за basic.ack, тож тут ми вже знаємо, чи було повернення
        if (this.returned.delete(event.eventId)) {
            throw new UnroutableMessageError(event.eventId, routingKey);
        }
    }

    async close(): Promise<void> {
        const conn = this.conn;
        this.conn = null;
        this.channelPromise = null;
        if (conn) {
            await conn.close().catch(() => undefined);
        }
    }

    private getChannel(): Promise<ConfirmChannel> {
        if (!this.channelPromise) {
            this.channelPromise = this.openChannel().catch((err) => {
                this.channelPromise = null; // наступна публікація спробує підключитися знову
                throw err;
            });
        }
        return this.channelPromise;
    }

    private async openChannel(): Promise<ConfirmChannel> {
        const conn = await connect(this.urlProvider());
        const reset = () => {
            this.conn = null;
            this.channelPromise = null;
        };
        conn.on('error', (err) => console.error('[rabbit] помилка з\'єднання:', err.message));
        conn.on('close', reset);

        // Confirm-канал: без нього publish лише кладе повідомлення в сокет
        const ch = await conn.createConfirmChannel();
        ch.on('error', (err) => console.error('[rabbit] помилка каналу:', err.message));
        ch.on('close', reset);
        ch.on('return', (msg) => {
            // в типах amqplib 2.2.0 у basic.return нет replyText/replyCode, хоть брокер их присылает
            const fields = msg.fields as typeof msg.fields & { replyText?: string; replyCode?: number };
            const id = msg.properties.messageId as string | undefined;
            console.warn(`[rabbit] basic.return: ${fields.replyText} (key=${fields.routingKey}, id=${id})`);
            if (id) {
                this.returned.add(id);
            }
        });

        try {
            // passive-перевірка: топологію оголошує bootstrap/споживач, продюсер лише дивиться
            await ch.checkExchange(EXCHANGE_EVENTS);
        } catch {
            await conn.close().catch(() => undefined);
            throw new Error(
                `Exchange "${EXCHANGE_EVENTS}" не існує. Спершу створи топологію: npm run rabbit:setup`,
            );
        }

        this.conn = conn;
        return ch;
    }
}
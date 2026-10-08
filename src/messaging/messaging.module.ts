import { Global, Injectable, Logger, Module, OnModuleInit } from '@nestjs/common';
import { connect } from 'amqplib';
import { EventPublisher } from './publisher';
import { resolveRabbitUrl } from './rabbitmq.config';
import { assertTopology } from './topology';

@Injectable()
export class TopologyBootstrap implements OnModuleInit {
    private readonly logger = new Logger('RabbitTopology');

    async onModuleInit(): Promise<void> {
        const url = resolveRabbitUrl();
        if (!url) {
            this.logger.warn(
                'RabbitMQ не налаштований (немає RABBITMQ_URL / secrets/rabbitmq_password): публікацію подій вимкнено',
            );
            return;
        }
        try {
            const conn = await connect(url);
            try {
                const ch = await conn.createChannel();
                await assertTopology(ch);
                await ch.close();
            } finally {
                await conn.close();
            }
            this.logger.log('Топологію RabbitMQ оголошено');
        } catch (err) {
            this.logger.error(
                `Не вдалося оголосити топологію: ${(err as Error).message}. ` +
                'API працює, але події не публікуватимуться, доки брокер недоступний',
            );
        }
    }
}

@Global()
@Module({
    providers: [{ provide: EventPublisher, useFactory: () => new EventPublisher() }, TopologyBootstrap],
    exports: [EventPublisher],
})
export class MessagingModule {}
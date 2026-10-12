import 'reflect-metadata';
import { connect } from 'amqplib';
import { AppDataSource } from '../data-source';
import { startOrderPlacedConsumer } from './consumer';
import { getRabbitUrl, QUEUE_ORDER_PLACED } from './rabbitmq.config';
import { assertTopology } from './topology';

async function main(): Promise<void> {
    await AppDataSource.initialize();

    const conn = await connect(getRabbitUrl());
    const ch = await conn.createChannel();

    await assertTopology(ch);

    const { prefetch } = await startOrderPlacedConsumer(ch, AppDataSource, {
        onDelivery: (d) =>
            console.log(
                `[consumer] доставка ${d.eventId ?? '(нечитабельне)'} #${d.deliveryCount}${d.redelivered ? ' (повторна)' : ''}`,
            ),
        onSettled: (r) => console.log(`[consumer] ${r.eventId ?? '(нечитабельне)'} → ${r.outcome} за ${r.durationMs} мс`),
    });
    console.log(`consumer запущено: queue=${QUEUE_ORDER_PLACED} prefetch=${prefetch}`);

    let stopping = false;
    const shutdown = async () => {
        if (stopping) {
            return;
        }
        stopping = true;
        console.log('[consumer] зупинка...');
        await ch.close().catch(() => undefined);
        await conn.close().catch(() => undefined);
        await AppDataSource.destroy().catch(() => undefined);
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    conn.on('close', () => {
        if (!stopping) {
            console.error('[consumer] з\'єднання з брокером закрито');
            process.exit(1);
        }
    });
}

main().catch((err) => {
    console.error('consumer failed:', err);
    process.exit(1);
});
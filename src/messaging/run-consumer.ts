import { connect } from 'amqplib';
import { createPool } from '../outbox/pool';
import { startOrderPlacedConsumer } from './consumer';
import { pgStore } from './pg-store';
import { getRabbitUrl, QUEUE_ORDER_PLACED } from './rabbitmq.config';
import { assertTopology } from './topology';

async function main(): Promise<void> {
    const pool = createPool();

    const conn = await connect(getRabbitUrl());
    const ch = await conn.createChannel();

    await assertTopology(ch);

    const { prefetch } = await startOrderPlacedConsumer(ch, pgStore(pool), {
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
        await pool.end().catch(() => undefined);
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
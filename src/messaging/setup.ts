import { connect } from 'amqplib';
import {
    getRabbitUrl,
    QUEUE_ORDER_PLACED,
    QUEUE_ORDER_PLACED_DLQ,
    QUEUE_UNROUTED,
} from './rabbitmq.config';
import { assertTopology } from './topology';

async function main(): Promise<void> {
    const conn = await connect(getRabbitUrl());
    const ch = await conn.createChannel();

    await assertTopology(ch);

    for (const queue of [QUEUE_ORDER_PLACED, QUEUE_ORDER_PLACED_DLQ, QUEUE_UNROUTED]) {
        const info = await ch.checkQueue(queue);
        console.log(`queue=${info.queue} messages=${info.messageCount} consumers=${info.consumerCount}`);
    }
    console.log('topology=ok');

    await ch.close();
    await conn.close();
}

main().catch((err) => {
    console.error('rabbit:setup failed:', err);
    process.exit(1);
});
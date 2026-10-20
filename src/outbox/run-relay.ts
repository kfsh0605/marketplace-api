import { EventPublisher } from '../messaging/publisher';
import { createPool } from './pool';
import { relayLoop } from './relay';

async function main(): Promise<void> {
    const pool = createPool();
    const publisher = new EventPublisher();
    const stopper = new AbortController();

    // Ctrl+C не обрывает relay посреди транзакции: он дожидается конца текущего прохода
    const stop = () => {
        console.log('[relay] зупинка після поточного проходу...');
        stopper.abort();
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);

    console.log('relay запущено: пачка=100, пауза=500 мс');
    await relayLoop(pool, publisher, {
        signal: stopper.signal,
        onPass: (p) => {
            if (p.published > 0 || p.failed > 0) {
                console.log(`[relay] віднесено ${p.published}, збоїв ${p.failed}`);
            }
        },
    });

    await publisher.close();
    await pool.end();
    console.log('[relay] зупинено');
}

main().catch((err) => {
    console.error('relay failed:', err);
    process.exit(1);
});
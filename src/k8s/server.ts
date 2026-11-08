import { createServer } from 'node:http';
import { createHandler } from './app';
import { loadK8sConfig } from './config';
import { createShutdown } from './graceful';
import { Lifecycle } from './lifecycle';

const log = (line: string): void => console.log(line);
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
    const config = loadK8sConfig(process.env);
    const lifecycle = new Lifecycle();
    const server = createServer(createHandler(config, lifecycle));
    const shutdown = createShutdown(server, lifecycle, {
        drainMs: config.DRAIN_MS,
        log,
        exit: (code) => process.exit(code),
    });

    let warming = true;
    const onSignal = (signal: NodeJS.Signals): void => {
        if (warming) {
            log(`[${signal}] прогрів ще триває, слухача немає: виходжу одразу`);
            process.exit(0);
        }
        void shutdown(signal);
    };
    process.on('SIGTERM', onSignal);
    process.on('SIGINT', onSignal);

    server.on('error', (error) => {
        console.error(`[error] ${error.message}`);
        process.exit(1);
    });

    log(`[warmup] прогріваюсь ${config.WARMUP_MS} мс, слухача ще немає (rev=${config.REV})`);
    await pause(config.WARMUP_MS);
    warming = false;

    await new Promise<void>((resolve) => server.listen(config.PORT, '0.0.0.0', resolve));
    lifecycle.markReady();
    log(`[listen] слухаю :${config.PORT}, readyz=200`);
}

main().catch((error: Error) => {
    console.error(error.message);
    process.exit(1);
});
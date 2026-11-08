import type { Server } from 'node:http';
import type { Lifecycle } from './lifecycle';

export interface ShutdownOptions {
    drainMs: number;
    log: (line: string) => void;
    exit: (code: number) => void;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createShutdown(server: Server, lifecycle: Lifecycle, options: ShutdownOptions) {
    let started = false;

    return async function shutdown(signal: string): Promise<void> {
        if (started) {
            return;
        }
        started = true;

        lifecycle.beginDrain();
        options.log(`[${signal}] readyz=503, приймаю запити ще ${options.drainMs} мс`);

        await pause(options.drainMs);

        options.log('[drain] дренаж завершено, закриваю сокет');
        await new Promise<void>((resolve) => {
            server.close(() => resolve());
            server.closeIdleConnections();
        });

        lifecycle.markClosed();
        options.log('[closed] сокет закрито');
        options.exit(0);
    };
}
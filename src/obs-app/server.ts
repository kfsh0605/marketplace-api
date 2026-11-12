import { flushTraces, shutdownTracing } from '../observability/tracing';
import { createLogger } from '../observability/logger';
import { createApp } from './app';

const log = createLogger('obs-app.server');
const port = Number(process.env.OBS_APP_PORT ?? 22910);

const server = createApp().listen(port, '0.0.0.0', () => {
    log.info({ port }, 'listening');
});

async function stop(signal: string): Promise<void> {
    log.info({ signal }, 'stopping');
    server.close();
    await flushTraces().catch((error) => log.warn({ err: error }, 'flush failed'));
    await shutdownTracing().catch(() => undefined);
    process.exit(0);
}

process.on('SIGTERM', () => void stop('SIGTERM'));
process.on('SIGINT', () => void stop('SIGINT'));
import type { INestApplication } from '@nestjs/common';
import { requestContextMiddleware } from './context.middleware';
import { metricsHandler, metricsMiddleware } from './metrics';
import { PinoNestLogger } from './nest-logger';
import { requestLog } from './request-log';

export function configureObservability(app: INestApplication): void {
    app.useLogger(new PinoNestLogger());
    app.getHttpAdapter().getInstance().get('/metrics', metricsHandler);
    app.use(requestContextMiddleware);
    app.use(metricsMiddleware);
    app.use(requestLog);
}
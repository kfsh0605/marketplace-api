import express from 'express';
import { requestContextMiddleware } from '../observability/context.middleware';
import { metricsHandler, metricsMiddleware } from '../observability/metrics';
import { authContext, errorHandler, requestLog } from './http-middleware';
import { createOrdersRouter } from './orders.controller';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';

export function createApp(): express.Express {
    const app = express();
    app.disable('x-powered-by');

    app.get('/metrics', metricsHandler);
    app.use(metricsMiddleware);
    app.use(express.json());
    app.use(requestContextMiddleware);
    app.use(authContext);
    app.use(requestLog);

    app.post('/auth/login', (_req, res) => {
        res.json({ ok: true });
    });
    app.use(createOrdersRouter(new OrdersService(new OrdersRepository())));
    app.use(errorHandler);
    return app;
}
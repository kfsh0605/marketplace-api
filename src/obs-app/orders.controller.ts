import { Router } from 'express';
import { createLogger } from '../observability/logger';
import { getContext } from '../observability/request-context';
import { OrdersService } from './orders.service';

const log = createLogger('orders.controller');

export function createOrdersRouter(service: OrdersService): Router {
    const router = Router();

    router.post('/orders/checkout', async (req, res, next) => {        try {
            log.info('checkout requested');
            const { order, replayed } = await service.checkout(getContext().userId ?? 'anonymous', req.body?.items);
            res.status(replayed ? 200 : 201).json(order);
        } catch (error) {
            next(error);
        }
    });

    router.get('/orders/:id', async (req, res, next) => {        try {
            log.info({ orderId: req.params.id }, 'get order requested');
            res.json(await service.getOrder(req.params.id));
        } catch (error) {
            next(error);
        }
    });

    return router;
}
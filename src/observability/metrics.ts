import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import type { NextFunction, Request, Response } from 'express';

export const registry = new Registry();

collectDefaultMetrics({ register: registry });

export const HTTP_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export const httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Кількість HTTP-запитів за методом, шаблоном маршруту і кодом відповіді',
    labelNames: ['method', 'route', 'status'],
    registers: [registry],
});

export const httpRequestDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'Тривалість HTTP-запиту в секундах',
    labelNames: ['method', 'route', 'status'],
    buckets: HTTP_BUCKETS,
    registers: [registry],
});

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
    const stopTimer = httpRequestDuration.startTimer();
    res.on('finish', () => {
        const route = req.route ? `${req.baseUrl}${req.route.path}` : 'unmatched';
        const labels = { method: req.method, route, status: String(res.statusCode) };
        httpRequestsTotal.inc(labels);
        stopTimer(labels);
    });
    next();
}

export async function metricsHandler(_req: Request, res: Response): Promise<void> {
    res.set('Content-Type', registry.contentType);
    res.end(await registry.metrics());
}
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { createLogger } from '../observability/logger';
import { setContextValue } from '../observability/request-context';
import { HttpError } from './orders.service';

const log = createLogger('http');

export function authContext(req: Request, _res: Response, next: NextFunction): void {
    const header = req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (token) {
        setContextValue('userId', createHash('sha256').update(token).digest('hex').slice(0, 8));
    }
    next();
}

export function requestLog(req: Request, _res: Response, next: NextFunction): void {
    log.info({ req: { method: req.method, url: req.originalUrl, headers: req.headers, body: req.body } }, 'request');
    next();
}

export function errorHandler(error: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction): void {
    const status = error instanceof HttpError ? error.status : (error.status ?? 500);
    if (status >= 500) {
        log.error({ err: error }, 'request failed');
        const span = trace.getActiveSpan();
        span?.recordException(error);
        span?.setStatus({ code: SpanStatusCode.ERROR });
    }
    res.status(status).json({ error: status >= 500 ? 'internal' : error.message });
}
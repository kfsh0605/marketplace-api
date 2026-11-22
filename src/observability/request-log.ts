import type { IncomingHttpHeaders } from 'node:http';
import type { NextFunction, Request, Response } from 'express';
import { createLogger } from './logger';

const log = createLogger('http');

const LOGGED_HEADERS = [
    'traceparent',
    'tracestate',
    'x-tenant',
    'idempotency-key',
    'user-agent',
    'content-type',
    'content-length',
    'accept',
] as const;

function allowedHeaders(headers: IncomingHttpHeaders): Record<string, string | string[]> {
    const picked: Record<string, string | string[]> = {};
    for (const name of LOGGED_HEADERS) {
        const value = headers[name];
        if (value !== undefined) {
            picked[name] = value;
        }
    }
    return picked;
}

export function requestLog(req: Request, _res: Response, next: NextFunction): void {
    const url = req.originalUrl.split('?')[0];
    log.info({ req: { method: req.method, url, headers: allowedHeaders(req.headers) } }, 'request');
    next();
}
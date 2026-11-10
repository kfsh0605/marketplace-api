import type { NextFunction, Request, Response } from 'express';
import { runWithContext } from './request-context';

export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction): void {
    runWithContext(
        {
            tenant: req.header('x-tenant') ?? 'default',
            idempotencyKey: req.header('idempotency-key') ?? undefined,
        },
        next,
    );
}
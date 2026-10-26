import type { NextFunction, Request, Response } from 'express';
import type { Limiter } from './sliding-window-limiter';

export function rateLimitMiddleware(
    limiter: Limiter,
    identify: (req: Request) => string = (req) => req.ip ?? 'unknown',
) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const result = await limiter.consume(identify(req));
            if (result.allowed) {
                next();
                return;
            }
            res.set('Retry-After', String(result.retryAfterSec));
            res.status(429).json({ error: 'Too Many Requests', retryAfterSec: result.retryAfterSec });
        } catch (err) {
            next(err);
        }
    };
}
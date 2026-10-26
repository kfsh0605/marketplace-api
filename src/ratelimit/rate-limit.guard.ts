import { CanActivate, ExecutionContext, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { RATE_LIMITER } from '../redis/tokens';
import type { Limiter } from './sliding-window-limiter';

@Injectable()
export class RateLimitGuard implements CanActivate {
    constructor(@Inject(RATE_LIMITER) private readonly limiter: Limiter | null) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        if (!this.limiter) {
            return true;
        }
        const http = context.switchToHttp();
        const request = http.getRequest<Request>();
        const result = await this.limiter.consume(request.ip ?? 'unknown');
        if (result.allowed) {
            return true;
        }
        http.getResponse<Response>().setHeader('Retry-After', String(result.retryAfterSec));
        throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
    }
}
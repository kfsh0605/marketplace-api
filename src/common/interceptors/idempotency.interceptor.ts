import {
    BadRequestException,
    CallHandler,
    ExecutionContext,
    Injectable,
    NestInterceptor,
    UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Request, Response } from 'express';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';

interface IdempotencyRecord {
    fingerprint: string;
    response: unknown;
    expiresAt: number;
}

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const IDEMPOTENCY_MAX_ENTRIES = 10000;

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
    private readonly store = new Map<string, IdempotencyRecord>();

    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        const request = context.switchToHttp().getRequest<Request>();
        const response = context.switchToHttp().getResponse<Response>();

        const key = request.headers['idempotency-key'];
        if (!key || Array.isArray(key)) {
            throw new BadRequestException('Idempotency-Key header is required');
        }

        const fingerprint = this.fingerprint(request.body);
        const existing = this.getRecord(key);

        if (existing) {
            if (existing.fingerprint !== fingerprint) {
                throw new UnprocessableEntityException(
                    'Idempotency-Key already used with a different request body',
                );
            }
            response.setHeader('Idempotency-Replay', 'true');
            return of(existing.response);
        }

        return next.handle().pipe(
            tap((body) => {
                this.setRecord(key, {
                    fingerprint,
                    response: body,
                    expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
                });
            }),
        );
    }

    private fingerprint(body: unknown): string {
        return createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
    }

    private getRecord(key: string): IdempotencyRecord | undefined {
        const record = this.store.get(key);
        if (!record) return undefined;
        if (record.expiresAt < Date.now()) {
            this.store.delete(key);
            return undefined;
        }
        return record;
    }

    private setRecord(key: string, record: IdempotencyRecord): void {
        if (this.store.size >= IDEMPOTENCY_MAX_ENTRIES) {
            const oldestKey = this.store.keys().next().value;
            if (oldestKey) this.store.delete(oldestKey);
        }
        this.store.set(key, record);
    }
}
import { createHash } from 'node:crypto';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { LimitResult, Limiter } from '../ratelimit/sliding-window-limiter';

export class LoginThrottle {
    private readonly logger = new Logger(LoginThrottle.name);

    constructor(private readonly limiter: Limiter) {}

    async consume(ip: string, email: string): Promise<LimitResult> {
        const emailHash = createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32);
        try {
            return await this.limiter.consume(`${ip}:${emailHash}`);
        } catch (error) {
            this.logger.error(`ліміт входу недоступний, запит відхилено (fail-closed): ${(error as Error).message}`);
            throw new ServiceUnavailableException('Не вдалося перевірити ліміт спроб входу, спробуйте пізніше');
        }
    }
}
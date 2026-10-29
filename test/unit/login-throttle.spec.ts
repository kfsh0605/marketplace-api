import { ServiceUnavailableException } from '@nestjs/common';
import { LoginThrottle } from '../../src/auth/login-throttle';
import type { Limiter } from '../../src/ratelimit/sliding-window-limiter';

describe('LoginThrottle', () => {
    it('ключ залежить від IP і нормалізованого email, але не містить самого email', async () => {
        const keys: string[] = [];
        const limiter: Limiter = {
            consume: async (id) => {
                keys.push(id);
                return { allowed: true, remaining: 1, retryAfterSec: 0 };
            },
        };
        const throttle = new LoginThrottle(limiter);

        await throttle.consume('10.0.0.1', ' Alice@Example.com ');
        await throttle.consume('10.0.0.1', 'alice@example.com');
        await throttle.consume('10.0.0.2', 'alice@example.com');

        expect(keys[0]).toBe(keys[1]);
        expect(keys[0]).not.toBe(keys[2]);
        expect(keys[0]).not.toContain('alice');
    });

    it('помилка Redis -> 503 (fail-closed), а не пропуск спроби', async () => {
        const limiter: Limiter = {
            consume: async () => {
                throw new Error('ECONNREFUSED');
            },
        };

        await expect(new LoginThrottle(limiter).consume('10.0.0.1', 'a@b.c')).rejects.toBeInstanceOf(
            ServiceUnavailableException,
        );
    });
});
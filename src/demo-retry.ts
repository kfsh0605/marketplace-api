import 'reflect-metadata';
import { AppDataSource } from './data-source';
import { User } from './entities/user.entity';
import { sleep } from './lib/sleep';
import type { EntityManager } from 'typeorm';

const RETRYABLE_CODES = new Set(['40001', '40P01']);

async function withRetry<T>(
    label: string,
    fn: (manager: EntityManager) => Promise<T>,
    maxAttempts = 5,
): Promise<T> {
    for (let attempt = 1; ; attempt++) {
        try {
            return await AppDataSource.transaction('REPEATABLE READ', fn);
        } catch (err: any) {
            const code = err?.code ?? err?.driverError?.code;
            if (RETRYABLE_CODES.has(code) && attempt < maxAttempts) {
                const backoff = Math.round(2 ** attempt * 25 + Math.random() * 25);
                console.log(`[${label}] спроба ${attempt} впала з ${code} (serialization failure), повтор через ${backoff} мс`);
                await sleep(backoff);
                continue;
            }
            throw err; // будь-який інший код — це справжня помилка, її не ретраїмо
        }
    }
}

async function bump(label: string, userId: number, deltaCents: number, thinkMs: number) {
    return withRetry(label, async (manager) => {
        const rows = await manager.query(
            `SELECT "balanceCents" FROM users WHERE id = $1`,
            [userId],
        );
        const current: number = rows[0].balanceCents;
        await sleep(thinkMs); // навмисна затримка — саме тут утворюється вікно гонки
        await manager.query(
            `UPDATE users SET "balanceCents" = $1 WHERE id = $2`,
            [current + deltaCents, userId],
        );
    });
}

async function main() {
    await AppDataSource.initialize();

    const userRepo = AppDataSource.getRepository(User);
    const email = 'demo-retry@example.com';
    await userRepo.upsert({ email, name: 'Demo Retry User', balanceCents: 100_000 }, ['email']);
    const user = await userRepo.findOneByOrFail({ email });

    console.log(`Стартовий баланс: ${user.balanceCents}`);
    console.log('A додає +5000, B знімає -3000, конкурентно під REPEATABLE READ...');

    await Promise.all([
        bump('A', user.id, 5000, 150),
        bump('B', user.id, -3000, 50),
    ]);

    const finalUser = await userRepo.findOneByOrFail({ email });
    const expected = 100_000 + 5000 - 3000;

    console.log(`Фінальний баланс: ${finalUser.balanceCents} (очікували ${expected})`);

    await AppDataSource.destroy();

    if (finalUser.balanceCents !== expected) {
        console.error('ІНВАРІАНТ ПОРУШЕНО: фінальний баланс не сходиться.');
        process.exit(1);
    }
    console.log('OK: обидві операції застосувались коректно, retry відпрацював.');
    process.exit(0);
}

main().catch((err) => {
    console.error('demo:retry failed:', err);
    process.exit(1);
});
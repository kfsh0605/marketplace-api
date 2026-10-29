import { ConfigService } from '@nestjs/config';
import { RefreshTokenService, RotationResult } from '../../src/auth/refresh-token.service';
import { Env } from '../../src/config/env.schema';
import { insertUser } from './testkit/builders';
import { PgHandle, startPg } from './testkit/pg-container';
import { resetDatabase } from './testkit/reset-database';

const PEPPER = 'integration-pepper-'.repeat(3);

function rotated(result: RotationResult): string {
    if (result.kind !== 'rotated') {
        throw new Error(`очікували rotated, отримали ${result.reason}`);
    }
    return result.token;
}

describe('RefreshTokenService: ротація й детекція повторного використання', () => {
    let pg: PgHandle;
    let service: RefreshTokenService;
    let userId: number;

    beforeAll(async () => {
        pg = await startPg('refresh');
        const config = { get: () => PEPPER } as unknown as ConfigService<Env, true>;
        service = new RefreshTokenService(pg.dataSource, config);
    }, 120_000);

    afterAll(async () => {
        await pg.stop();
    });

    beforeEach(async () => {
        await resetDatabase(pg.dataSource);
        const user = await insertUser(pg.dataSource);
        userId = user.id;
    });

    async function countRows(where = 'true'): Promise<number> {
        const rows = await pg.dataSource.query(`SELECT count(*)::int AS n FROM refresh_tokens WHERE ${where}`);
        return rows[0].n;
    }

    it('у базі лежить HMAC-хеш, а не сам токен', async () => {
        const { token } = await service.issue(userId);
        const rows = await pg.dataSource.query(`SELECT token_hash FROM refresh_tokens`);

        expect(token).toHaveLength(43);
        expect(rows).toHaveLength(1);
        expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
        expect(rows[0].token_hash).not.toBe(token);
        const byRawToken = await pg.dataSource.query(`SELECT 1 FROM refresh_tokens WHERE token_hash = $1`, [token]);
        expect(byRawToken).toHaveLength(0);
    });

    it('ротація: R1 дає R2 тієї самої сім\'ї, R1 позначено використаним', async () => {
        const { token: r1, familyId } = await service.issue(userId);
        const result = await service.rotate(r1);

        expect(result).toMatchObject({ kind: 'rotated', userId, familyId });
        expect(rotated(result)).not.toBe(r1);
        expect(await countRows()).toBe(2);
        expect(await countRows(`family_id = '${familyId}'`)).toBe(2);
        expect(await countRows('used_at IS NOT NULL')).toBe(1);
        expect(await countRows('revoked_at IS NOT NULL')).toBe(0);
    });

    it('повтор R1: відмова reused, уся сім\'я відкликана (відкат транзакції не з\'їдає відкликання)', async () => {
        const { token: r1, familyId } = await service.issue(userId);
        const r2 = rotated(await service.rotate(r1));

        const reuse = await service.rotate(r1);
        expect(reuse).toMatchObject({ kind: 'rejected', reason: 'reused', familyId, revokedRows: 2 });
        expect(await countRows('revoked_at IS NOT NULL')).toBe(2);

        const afterReuse = await service.rotate(r2);
        expect(afterReuse).toMatchObject({ kind: 'rejected', reason: 'revoked', familyId });
        expect(await countRows('revoked_at IS NULL')).toBe(0);
    });

    it('невідомий токен і сміття: unknown', async () => {
        expect(await service.rotate('A'.repeat(43))).toEqual({ kind: 'rejected', reason: 'unknown' });
        expect(await service.rotate('not-a-token')).toEqual({ kind: 'rejected', reason: 'unknown' });
    });

    it('протермінований токен: expired, нового не видано', async () => {
        const { token } = await service.issue(userId);
        await pg.dataSource.query(`UPDATE refresh_tokens SET expires_at = now() - interval '1 second'`);

        const result = await service.rotate(token);

        expect(result).toMatchObject({ kind: 'rejected', reason: 'expired' });
        expect(await countRows()).toBe(1);
        expect(await countRows('used_at IS NOT NULL')).toBe(0);
    });

    it('два паралельні refresh одного токена: рівно один проходить, сім\'я гине', async () => {
        const { token } = await service.issue(userId);

        const results = await Promise.all([service.rotate(token), service.rotate(token)]);
        const kinds = results.map((r) => (r.kind === 'rotated' ? 'rotated' : (r as { reason: string }).reason)).sort();

        expect(kinds).toEqual(['reused', 'rotated']);
        expect(await countRows('revoked_at IS NULL')).toBe(0);
    });

    it('абсолютний строк сім\'ї: новий токен не живе довше, ніж початок + 30 діб', async () => {
        const { token } = await service.issue(userId);
        await pg.dataSource.query(
            `UPDATE refresh_tokens SET family_started_at = now() - interval '29 days', expires_at = now() + interval '1 day'`,
        );

        rotated(await service.rotate(token));

        expect(await countRows(`expires_at <= family_started_at + interval '30 days'`)).toBe(2);
        expect(await countRows(`used_at IS NULL AND expires_at < now() + interval '2 days'`)).toBe(1);
    });

    it('revokeFamily відкликає всю сім\'ю й повертає кількість рядків', async () => {
        const { token, familyId } = await service.issue(userId);
        rotated(await service.rotate(token));

        expect(await service.revokeFamily(familyId)).toBe(2);
        expect(await service.revokeFamily(familyId)).toBe(0);
    });
});
import type { Redis } from 'ioredis';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { AccessDenylist, denyFamilyKey, denyJtiKey } from '../../src/auth/access-denylist';
import { ACCESS_TTL_SEC } from '../../src/auth/auth.constants';
import { createSessionClient } from '../../src/redis/connect';

const nowSec = (): number => Math.floor(Date.now() / 1000);

describe('AccessDenylist: відкликання access-токенів у Redis з TTL', () => {
    let container: StartedTestContainer;
    let redis: Redis;
    let denylist: AccessDenylist;
    let url: string;

    beforeAll(async () => {
        container = await new GenericContainer('redis:8.4-alpine')
            .withExposedPorts(6379)
            .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
            .start();
        url = `redis://${container.getHost()}:${container.getMappedPort(6379)}`;
        redis = await createSessionClient(url);
        denylist = new AccessDenylist(redis);
    }, 120_000);

    afterAll(async () => {
        await redis.quit();
        await container.stop();
    });

    beforeEach(async () => {
        await redis.flushdb();
    });

    it('після revokeAccess токен відхиляється, чужий jti — ні', async () => {
        const mine = { jti: 'jti-a', familyId: 'fam-1' };
        const other = { jti: 'jti-b', familyId: 'fam-2' };
        expect(await denylist.isDenied(mine)).toBe(false);

        expect(await denylist.revokeAccess('jti-a', nowSec() + 600)).toBe(true);

        expect(await denylist.isDenied(mine)).toBe(true);
        expect(await denylist.isDenied(other)).toBe(false);
    });

    it('TTL ключа jti дорівнює залишку життя токена, а не фіксованому значенню', async () => {
        await denylist.revokeAccess('jti-ttl', nowSec() + 100);

        const ttl = await redis.ttl(denyJtiKey('jti-ttl'));

        expect(ttl).toBeGreaterThan(95);
        expect(ttl).toBeLessThanOrEqual(100);
    });

    it('токен, що вже сплив, у денілісті не потрібен: ключ не створюється', async () => {
        expect(await denylist.revokeAccess('jti-old', nowSec() - 5)).toBe(false);

        expect(await redis.exists(denyJtiKey('jti-old'))).toBe(0);
    });

    it('revokeFamily відхиляє всі access-токени сім\'ї, інші сім\'ї не чіпає; TTL = життя access', async () => {
        await denylist.revokeFamily('fam-dead');

        expect(await denylist.isDenied({ jti: 'x1', familyId: 'fam-dead' })).toBe(true);
        expect(await denylist.isDenied({ jti: 'x2', familyId: 'fam-dead' })).toBe(true);
        expect(await denylist.isDenied({ jti: 'x3', familyId: 'fam-alive' })).toBe(false);
        const ttl = await redis.ttl(denyFamilyKey('fam-dead'));
        expect(ttl).toBeGreaterThan(ACCESS_TTL_SEC - 5);
        expect(ttl).toBeLessThanOrEqual(ACCESS_TTL_SEC);
    });

    it('запис сам зникає, коли токен би й так спливло', async () => {
        await denylist.revokeAccess('jti-short', nowSec() + 1);
        expect(await denylist.isDenied({ jti: 'jti-short', familyId: 'f' })).toBe(true);

        await new Promise((resolve) => setTimeout(resolve, 2200));

        expect(await denylist.isDenied({ jti: 'jti-short', familyId: 'f' })).toBe(false);
        expect(await redis.dbsize()).toBe(0);
    });

    it('повторний revokeAccess того самого jti безпечний', async () => {
        await denylist.revokeAccess('jti-twice', nowSec() + 60);
        await denylist.revokeAccess('jti-twice', nowSec() + 60);

        expect(await denylist.isDenied({ jti: 'jti-twice', familyId: 'f' })).toBe(true);
        expect(await redis.dbsize()).toBe(1);
    });

    it('Redis недоступний: isDenied кидає помилку (fail-closed), а не відповідає «не відкликано»', async () => {
        const broken = await createSessionClient(url);
        const brokenDenylist = new AccessDenylist(broken);
        broken.disconnect();

        await expect(brokenDenylist.isDenied({ jti: 'x', familyId: 'f' })).rejects.toThrow();
    });
});
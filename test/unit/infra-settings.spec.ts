import { PROFILE_SPECS, PROFILES } from '../../infra/src/profiles';
import { DEFINED_SECRETS, REQUIRED_SECRETS, loadSettings } from '../../infra/src/settings';

function fullEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const name of REQUIRED_SECRETS) {
        env[name] = `value-of-${name}`;
    }
    for (const name of DEFINED_SECRETS) {
        env[name] = '';
    }
    return env;
}

describe('infra: валідація змінних зі сховища (критерій 5)', () => {
    it('повний набір проходить, дефолти розумні', () => {
        const settings = loadSettings(fullEnv());
        expect(settings.profile).toBe('zero');
        expect(settings.replicas).toBe(3);
        expect(settings.context).toBe('kind-hw28');
        expect(settings.image).toBe('marketplace-api:hw28');
    });

    it.each([...REQUIRED_SECRETS])('без %s падає і називає змінну', (name) => {
        const env = fullEnv();
        delete env[name];
        expect(() => loadSettings(env)).toThrow(name);
    });

    it.each([...REQUIRED_SECRETS])('порожній %s теж вважається відсутнім', (name) => {
        const env = fullEnv();
        env[name] = '   ';
        expect(() => loadSettings(env)).toThrow(name);
    });

    it.each([...DEFINED_SECRETS])('%s може бути порожнім, але не відсутнім', (name) => {
        const empty = fullEnv();
        empty[name] = '';
        expect(() => loadSettings(empty)).not.toThrow();

        const missing = fullEnv();
        delete missing[name];
        expect(() => loadSettings(missing)).toThrow(name);
    });

    it('кілька відсутніх змінних називаються разом', () => {
        const env = fullEnv();
        delete env.DB_PASSWORD;
        delete env.JWT_KID;
        expect(() => loadSettings(env)).toThrow(/DB_PASSWORD.*JWT_KID/);
    });

    it('значення секретів не потрапляють у повідомлення про помилку', () => {
        const env = fullEnv();
        env.DB_PASSWORD = 'super-secret-value';
        delete env.JWT_KID;
        expect(() => loadSettings(env)).toThrow(expect.not.objectContaining({ message: expect.stringContaining('super-secret-value') }));
    });
});

describe('infra: профілі і параметри', () => {
    it('невідомий профіль відкидається', () => {
        const env = { ...fullEnv(), ROLLOUT_PROFILE: 'turbo' };
        expect(() => loadSettings(env)).toThrow(/ROLLOUT_PROFILE/);
    });

    it('одна репліка відкидається: PDB без другої репліки це самообман', () => {
        expect(() => loadSettings({ ...fullEnv(), REPLICAS: '1' })).toThrow(/REPLICAS/);
        expect(() => loadSettings({ ...fullEnv(), REPLICAS: 'abc' })).toThrow(/REPLICAS/);
        expect(loadSettings({ ...fullEnv(), REPLICAS: '2' }).replicas).toBe(2);
    });

    it('профіль zero: grace більший за дренаж, maxUnavailable 0', () => {
        const zero = PROFILE_SPECS.zero;
        expect((zero.gracePeriodSeconds ?? 0) * 1000).toBeGreaterThan(zero.drainMs);
        expect(zero.strategy.maxUnavailable).toBe(0);
        expect(zero.probes).toBe(true);
    });

    it('профіль naive свідомо ламає всі чотири налаштування', () => {
        const naive = PROFILE_SPECS.naive;
        expect(naive.probes).toBe(false);
        expect(naive.strategy.maxUnavailable).not.toBe(0);
        expect(naive.drainMs).toBe(0);
        expect(naive.gracePeriodSeconds).toBeUndefined();
    });

    it('набір профілів відповідає типу', () => {
        expect(Object.keys(PROFILE_SPECS).sort()).toEqual([...PROFILES].sort());
    });
});
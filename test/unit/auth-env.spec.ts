import { generateKeyPairSync } from 'node:crypto';
import { validateAuthEnv } from '../../src/config/auth-env';
import type { Env } from '../../src/config/env.schema';

function generatePair(): { privateKey: string; publicKey: string } {
    return generateKeyPairSync('ec', {
        namedCurve: 'P-256',
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
}

const b64 = (pem: string): string => Buffer.from(pem).toString('base64');

describe('validateAuthEnv: попередній ключ', () => {
    const current = generatePair();
    const previous = generatePair();

    function envWith(extra: Record<string, string | undefined>): Env {
        return {
            JWT_KID: 'key-2',
            JWT_PRIVATE_KEY: b64(current.privateKey),
            JWT_PUBLIC_KEY: b64(current.publicKey),
            ...extra,
        } as unknown as Env;
    }

    it('без попереднього ключа конфіг валідний', () => {
        expect(() => validateAuthEnv(envWith({}))).not.toThrow();
    });

    it('обидві змінні попереднього ключа разом валідні', () => {
        const env = envWith({ JWT_PREVIOUS_KID: 'key-1', JWT_PREVIOUS_PUBLIC_KEY: b64(previous.publicKey) });

        expect(() => validateAuthEnv(env)).not.toThrow();
    });

    it('лише kid без ключа: помилка називає JWT_PREVIOUS_PUBLIC_KEY', () => {
        expect(() => validateAuthEnv(envWith({ JWT_PREVIOUS_KID: 'key-1' }))).toThrow('JWT_PREVIOUS_PUBLIC_KEY');
    });

    it('лише ключ без kid: помилка називає JWT_PREVIOUS_KID', () => {
        const env = envWith({ JWT_PREVIOUS_PUBLIC_KEY: b64(previous.publicKey) });

        expect(() => validateAuthEnv(env)).toThrow('JWT_PREVIOUS_KID');
    });

    it('kid попереднього збігається з поточним: помилка', () => {
        const env = envWith({ JWT_PREVIOUS_KID: 'key-2', JWT_PREVIOUS_PUBLIC_KEY: b64(previous.publicKey) });

        expect(() => validateAuthEnv(env)).toThrow('JWT_PREVIOUS_KID');
    });

    it('сміття замість публічного ключа: помилка називає JWT_PREVIOUS_PUBLIC_KEY', () => {
        const env = envWith({ JWT_PREVIOUS_KID: 'key-1', JWT_PREVIOUS_PUBLIC_KEY: b64('not a key') });

        expect(() => validateAuthEnv(env)).toThrow('JWT_PREVIOUS_PUBLIC_KEY');
    });
});
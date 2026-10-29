import { ConfigService } from '@nestjs/config';
import { generateKeyPairSync } from 'node:crypto';
import { KeyStore } from '../../src/auth/key-store';
import { TokenService } from '../../src/auth/token.service';
import { Env } from '../../src/config/env.schema';

interface PemPair {
    privateKey: string;
    publicKey: string;
}

function generatePair(): PemPair {
    return generateKeyPairSync('ec', {
        namedCurve: 'P-256',
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
}

const b64 = (pem: string): string => Buffer.from(pem).toString('base64');

function buildService(kid: string, pair: PemPair, previous?: { kid: string; publicKey: string }): TokenService {
    const values: Record<string, string | undefined> = {
        JWT_KID: kid,
        JWT_PRIVATE_KEY: b64(pair.privateKey),
        JWT_PUBLIC_KEY: b64(pair.publicKey),
        JWT_PREVIOUS_KID: previous?.kid,
        JWT_PREVIOUS_PUBLIC_KEY: previous ? b64(previous.publicKey) : undefined,
    };
    const config = { get: (name: string) => values[name] } as unknown as ConfigService<Env, true>;
    return new TokenService(new KeyStore(config));
}

describe('KeyStore: ротація з перекриттям', () => {
    const oldPair = generatePair();
    const newPair = generatePair();
    const input = { userId: 7, role: 'customer' as const, familyId: 'family-7' };
    const previous = { kid: 'key-1', publicKey: oldPair.publicKey };

    it('токен зі старим kid проходить, поки старий публічний ключ лежить у слоті попереднього', () => {
        const oldToken = buildService('key-1', oldPair).signAccess(input).token;
        const rotated = buildService('key-2', newPair, previous);

        expect(rotated.verifyAccess(oldToken).userId).toBe(7);
        expect(rotated.verifyAccess(rotated.signAccess(input).token).userId).toBe(7);
    });

    it('нові токени підписуються лише поточним ключем: у заголовку kid=key-2', () => {
        const rotated = buildService('key-2', newPair, previous);
        const token = rotated.signAccess(input).token;
        const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString()) as { kid: string };

        expect(header.kid).toBe('key-2');
    });

    it('після прибирання попереднього ключа токен зі старим kid відхиляється', () => {
        const oldToken = buildService('key-1', oldPair).signAccess(input).token;
        const withoutPrevious = buildService('key-2', newPair);

        expect(() => withoutPrevious.verifyAccess(oldToken)).toThrow('невідомий kid');
    });

    it('чужа пара під kid попереднього ключа не проходить: підпис не збігається', () => {
        const attacker = generatePair();
        const forged = buildService('key-1', attacker).signAccess(input).token;
        const rotated = buildService('key-2', newPair, previous);

        expect(() => rotated.verifyAccess(forged)).toThrow();
    });
});
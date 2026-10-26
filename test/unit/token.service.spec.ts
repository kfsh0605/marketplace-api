import { ConfigService } from '@nestjs/config';
import { createPrivateKey, generateKeyPairSync } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import { JWT_AUDIENCE, JWT_ISSUER } from '../../src/auth/auth.constants';
import { KeyStore } from '../../src/auth/key-store';
import { TokenService } from '../../src/auth/token.service';
import { Env } from '../../src/config/env.schema';

const KID = 'test-kid';

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

function buildService(pair: PemPair): TokenService {
    const values: Record<string, string> = {
        JWT_KID: KID,
        JWT_PRIVATE_KEY: Buffer.from(pair.privateKey).toString('base64'),
        JWT_PUBLIC_KEY: Buffer.from(pair.publicKey).toString('base64'),
    };
    const config = { get: (name: string) => values[name] } as unknown as ConfigService<Env, true>;
    return new TokenService(new KeyStore(config));
}

function base64url(value: unknown): string {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function nowSec(): number {
    return Math.floor(Date.now() / 1000);
}

function signManually(
    pair: PemPair,
    options: { kid?: string; audience?: string; expiresAt?: number } = {},
): string {
    return jwt.sign(
        { role: 'admin', fid: 'forged-family', exp: options.expiresAt ?? nowSec() + 600 },
        createPrivateKey(pair.privateKey),
        {
            algorithm: 'ES256',
            keyid: options.kid ?? KID,
            issuer: JWT_ISSUER,
            audience: options.audience ?? JWT_AUDIENCE,
            subject: '1',
            jwtid: 'manual-jti',
        },
    );
}

describe('TokenService: access JWT ES256', () => {
    const pair = generatePair();
    const service = buildService(pair);
    const input = { userId: 42, role: 'seller' as const, familyId: 'family-1' };

    it('підписаний токен проходить перевірку, claims на місці', () => {
        const { token, jti, expiresIn } = service.signAccess(input);
        const principal = service.verifyAccess(token);

        expect(principal.userId).toBe(42);
        expect(principal.role).toBe('seller');
        expect(principal.familyId).toBe('family-1');
        expect(principal.jti).toBe(jti);
        expect(principal.expiresAt).toBeGreaterThan(nowSec());
        expect(expiresIn).toBe(600);
    });

    it('у заголовку alg=ES256 і kid ключа', () => {
        const { token } = service.signAccess(input);
        const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());

        expect(header).toEqual({ alg: 'ES256', typ: 'JWT', kid: KID });
    });

    it('підміна payload (role -> admin) зі старим підписом: відмова', () => {
        const { token } = service.signAccess(input);
        const [header, payload, signature] = token.split('.');
        const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString());
        parsed.role = 'admin';
        const forged = [header, base64url(parsed), signature].join('.');

        expect(() => service.verifyAccess(forged)).toThrow('invalid signature');
    });

    it('alg=none: відмова', () => {
        const forged = `${base64url({ alg: 'none', typ: 'JWT', kid: KID })}.${base64url({
            sub: '1',
            role: 'admin',
            fid: 'x',
            jti: 'x',
            iss: JWT_ISSUER,
            aud: JWT_AUDIENCE,
            exp: nowSec() + 600,
        })}.`;

        expect(() => service.verifyAccess(forged)).toThrow('jwt signature is required');
    });

    it('algorithm confusion: HS256, підписаний публічним ключем як секретом: відмова', () => {
        const forged = jwt.sign({ role: 'admin', fid: 'x' }, pair.publicKey, {
            algorithm: 'HS256',
            keyid: KID,
            issuer: JWT_ISSUER,
            audience: JWT_AUDIENCE,
            subject: '1',
            jwtid: 'x',
            expiresIn: 600,
        });

        expect(() => service.verifyAccess(forged)).toThrow('invalid algorithm');
    });

    it('невідомий kid: відмова', () => {
        const token = signManually(pair, { kid: 'rotated-away' });

        expect(() => service.verifyAccess(token)).toThrow('невідомий kid');
    });

    it('протермінований токен: відмова', () => {
        const token = signManually(pair, { expiresAt: nowSec() - 10 });

        expect(() => service.verifyAccess(token)).toThrow(jwt.TokenExpiredError);
    });

    it('чужий aud: відмова', () => {
        const token = signManually(pair, { audience: 'another-service' });

        expect(() => service.verifyAccess(token)).toThrow('jwt audience invalid');
    });

    it('токен із тим самим kid, але підписаний чужим ключем: відмова', () => {
        const token = signManually(generatePair());

        expect(() => service.verifyAccess(token)).toThrow('invalid signature');
    });

    it('токен без exp: відмова', () => {
        const token = jwt.sign({ role: 'admin', fid: 'x' }, createPrivateKey(pair.privateKey), {
            algorithm: 'ES256',
            keyid: KID,
            issuer: JWT_ISSUER,
            audience: JWT_AUDIENCE,
            subject: '1',
            jwtid: 'no-exp',
        });

        expect(() => service.verifyAccess(token)).toThrow('некоректні claims токена');
    });

    it('сміття замість токена: відмова', () => {
        expect(() => service.verifyAccess('not-a-jwt')).toThrow();
    });
});
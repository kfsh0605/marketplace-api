import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import { ACCESS_TTL_SEC, JWT_AUDIENCE, JWT_ISSUER, SIGNING_ALG } from './auth.constants';
import { KeyStore } from './key-store';
import { USER_ROLES, UserRole } from './roles';

export interface AccessPrincipal {
    userId: number;
    role: UserRole;
    jti: string;
    familyId: string;
    expiresAt: number;
}

export interface SignedAccessToken {
    token: string;
    jti: string;
    expiresIn: number;
}

@Injectable()
export class TokenService {
    constructor(private readonly keys: KeyStore) {}

    signAccess(input: { userId: number; role: UserRole; familyId: string }): SignedAccessToken {
        const jti = randomUUID();
        const token = jwt.sign({ role: input.role, fid: input.familyId }, this.keys.signingKey, {
            algorithm: SIGNING_ALG,
            keyid: this.keys.kid,
            issuer: JWT_ISSUER,
            audience: JWT_AUDIENCE,
            subject: String(input.userId),
            jwtid: jti,
            expiresIn: ACCESS_TTL_SEC,
        });
        return { token, jti, expiresIn: ACCESS_TTL_SEC };
    }

    verifyAccess(token: string): AccessPrincipal {
        const unverified = jwt.decode(token, { complete: true });
        const key = this.keys.verificationKey(unverified?.header.kid);

        const payload = jwt.verify(token, key, {
            algorithms: [SIGNING_ALG],
            issuer: JWT_ISSUER,
            audience: JWT_AUDIENCE,
        });
        if (typeof payload === 'string') {
            throw new Error('некоректні claims токена');
        }

        const userId = Number(payload.sub);
        const { role, fid, jti, exp } = payload;
        if (
            !Number.isInteger(userId) ||
            userId <= 0 ||
            !USER_ROLES.includes(role as UserRole) ||
            typeof fid !== 'string' ||
            typeof jti !== 'string' ||
            typeof exp !== 'number'
        ) {
            throw new Error('некоректні claims токена');
        }
        return { userId, role: role as UserRole, jti, familyId: fid, expiresAt: exp };
    }
}
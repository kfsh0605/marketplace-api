import type { Redis } from 'ioredis';
import { ACCESS_TTL_SEC } from './auth.constants';

export const DENY_JTI_PREFIX = 'deny:jti:';
export const DENY_FAMILY_PREFIX = 'deny:fam:';

export const denyJtiKey = (jti: string): string => `${DENY_JTI_PREFIX}${jti}`;
export const denyFamilyKey = (familyId: string): string => `${DENY_FAMILY_PREFIX}${familyId}`;

export interface AccessIdentity {
    jti: string;
    familyId: string;
}

export class AccessDenylist {
    constructor(private readonly redis: Redis) {}

    async revokeAccess(jti: string, expiresAtSec: number, nowMs: number = Date.now()): Promise<boolean> {
        const remainingSec = Math.ceil(expiresAtSec - nowMs / 1000);
        if (remainingSec <= 0) {
            return false;
        }
        await this.redis.set(denyJtiKey(jti), '1', 'EX', remainingSec);
        return true;
    }

    async revokeFamily(familyId: string): Promise<void> {
        await this.redis.set(denyFamilyKey(familyId), '1', 'EX', ACCESS_TTL_SEC);
    }

    async isDenied({ jti, familyId }: AccessIdentity): Promise<boolean> {
        return (await this.redis.exists(denyJtiKey(jti), denyFamilyKey(familyId))) > 0;
    }
}
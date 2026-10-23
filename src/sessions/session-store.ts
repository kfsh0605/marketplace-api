import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';

export const SESSION_TTL_SEC = 1800;
export const SESSION_ABSOLUTE_TTL_SEC = 86400;

export interface SessionData {
    createdAt: number;
    values: Record<string, unknown>;
}

export interface SessionStoreOptions {
    ttlSec?: number;
    absoluteTtlSec?: number;
}

const SID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const sessionKey = (sid: string): string => `sess:${sid}`;

export class SessionStore {
    readonly ttlSec: number;
    private readonly absoluteTtlSec: number;

    constructor(
        private readonly redis: Redis,
        options: SessionStoreOptions = {},
    ) {
        this.ttlSec = options.ttlSec ?? SESSION_TTL_SEC;
        this.absoluteTtlSec = options.absoluteTtlSec ?? SESSION_ABSOLUTE_TTL_SEC;
    }

    async create(values: Record<string, unknown>): Promise<string> {
        const sid = randomBytes(32).toString('base64url');
        const data: SessionData = { createdAt: Date.now(), values };
        await this.redis.set(sessionKey(sid), JSON.stringify(data), 'EX', this.ttlSec);
        return sid;
    }

    async get(sid: string): Promise<SessionData | null> {
        if (!SID_PATTERN.test(sid)) {
            return null;
        }
        const raw = await this.redis.getex(sessionKey(sid), 'EX', this.ttlSec);
        if (raw === null) {
            return null;
        }
        let data: SessionData;
        try {
            data = JSON.parse(raw) as SessionData;
        } catch {
            await this.redis.del(sessionKey(sid));
            return null;
        }
        if (Date.now() - data.createdAt > this.absoluteTtlSec * 1000) {
            await this.redis.del(sessionKey(sid));
            return null;
        }
        return data;
    }

    async destroy(sid: string): Promise<void> {
        if (SID_PATTERN.test(sid)) {
            await this.redis.del(sessionKey(sid));
        }
    }
}
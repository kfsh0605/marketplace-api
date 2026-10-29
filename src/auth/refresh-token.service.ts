import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { Env } from '../config/env.schema';
import { REFRESH_ABSOLUTE_TTL_SEC, REFRESH_TTL_SEC } from './auth.constants';

export type RejectReason = 'unknown' | 'revoked' | 'reused' | 'expired';

export interface IssuedRefreshToken {
    token: string;
    familyId: string;
}

export type RotationResult =
    | { kind: 'rotated'; userId: number; familyId: string; token: string }
    | { kind: 'rejected'; reason: RejectReason; userId?: number; familyId?: string; revokedRows?: number };

interface TokenRow {
    id: string;
    user_id: number;
    family_id: string;
    used_at: Date | null;
    revoked_at: Date | null;
    expired: boolean;
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

@Injectable()
export class RefreshTokenService {
    private readonly logger = new Logger(RefreshTokenService.name);
    private readonly pepper: string;

    constructor(
        private readonly dataSource: DataSource,
        config: ConfigService<Env, true>,
    ) {
        this.pepper = config.get('REFRESH_TOKEN_PEPPER', { infer: true });
    }

    async issue(userId: number, manager: EntityManager = this.dataSource.manager): Promise<IssuedRefreshToken> {
        const token = this.generate();
        const familyId = randomUUID();
        await manager.query(
            `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, family_started_at)
             VALUES ($1, $2, $3, now() + $4::int * interval '1 second', now())`,
            [userId, familyId, this.hash(token), REFRESH_TTL_SEC],
        );
        return { token, familyId };
    }

    async rotate(token: string): Promise<RotationResult> {
        if (!TOKEN_PATTERN.test(token)) {
            return { kind: 'rejected', reason: 'unknown' };
        }

        const result = await this.dataSource.transaction(async (manager): Promise<RotationResult> => {
            const rows: TokenRow[] = await manager.query(
                `SELECT id, user_id, family_id, used_at, revoked_at, (expires_at <= now()) AS expired
                   FROM refresh_tokens
                  WHERE token_hash = $1
                    FOR UPDATE`,
                [this.hash(token)],
            );
            const row = rows[0];
            if (!row) {
                return { kind: 'rejected', reason: 'unknown' };
            }

            const owner = { userId: row.user_id, familyId: row.family_id };
            if (row.revoked_at) {
                return { kind: 'rejected', reason: 'revoked', ...owner };
            }
            if (row.used_at) {
                const revokedRows = await this.revokeFamily(row.family_id, manager);
                return { kind: 'rejected', reason: 'reused', ...owner, revokedRows };
            }
            if (row.expired) {
                return { kind: 'rejected', reason: 'expired', ...owner };
            }

            const next = this.generate();
            await manager.query(`UPDATE refresh_tokens SET used_at = now() WHERE id = $1`, [row.id]);
            await manager.query(
                `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, family_started_at)
                 SELECT user_id,
                        family_id,
                        $2,
                        LEAST(now() + $3::int * interval '1 second', family_started_at + $4::int * interval '1 second'),
                        family_started_at
                   FROM refresh_tokens
                  WHERE id = $1`,
                [row.id, this.hash(next), REFRESH_TTL_SEC, REFRESH_ABSOLUTE_TTL_SEC],
            );
            return { kind: 'rotated', ...owner, token: next };
        });

        if (result.kind === 'rejected' && result.reason === 'reused') {
            this.logger.error(
                `[ІНЦИДЕНТ] refresh_reuse_detected — family=${result.familyId} user=${result.userId} відкликано рядків: ${result.revokedRows}`,
            );
        }
        return result;
    }

    async revokeFamily(familyId: string, manager: EntityManager = this.dataSource.manager): Promise<number> {
        const [, affected]: [unknown, number] = await manager.query(
            `UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`,
            [familyId],
        );
        return affected;
    }

    private generate(): string {
        return randomBytes(32).toString('base64url');
    }

    private hash(token: string): string {
        return createHmac('sha256', this.pepper).update(token).digest('hex');
    }
}
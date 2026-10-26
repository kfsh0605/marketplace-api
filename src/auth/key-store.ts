import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { KeyObject } from 'node:crypto';
import { Env } from '../config/env.schema';
import { loadEs256PrivateKey, loadEs256PublicKey, publicKeyFingerprint } from '../config/jwt-keys';

@Injectable()
export class KeyStore {
    private readonly logger = new Logger(KeyStore.name);
    private readonly verificationKeys = new Map<string, KeyObject>();
    readonly kid: string;
    readonly signingKey: KeyObject;

    constructor(config: ConfigService<Env, true>) {
        this.kid = config.get('JWT_KID', { infer: true });
        this.signingKey = loadEs256PrivateKey(config.get('JWT_PRIVATE_KEY', { infer: true }));
        const publicKey = loadEs256PublicKey(config.get('JWT_PUBLIC_KEY', { infer: true }));
        this.verificationKeys.set(this.kid, publicKey);
        this.logger.log(`ключ підпису: kid=${this.kid} fp=${publicKeyFingerprint(publicKey)}`);
    }

    verificationKey(kid: string | undefined): KeyObject {
        const key = kid ? this.verificationKeys.get(kid) : undefined;
        if (!key) {
            throw new Error('невідомий kid');
        }
        return key;
    }
}
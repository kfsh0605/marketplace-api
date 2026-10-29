import { Env } from './env.schema';
import { loadEs256PrivateKey, loadEs256PublicKey, publicKeyFingerprint } from './jwt-keys';
import type { KeyObject } from 'node:crypto';

function fail(variable: string, reason: string): never {
    throw new Error(`Помилка конфігурації середовища: ${variable}: ${reason}`);
}

const BAD_KEY = 'не base64 від PEM-ключа EC P-256 (ES256); згенеруй: node scripts/gen-jwt-keys.mjs dev';

export function validateAuthEnv(env: Env): Env {
    let privateKey: KeyObject;
    let publicKey: KeyObject;

    try {
        privateKey = loadEs256PrivateKey(env.JWT_PRIVATE_KEY);
    } catch {
        return fail('JWT_PRIVATE_KEY', BAD_KEY);
    }

    try {
        publicKey = loadEs256PublicKey(env.JWT_PUBLIC_KEY);
    } catch {
        return fail('JWT_PUBLIC_KEY', BAD_KEY);
    }

    if (publicKeyFingerprint(privateKey) !== publicKeyFingerprint(publicKey)) {
        return fail('JWT_PUBLIC_KEY', 'не відповідає JWT_PRIVATE_KEY (різні пари ключів)');
    }

    const previousKid = env.JWT_PREVIOUS_KID;
    const previousPublicKey = env.JWT_PREVIOUS_PUBLIC_KEY;

    if (Boolean(previousKid) !== Boolean(previousPublicKey)) {
        return fail(
            previousKid ? 'JWT_PREVIOUS_PUBLIC_KEY' : 'JWT_PREVIOUS_KID',
            'потрібні обидві змінні попереднього ключа разом (або жодної)',
        );
    }

    if (previousKid && previousPublicKey) {
        if (previousKid === env.JWT_KID) {
            return fail('JWT_PREVIOUS_KID', 'збігається з JWT_KID: поточний і попередній ключі мають різні kid');
        }
        try {
            loadEs256PublicKey(previousPublicKey);
        } catch {
            return fail('JWT_PREVIOUS_PUBLIC_KEY', BAD_KEY);
        }
    }

    return env;
}
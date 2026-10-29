import { createHash, createPrivateKey, createPublicKey, KeyObject } from 'node:crypto';

function decodePem(base64: string): string {
    return Buffer.from(base64, 'base64').toString('utf8');
}

function assertEs256(key: KeyObject): void {
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
        throw new Error('очікується ключ EC P-256 (ES256)');
    }
}

export function loadEs256PrivateKey(base64: string): KeyObject {
    const key = createPrivateKey(decodePem(base64));
    assertEs256(key);
    return key;
}

export function loadEs256PublicKey(base64: string): KeyObject {
    const key = createPublicKey(decodePem(base64));
    assertEs256(key);
    return key;
}

export function publicKeyFingerprint(key: KeyObject): string {
    const publicKey = key.type === 'private' ? createPublicKey(key) : key;
    const der = publicKey.export({ type: 'spki', format: 'der' });
    return createHash('sha256').update(der).digest('hex').slice(0, 8);
}
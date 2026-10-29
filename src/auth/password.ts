import * as argon2 from 'argon2';

const OPTIONS = {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
} as const;

let timingEqualizer: Promise<string> | undefined;

export function hashPassword(password: string): Promise<string> {
    return argon2.hash(password, OPTIONS);
}

export async function verifyPassword(hash: string | null | undefined, password: string): Promise<boolean> {
    if (!hash) {
        timingEqualizer ??= argon2.hash('timing-equalizer', OPTIONS);
        await argon2.verify(await timingEqualizer, password);
        return false;
    }
    try {
        return await argon2.verify(hash, password);
    } catch {
        return false;
    }
}
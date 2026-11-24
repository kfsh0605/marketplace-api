import { createHmac, timingSafeEqual } from 'node:crypto';

/** Заголовок підпису: `t=<unix-секунди>,v1=<hex HMAC-SHA256>` (формат як у Stripe). */
export const SIGNATURE_HEADER = 'x-webhook-signature';

/** Скільки секунд віку дозволено підписаній події. Підпис без часу вічний, перехоплений запит можна слати знову. */
export const TOLERANCE_SECONDS = 300;

export type SignatureFailure = 'missing' | 'malformed' | 'stale' | 'mismatch';
export type SignatureCheck = { ok: true } | { ok: false; reason: SignatureFailure };

/** HMAC над `<t>.` + сирі байти тіла. Саме байти: після JSON.parse і stringify порядок ключів і пробіли змінилися б. */
export function computeSignature(secret: string, timestamp: number, rawBody: Buffer): string {
    return createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
}

export function buildSignatureHeader(secret: string, rawBody: Buffer, timestamp: number): string {
    return `t=${timestamp},v1=${computeSignature(secret, timestamp, rawBody)}`;
}

function parseHeader(header: string): { timestamp: number; signatures: string[] } | null {
    let timestamp: number | null = null;
    const signatures: string[] = [];
    for (const part of header.split(',')) {
        const eq = part.indexOf('=');
        if (eq < 0) {
            return null;
        }
        const key = part.slice(0, eq).trim();
        const value = part.slice(eq + 1).trim();
        if (key === 't' && /^\d{1,12}$/.test(value)) {
            timestamp = Number(value);
        } else if (key === 'v1' && /^[0-9a-fA-F]{64}$/.test(value)) {
            signatures.push(value.toLowerCase());
        }
    }
    return timestamp === null || signatures.length === 0 ? null : { timestamp, signatures };
}

export function verifySignature(input: {
    secret: string;
    header: string | undefined;
    rawBody: Buffer;
    nowSeconds: number;
    toleranceSeconds?: number;
}): SignatureCheck {
    if (!input.header) {
        return { ok: false, reason: 'missing' };
    }
    const parsed = parseHeader(input.header);
    if (!parsed) {
        return { ok: false, reason: 'malformed' };
    }

    const expected = Buffer.from(computeSignature(input.secret, parsed.timestamp, input.rawBody), 'hex');
    // Порівнюємо в постійний час; довжини однакові (перевірено регулярним виразом: 64 hex = 32 байти)
    const matches = parsed.signatures.some((candidate) => timingSafeEqual(Buffer.from(candidate, 'hex'), expected));
    if (!matches) {
        return { ok: false, reason: 'mismatch' };
    }

    // Час перевіряємо ПІСЛЯ підпису: інакше за відповіддю можна було б вгадувати, чи свіжа мітка
    const tolerance = input.toleranceSeconds ?? TOLERANCE_SECONDS;
    if (Math.abs(input.nowSeconds - parsed.timestamp) > tolerance) {
        return { ok: false, reason: 'stale' };
    }
    return { ok: true };
}

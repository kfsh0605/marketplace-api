// Проверка OIDC-токена (JWT), который выписал чужой издатель (у нас GitHub Actions).
// Без внешних библиотек: подпись проверяет node:crypto по публичному ключу из jwks_uri издателя.
// Токен нигде не печатается; наружу выходят только проверенные iss, aud, sub.
import { createPublicKey, verify } from 'node:crypto';

const LEEWAY_SECONDS = 60;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

const decodePart = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

export async function defaultFetchJson(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
        throw new Error(`${url} -> HTTP ${response.status}`);
    }
    return response.json();
}

function checkClaims(payload, { issuer, audience, subjects, now }) {
    const reasons = [];
    if (payload.iss !== issuer) {
        reasons.push(`iss "${payload.iss}" не збігається з очікуваним "${issuer}"`);
    }
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(audience)) {
        reasons.push(`aud не містить "${audience}"`);
    }
    if (typeof payload.exp !== 'number') {
        reasons.push('у токені немає exp');
    } else if (payload.exp + LEEWAY_SECONDS < now) {
        reasons.push(`токен прострочений (exp=${payload.exp}, зараз ${now})`);
    }
    if (typeof payload.nbf === 'number' && payload.nbf - LEEWAY_SECONDS > now) {
        reasons.push('токен ще не діє (nbf у майбутньому)');
    }
    if (typeof payload.sub !== 'string' || !subjects.includes(payload.sub)) {
        reasons.push(`sub "${payload.sub}" не входить до дозволеного списку (policy.subjects)`);
    }
    return reasons;
}

/**
 * Повертає { sigVerified, policyAllow, iss, aud, sub, reasons }.
 * policyAllow можливий лише після успішної перевірки підпису: умова на sub до перевіреного токена не застосовується.
 */
export async function verifyToken({
    token,
    issuer,
    audience,
    subjects,
    jwksUri,
    fetchJson = defaultFetchJson,
    now = Math.floor(Date.now() / 1000),
    allowLoopbackHttp = false,
}) {
    const result = { sigVerified: 0, policyAllow: 0, iss: '', aud: '', sub: '', reasons: [] };
    const fail = (reason) => {
        result.reasons.push(reason);
        return result;
    };

    const issuerUrl = new URL(issuer);
    const loopback = LOOPBACK_HOSTS.has(issuerUrl.hostname);
    if (issuerUrl.protocol !== 'https:' && !(allowLoopbackHttp && loopback)) {
        return fail(`issuer ${issuer} має бути https`);
    }

    const parts = String(token).split('.');
    if (parts.length !== 3) {
        return fail('це не JWT: має бути три частини через крапку');
    }
    let header;
    let payload;
    try {
        header = decodePart(parts[0]);
        payload = decodePart(parts[1]);
    } catch {
        return fail('заголовок або тіло токена не є коректним JSON');
    }
    result.iss = String(payload.iss ?? '');
    result.aud = Array.isArray(payload.aud) ? payload.aud.join(',') : String(payload.aud ?? '');
    result.sub = String(payload.sub ?? '');

    // Лише RS256: ні "none", ні HS256 (підміна алгоритму: публічний ключ як HMAC-секрет).
    if (header.alg !== 'RS256') {
        return fail(`alg "${header.alg}" не дозволений, приймається лише RS256`);
    }
    if (!parts[2]) {
        return fail('у токена порожній підпис');
    }

    // Адреса набору ключів береться з openid-configuration самого издателя, якщо не задана явно.
    let keysUrl = jwksUri;
    try {
        if (!keysUrl) {
            const configuration = await fetchJson(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`);
            if (configuration.issuer !== issuer) {
                return fail(`openid-configuration повертає issuer "${configuration.issuer}", а очікується "${issuer}"`);
            }
            keysUrl = configuration.jwks_uri;
        }
        const jwks = await fetchJson(keysUrl);
        const jwk = (jwks.keys ?? []).find((key) => key.kid === header.kid && key.kty === 'RSA');
        if (!jwk) {
            return fail(`у наборі ключів немає RSA-ключа з kid "${header.kid}"`);
        }
        const publicKey = createPublicKey({ key: jwk, format: 'jwk' });
        if ((publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
            return fail('RSA-ключ коротший за 2048 біт');
        }
        const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
        const signature = Buffer.from(parts[2], 'base64url');
        if (!verify('RSA-SHA256', signed, publicKey, signature)) {
            return fail('підпис не збігається з публічним ключем з jwks_uri');
        }
    } catch (error) {
        return fail(`не вдалося перевірити підпис: ${error.message}`);
    }
    result.sigVerified = 1;

    const problems = checkClaims(payload, { issuer, audience, subjects, now });
    if (problems.length === 0) {
        result.policyAllow = 1;
    } else {
        result.reasons.push(...problems);
    }
    return result;
}

// npm run demo:oidc - тот же гейт, что стоит в конвеєрі (scripts/lib/oidc.mjs), на трьох токенах без хмари.
// Токен GitHub живе хвилини й у репозиторій не кладеться, тому скрипт сам генерує RSA-пару, піднімає локального
// «издателя» (openid-configuration + jwks) і підписує токени своїм ключем. Підписи справжні.
//   green          коректний підпис, дозволений sub     -> 1 1
//   foreign-sub    коректний підпис, sub чужого репо    -> 1 0
//   bad-signature  той самий payload, зіпсований підпис -> 0 0
// Додатково: wrong-aud, expired, alg-none, які теж мають бути відхилені.
import { createServer } from 'node:http';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { verifyToken } from './lib/oidc.mjs';

const policy = JSON.parse(readFileSync(process.env.OIDC_POLICY ?? 'oidc/policy.json', 'utf8'));
const KID = 'demo-key-1';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwks = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' }] };

const b64u = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

function sign(payload, { alg = 'RS256', kid = KID } = {}) {
    const head = b64u({ alg, typ: 'JWT', kid });
    const body = b64u(payload);
    if (alg === 'none') {
        return `${head}.${body}.`;
    }
    const signer = createSign('RSA-SHA256');
    signer.update(`${head}.${body}`);
    return `${head}.${body}.${signer.sign(privateKey).toString('base64url')}`;
}

function corrupt(token) {
    const [head, body, signature] = token.split('.');
    const flipped = `${signature.slice(0, 10)}${signature[10] === 'A' ? 'B' : 'A'}${signature.slice(11)}`;
    return `${head}.${body}.${flipped}`;
}

const server = createServer((request, response) => {
    const issuer = `http://127.0.0.1:${server.address().port}`;
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/.well-known/openid-configuration') {
        response.end(JSON.stringify({ issuer, jwks_uri: `${issuer}/.well-known/jwks` }));
    } else if (request.url === '/.well-known/jwks') {
        response.end(JSON.stringify(jwks));
    } else {
        response.statusCode = 404;
        response.end('{}');
    }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const issuer = `http://127.0.0.1:${server.address().port}`;

const now = Math.floor(Date.now() / 1000);
const claims = { iss: issuer, aud: policy.audience, sub: policy.subjects[0], iat: now, nbf: now, exp: now + 600 };
const green = sign(claims);

const cases = [
    { name: 'green', token: green, expect: [1, 1] },
    { name: 'foreign-sub', token: sign({ ...claims, sub: 'repo:evil-org/attacker-repo:environment:prod' }), expect: [1, 0] },
    { name: 'bad-signature', token: corrupt(green), expect: [0, 0] },
    { name: 'wrong-aud', token: sign({ ...claims, aud: 'https://evil.example' }), expect: [1, 0] },
    { name: 'expired', token: sign({ ...claims, iat: now - 7200, nbf: now - 7200, exp: now - 3600 }), expect: [1, 0] },
    { name: 'alg-none', token: sign(claims, { alg: 'none' }), expect: [0, 0] },
];

let unexpected = 0;
try {
    for (const { name, token, expect } of cases) {
        const verdict = await verifyToken({
            token,
            issuer,
            audience: policy.audience,
            subjects: policy.subjects,
            allowLoopbackHttp: true,
        });
        console.log(`case=${name}`);
        console.log(`sig-verified=${verdict.sigVerified}`);
        console.log(`policy-allow=${verdict.policyAllow}`);
        console.log(`sub=${verdict.sub}`);
        if (verdict.reasons.length > 0) {
            console.log(`reason=${verdict.reasons[0]}`);
        }
        if (verdict.sigVerified !== expect[0] || verdict.policyAllow !== expect[1]) {
            unexpected += 1;
            console.error(`demo:oidc: ${name} очікувалося ${expect.join(' ')}, отримано ${verdict.sigVerified} ${verdict.policyAllow}`);
        }
    }
} finally {
    server.close();
}
console.log(`cases=${cases.length}`);
console.log(`unexpected=${unexpected}`);
process.exitCode = unexpected === 0 ? 0 : 1;

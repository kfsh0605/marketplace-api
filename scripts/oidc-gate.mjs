// Гейт OIDC: просит у GitHub ID-токен, проверяет его подпись по jwks_uri издателя и применяет
// условие из oidc/policy.json. Код выхода 0 - пускаем, 1 - отказ (джоба деплоя не стартует), 2 - гейт не смог отработать.
// Печатает iss, aud, sub и вердикты, но не сам токен.
//   в GitHub Actions: токен берётся по ACTIONS_ID_TOKEN_REQUEST_URL (нужен permissions: id-token: write на джобе)
//   вне Actions: токен из файла --token-file или из переменной OIDC_TOKEN
import { appendFileSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { verifyToken } from './lib/oidc.mjs';

const { values } = parseArgs({
    options: {
        policy: { type: 'string', default: 'oidc/policy.json' },
        issuer: { type: 'string' },
        audience: { type: 'string' },
        'jwks-uri': { type: 'string' },
        'token-file': { type: 'string' },
        'evidence-out': { type: 'string' },
    },
});

const policy = JSON.parse(readFileSync(values.policy, 'utf8'));
const issuer = values.issuer ?? policy.issuer;
const audience = values.audience ?? policy.audience;

async function obtainToken() {
    if (values['token-file']) {
        return { token: readFileSync(values['token-file'], 'utf8').trim(), source: 'file' };
    }
    const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    if (requestUrl) {
        const url = new URL(requestUrl);
        url.searchParams.set('audience', audience);
        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
            signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) {
            throw new Error(`GitHub не видав ID-токен: HTTP ${response.status}. Чи є на джобі permissions: id-token: write?`);
        }
        const body = await response.json();
        return { token: body.value, source: 'github' };
    }
    if (process.env.OIDC_TOKEN) {
        return { token: process.env.OIDC_TOKEN, source: 'env' };
    }
    throw new Error('немає токена: задайте --token-file, OIDC_TOKEN або запустіть у GitHub Actions з id-token: write');
}

let outcome;
try {
    const { token, source } = await obtainToken();
    if (process.env.GITHUB_ACTIONS === 'true') {
        // Додатковий запобіжник: якщо токен усе ж потрапить у вивід, раннер замаскує його точне входження.
        console.log(`::add-mask::${token}`);
    }
    outcome = await verifyToken({
        token,
        issuer,
        audience,
        subjects: policy.subjects,
        jwksUri: values['jwks-uri'],
    });
    outcome.source = source;
} catch (error) {
    console.error(`oidc-gate: ${error.message}`);
    process.exit(2);
}

const lines = [
    `oidc-iss=${outcome.iss}`,
    `oidc-aud=${outcome.aud}`,
    `oidc-sub=${outcome.sub}`,
    `oidc-sig-verified=${outcome.sigVerified}`,
    `oidc-policy-allow=${outcome.policyAllow}`,
];
for (const line of lines) {
    console.log(line);
}
for (const reason of outcome.reasons) {
    console.error(`oidc-gate: ${reason}`);
}

if (values['evidence-out']) {
    appendFileSync(values['evidence-out'], `creds-source=oidc\n${lines.join('\n')}\n`);
}
if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
        process.env.GITHUB_OUTPUT,
        `iss=${outcome.iss}\naud=${outcome.aud}\nsub=${outcome.sub}\nsig_verified=${outcome.sigVerified}\nallow=${outcome.policyAllow}\n`,
    );
}

console.log(`oidc-gate=${outcome.policyAllow === 1 ? 'allow' : 'deny'}`);
process.exitCode = outcome.policyAllow === 1 ? 0 : 1;

// Допоміжні кроки конвеєра, які рахують числа для артефакту pipeline-evidence.
//   node scripts/ci-evidence.mjs rollout <rollout.txt>            -> rollout-requests/ok/failed/seconds
//   node scripts/ci-evidence.mjs secret-count <deployment.json>   -> secret-in-manifest=N (скільки значень сховища
//                                                                    трапилось у маніфесті відкритим текстом)
//   node scripts/ci-evidence.mjs assemble --parts <dir> --out <dir> -> evidence.txt та файли доказів
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const [command, ...rest] = process.argv.slice(2);

function readKeyValue(text) {
    const result = new Map();
    for (const line of text.split(/\r?\n/)) {
        const match = /^([A-Za-z0-9_-]+)=(.*)$/.exec(line);
        if (match) {
            result.set(match[1], match[2]);
        }
    }
    return result;
}

function walk(directory) {
    if (!existsSync(directory)) {
        return [];
    }
    return readdirSync(directory).flatMap((name) => {
        const path = join(directory, name);
        return statSync(path).isDirectory() ? walk(path) : [path];
    });
}

function rollout(file) {
    const values = readKeyValue(readFileSync(file, 'utf8'));
    for (const [from, to] of [['requests', 'rollout-requests'], ['ok', 'rollout-ok'], ['failed', 'rollout-failed'], ['rollout-seconds', 'rollout-seconds']]) {
        if (!values.has(from)) {
            console.error(`ci-evidence: у ${file} немає рядка ${from}=...`);
            return 1;
        }
        console.log(`${to}=${values.get(from)}`);
    }
    return 0;
}

function vaultValues() {
    const candidates = [
        'secrets/db_password', 'secrets/rabbitmq_password', 'secrets/storage_access_key', 'secrets/storage_secret_key',
        'secrets/grafana_admin_password', 'secrets/pulumi_passphrase',
        'secrets/jwt/dev/refresh_pepper', 'secrets/jwt/dev/private.pem',
    ];
    const values = [];
    for (const path of candidates) {
        if (!existsSync(path)) {
            continue;
        }
        const raw = readFileSync(path, 'utf8').trim();
        values.push(raw, Buffer.from(readFileSync(path)).toString('base64'));
    }
    return values.filter((value) => value.length >= 8);
}

function secretCount(file) {
    const manifest = readFileSync(file, 'utf8');
    const values = vaultValues();
    if (values.length === 0) {
        console.error('ci-evidence: у secrets/ немає значень, рахувати нічого: спершу bash scripts/ci-vault.sh');
        return 2;
    }
    let count = 0;
    for (const value of values) {
        count += manifest.split(value).length - 1;
    }
    console.log(`secret-in-manifest=${count}`);
    return 0;
}

function assemble(argv) {
    const { values } = parseArgs({ args: argv, options: { parts: { type: 'string' }, out: { type: 'string' } } });
    const parts = values.parts;
    const out = values.out;
    if (!parts || !out) {
        console.error('assemble: потрібні --parts і --out');
        return 2;
    }
    mkdirSync(out, { recursive: true });

    const files = walk(parts);
    const merged = new Map();
    for (const file of files.filter((name) => name.endsWith('.env')).sort()) {
        for (const [key, value] of readKeyValue(readFileSync(file, 'utf8'))) {
            merged.set(key, value);
        }
    }

    for (const name of ['deployment.json', 'plan.json', 'rollout.txt', 'build.log']) {
        const source = files.find((file) => file.endsWith(`/${name}`) || file === join(parts, name));
        if (source) {
            copyFileSync(source, join(out, name));
        }
    }

    const buildLog = join(out, 'build.log');
    const invocations = existsSync(buildLog) ? readFileSync(buildLog, 'utf8').split('\n').filter((line) => line.trim() !== '').length : 0;

    const header = new Map([
        ['run-id', process.env.GITHUB_RUN_ID ?? ''],
        ['head-sha', process.env.HEAD_SHA ?? ''],
    ]);
    const order = [
        'image-ref', 'built-digest', 'deployed-digest', 'build-invocations', 'creds-source',
        'oidc-iss', 'oidc-aud', 'oidc-sub', 'oidc-sig-verified',
        'rollout-requests', 'rollout-ok', 'rollout-failed', 'rollout-seconds',
        'secret-in-manifest', 'gate-scan-exit', 'cost-plan-usd', 'cost-budget-usd', 'cost-gate',
    ];
    merged.set('build-invocations', String(invocations));

    const lines = [...header].map(([key, value]) => `${key}=${value}`);
    for (const key of order) {
        lines.push(`${key}=${merged.get(key) ?? ''}`);
    }
    writeFileSync(join(out, 'evidence.txt'), `${lines.join('\n')}\n`);
    console.log(`ci-evidence: evidence.txt зібрано, частин: ${files.length}`);
    for (const line of lines) {
        console.log(`  ${line}`);
    }
    return 0;
}

let code = 2;
if (command === 'rollout' && rest[0]) {
    code = rollout(rest[0]);
} else if (command === 'secret-count' && rest[0]) {
    code = secretCount(rest[0]);
} else if (command === 'assemble') {
    code = assemble(rest);
} else {
    console.error('використання: ci-evidence.mjs rollout <file> | secret-count <file> | assemble --parts <dir> --out <dir>');
}
process.exitCode = code;

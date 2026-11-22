// Скачивает oasdiff нужной версии, проверяет sha256 и запускает его.
// Версия и хеши закреплены в коде: так же, как Trivy в scripts/scan.mjs закреплён по digest.
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const OASDIFF_VERSION = '1.39.0';

const ASSETS = {
    'linux-x64': {
        file: `oasdiff_${OASDIFF_VERSION}_linux_amd64.tar.gz`,
        sha256: '71a85930728f367a2086077b7ae1411319421549d18473a3e8258b6451520433',
        bin: 'oasdiff',
    },
    'linux-arm64': {
        file: `oasdiff_${OASDIFF_VERSION}_linux_arm64.tar.gz`,
        sha256: '481db7d891d916f13df277b2ef8bbb95477702827710e49fe22cef69c359c780',
        bin: 'oasdiff',
    },
    'win32-x64': {
        file: `oasdiff_${OASDIFF_VERSION}_windows_amd64.tar.gz`,
        sha256: '956a73df88e03efdf3fcc5f327446cc176fefe4adcea1978b0fef464a1ee8901',
        bin: 'oasdiff.exe',
    },
    'darwin-x64': {
        file: `oasdiff_${OASDIFF_VERSION}_darwin_all.tar.gz`,
        sha256: 'fe88d9950324d3b0ebeaf8e0d3a210b64cb099a0f55fce5ee5a22b276df0eac4',
        bin: 'oasdiff',
    },
    'darwin-arm64': {
        file: `oasdiff_${OASDIFF_VERSION}_darwin_all.tar.gz`,
        sha256: 'fe88d9950324d3b0ebeaf8e0d3a210b64cb099a0f55fce5ee5a22b276df0eac4',
        bin: 'oasdiff',
    },
};

export async function ensureOasdiff() {
    if (process.env.OASDIFF_BIN) {
        return process.env.OASDIFF_BIN;
    }

    const asset = ASSETS[`${process.platform}-${process.arch}`];
    if (!asset) {
        throw new Error(`oasdiff: платформа ${process.platform}-${process.arch} не підтримується, задайте OASDIFF_BIN`);
    }

    const dir = join(ROOT, '.tools', 'oasdiff', OASDIFF_VERSION);
    const bin = join(dir, asset.bin);
    if (existsSync(bin)) {
        return bin;
    }

    mkdirSync(dir, { recursive: true });
    const url = `https://github.com/oasdiff/oasdiff/releases/download/v${OASDIFF_VERSION}/${asset.file}`;
    console.error(`oasdiff: завантажую ${asset.file}`);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`oasdiff: ${url} -> HTTP ${response.status}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());

    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== asset.sha256) {
        throw new Error(`oasdiff: sha256 не збігається (очікувалось ${asset.sha256}, отримано ${actual}), архів відкинуто`);
    }

    // tar запускаємо з відносними іменами: GNU tar на Windows сприймає "C:\..." як віддалений хост.
    writeFileSync(join(dir, asset.file), bytes);
    const unpacked = spawnSync('tar', ['-xzf', asset.file], { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'] });
    if (unpacked.status !== 0) {
        throw new Error(`oasdiff: tar -xzf ${asset.file} -> код ${unpacked.status}`);
    }
    if (process.platform !== 'win32') {
        chmodSync(bin, 0o755);
    }
    return bin;
}

// Порівнює дві специфікації. Код виходу 1 означає, що друга ламає першу (рівень ERR).
export async function runBreaking(basePath, revisionPath) {
    const bin = await ensureOasdiff();
    const result = spawnSync(bin, ['breaking', basePath, revisionPath, '--fail-on', 'ERR'], { encoding: 'utf8' });
    if (result.error) {
        throw result.error;
    }
    return { code: result.status ?? 2, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

export function readText(path) {
    return readFileSync(path, 'utf8');
}

// npm run demo:gates - четыре сходинки гейтов качества, каждая в обе стороны:
//   <сходинка>-ok      код выхода гейта на корректном входе (должен быть 0)
//   <сходинка>-broken  код выхода того же гейта на зумисне сломанном входе (должен быть не 0)
// Это те же инструменты, что стоят в конвейере; здесь они просто запускаются дважды с разным входом.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dump, load } from 'js-yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NODE = process.execPath;
const bin = (...parts) => join(ROOT, 'node_modules', ...parts);
const TSC = bin('typescript', 'bin', 'tsc');
const ESLINT = bin('eslint', 'bin', 'eslint.js');
const DEPCRUISE = bin('dependency-cruiser', 'bin', 'dependency-cruiser.mjs');

function run(label, args, env = {}) {
    const result = spawnSync(NODE, args, {
        cwd: ROOT,
        env: { ...process.env, ...env },
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    });
    const code = result.status ?? 2;
    console.error(`  ${label}: код ${code}`);
    if (process.env.DEMO_GATES_VERBOSE === '1') {
        process.stderr.write(`${result.stdout ?? ''}${result.stderr ?? ''}`);
    }
    return { code, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

// Скорочення для місць, де потрібен лише код виходу.
const exit = (label, args, env) => run(label, args, env).code;

// tsc 6.x не читає tsconfig.json, якщо файл названо в командному рядку, і падає з TS5112 (код 1)
// навіть на коректному файлі. Тому --ignoreConfig, а опції, які раніше давав tsconfig, передаємо явно.
const TSC_FILE_OPTIONS = ['--ignoreConfig', '--noEmit', '--strict', '--target', 'ES2021', '--module', 'commonjs', '--skipLibCheck'];

// «Зламано» тільки тоді, коли гейт упав саме через тип: код не 0 І в виводі очікуваний код помилки.
// Інакше (як із TS5112) червоний код виходу нічого не доводить — гейт міг впасти через конфіг.
function expectDiagnostic(label, args, diagnostic) {
    const { code, output } = run(label, args);
    if (code === 0) {
        return 0;
    }
    if (!output.includes(diagnostic)) {
        console.error(`  ${label}: код ${code}, але в виводі немає ${diagnostic} - впало не на типі`);
        return -1;
    }
    return code;
}

const worst = (...codes) => codes.find((code) => code !== 0) ?? 0;

function brokenContract(tempDir) {
    const spec = load(readFileSync(join(ROOT, 'openapi.yaml'), 'utf8'));
    const order = spec.components.schemas.Order;
    delete order.properties.totalCents;
    order.required = order.required.filter((name) => name !== 'totalCents');
    const path = join(tempDir, 'openapi-without-totalcents.yaml');
    writeFileSync(path, dump(spec, { noRefs: true }));
    return path;
}

const results = {};
const tempDir = mkdtempSync(join(tmpdir(), 'demo-gates-'));

try {
    console.error('сходинка 1: типи й стиль');
    results.types = {
        ok: worst(
            exit('tsc --noEmit', [TSC, '--noEmit']),
            exit('tsc --noEmit (тести)', [TSC, '--noEmit', '-p', 'test/tsconfig.json']),
            exit('tsc на коректному файлі', [TSC, ...TSC_FILE_OPTIONS, 'fixtures/gates/types-ok.ts']),
            exit('eslint', [ESLINT, 'src', 'test', '--max-warnings', '0']),
        ),
        broken: expectDiagnostic(
            'tsc на зламаному вході (чекаємо TS2322)',
            [TSC, ...TSC_FILE_OPTIONS, 'fixtures/gates/types-broken.ts'],
            'TS2322',
        ),
    };

    console.error('сходинка 2: контракт (oasdiff)');
    results.contract = {
        ok: exit('oasdiff, спека проти себе', ['scripts/gate-contract.mjs'], {
            BASE_SPEC: 'openapi.yaml',
            REVISION_SPEC: 'openapi.yaml',
        }),
        broken: exit('oasdiff, прибрано totalCents', ['scripts/gate-contract.mjs'], {
            BASE_SPEC: 'openapi.yaml',
            REVISION_SPEC: brokenContract(tempDir),
        }),
    };

    console.error('сходинка 3: архітектура (dependency-cruiser)');
    results.arch = {
        ok: exit('depcruise src', [DEPCRUISE, '--config', '.dependency-cruiser.cjs', 'src']),
        broken: exit('depcruise на зламаному вході', [
            DEPCRUISE,
            '--config',
            '.dependency-cruiser.cjs',
            'fixtures/gates/arch-broken/src',
        ]),
    };

    console.error('сходинка 4: образ (scan із порогом)');
    const scanEnv = { SCAN_REPORT: 'fixtures/gates/trivy-report.json' };
    results.image = {
        ok: exit('scan, SCAN_MAX=99999', ['scripts/scan.mjs'], { ...scanEnv, SCAN_MAX: '99999' }),
        broken: exit('scan, SCAN_MAX=-1', ['scripts/scan.mjs'], { ...scanEnv, SCAN_MAX: '-1' }),
    };
} finally {
    rmSync(tempDir, { recursive: true, force: true });
}

let onesided = 0;
for (const [step, { ok, broken }] of Object.entries(results)) {
    console.log(`${step}-ok=${ok}`);
    console.log(`${step}-broken=${broken}`);
    if (ok !== 0 || broken === 0 || broken < 0) {
        onesided += 1;
    }
}
console.log(`steps=${Object.keys(results).length}`);
console.log(`one-sided=${onesided}`);
process.exitCode = onesided === 0 ? 0 : 1;

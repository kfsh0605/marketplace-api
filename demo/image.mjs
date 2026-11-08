import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { countLayersWithToken, countOccurrences, countTokenInImageConfigs } from './lib/image-scan.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCKERFILE = 'docker/Dockerfile';
const IMAGE = process.env.DEMO_IMAGE ?? 'marketplace-api:demo-image';
const CONTROL_ARG = 'marketplace-api:demo-control-arg';
const CONTROL_COPY = 'marketplace-api:demo-control-copy';
const BASE = 'node:22-bookworm-slim';
const WORK = mkdtempSync(join(tmpdir(), 'hw28-image-'));

const step = (line) => console.error(`[demo:image] ${line}`);

function docker(args, options = {}) {
    return spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, cwd: ROOT, ...options });
}

function dockerOk(args, options) {
    const result = docker(args, options);
    if (result.status !== 0) {
        const tail = `${result.stderr ?? ''}`.slice(-2500);
        throw new Error(`docker ${args.slice(0, 3).join(' ')} -> код ${result.status}\n${tail}`);
    }
    return result.stdout;
}

function countStages(file) {
    return readFileSync(join(ROOT, file), 'utf8')
        .split(/\r?\n/)
        .filter((line) => /^\s*FROM\s/i.test(line)).length;
}

function shellInside(image) {
    for (const shell of ['sh', '/bin/sh', 'bash']) {
        const result = docker(['run', '--rm', '--entrypoint', shell, image, '-c', 'echo shell-ok']);
        if (result.status === 0 && result.stdout.includes('shell-ok')) {
            return 1;
        }
    }
    return 0;
}

function runtimeUid(image) {
    for (const node of ['node', '/nodejs/bin/node']) {
        const result = docker(['run', '--rm', '--entrypoint', node, image, '-e', 'process.stdout.write(String(process.getuid()))']);
        if (result.status === 0 && /^\d+$/.test(result.stdout.trim())) {
            return result.stdout.trim();
        }
    }
    return '';
}

function inHistory(image, token) {
    return countOccurrences(dockerOk(['history', '--no-trunc', '--format', '{{.CreatedBy}}', image]), token);
}

function inInspect(image, token) {
    return countOccurrences(dockerOk(['image', 'inspect', image]), token);
}

function inSavedArchive(image, token) {
    const dir = mkdtempSync(join(WORK, 'save-'));
    try {
        dockerOk(['save', '-o', 'image.tar', image], { cwd: dir });
        mkdirSync(join(dir, 'unpacked'));
        execFileSync('tar', ['-xf', 'image.tar', '-C', 'unpacked'], { cwd: dir });
        const unpacked = join(dir, 'unpacked');
        const { layers, hits } = countLayersWithToken(unpacked, token);
        if (layers === 0) {
            throw new Error('у розпакованому docker save не знайдено жодного шару: вимір порожній');
        }
        return { layers: hits, config: countTokenInImageConfigs(unpacked, token) };
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

function measure(image, token) {
    const saved = inSavedArchive(image, token);
    return {
        history: inHistory(image, token),
        config: inInspect(image, token) + saved.config,
        layers: saved.layers,
    };
}

function buildMain(token) {
    const secretFile = join(WORK, 'npm_token');
    writeFileSync(secretFile, token);
    dockerOk([
        'build',
        '--provenance=false',
        '-f', DOCKERFILE,
        '--secret', `id=npm_token,src=${secretFile}`,
        '--no-cache-filter', 'build',
        '--no-cache-filter', 'deps',
        '-t', IMAGE,
        '.',
    ]);
}

function buildControlArg(token) {
    const dir = mkdtempSync(join(WORK, 'arg-'));
    writeFileSync(
        join(dir, 'Dockerfile'),
        [`FROM ${BASE}`, 'ARG NPM_TOKEN', 'RUN test -n "$NPM_TOKEN" && echo used > /tmp/used && rm /tmp/used', ''].join('\n'),
    );
    dockerOk(['build', '--provenance=false', '--build-arg', `NPM_TOKEN=${token}`, '-t', CONTROL_ARG, dir]);
}

function buildControlCopy(token) {
    const dir = mkdtempSync(join(WORK, 'copy-'));
    writeFileSync(join(dir, 'token.txt'), token);
    writeFileSync(join(dir, 'Dockerfile'), [`FROM ${BASE}`, 'COPY token.txt /root/.npmrc', 'RUN rm /root/.npmrc', ''].join('\n'));
    dockerOk(['build', '--provenance=false', '-t', CONTROL_COPY, dir]);
}

async function main() {
    const token = `hw28-${randomBytes(16).toString('hex')}`;

    step('збираю образ із випадковим секретом (стадії build і deps без кешу)');
    buildMain(token);
    step('збираю контроль 1: токен через ARG');
    buildControlArg(token);
    step('збираю контроль 2: COPY файла і rm наступним шаром');
    buildControlCopy(token);

    step('міряю');
    const stages = countStages(DOCKERFILE);
    const shell = shellInside(IMAGE);
    const uid = runtimeUid(IMAGE);
    const real = measure(IMAGE, token);
    const controlArg = measure(CONTROL_ARG, token);
    const controlCopy = measure(CONTROL_COPY, token);

    console.log(`image=${IMAGE}`);
    console.log(`stages=${stages}`);
    console.log(`shell-inside=${shell}`);
    console.log(`runtime-uid=${uid}`);
    console.log(`token-in-history=${real.history}`);
    console.log(`token-in-config=${real.config}`);
    console.log(`token-in-layers=${real.layers}`);
    console.log(`control-arg-history=${controlArg.history}`);
    console.log(`control-arg-config=${controlArg.config}`);
    console.log(`control-arg-layers=${controlArg.layers}`);
    console.log(`control-copy-history=${controlCopy.history}`);
    console.log(`control-copy-config=${controlCopy.config}`);
    console.log(`control-copy-layers=${controlCopy.layers}`);

    const problems = [];
    if (stages < 2) problems.push('stages < 2');
    if (shell !== 0) problems.push('у фінальному образі є shell');
    if (uid === '' || uid === '0') problems.push('runtime-uid порожній або 0');
    if (real.history !== 0 || real.config !== 0 || real.layers !== 0) problems.push('секрет збірки осів в образі');
    if (controlArg.history < 1 || controlArg.config < 1) problems.push('історія й config не бачать витік через ARG: вимір сліпий');
    if (controlCopy.layers < 1) problems.push('розбір шарів не бачить витік через COPY + rm: вимір сліпий');

    if (problems.length > 0) {
        throw new Error(problems.join('; '));
    }
    console.log('OK: образ production-grade, секрет збірки ніде не осів, обидва канали витоку вимір бачить');
}

function cleanup() {
    for (const tag of [IMAGE, CONTROL_ARG, CONTROL_COPY]) {
        docker(['rmi', '-f', tag], { stdio: 'ignore' });
    }
    rmSync(WORK, { recursive: true, force: true });
}

main()
    .then(() => {
        cleanup();
    })
    .catch((error) => {
        console.error(`FAIL: ${error.message}`);
        cleanup();
        process.exit(1);
    });
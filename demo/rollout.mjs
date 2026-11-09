import { spawn } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { summarizeCodes, formatCodes, judge } = require('./lib/rollout-stats.cjs');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE = (process.env.ROLLOUT_PROFILE ?? 'zero').trim();
const CONTEXT = process.env.KUBE_CONTEXT ?? 'kind-hw28';
const NAMESPACE = process.env.K8S_NAMESPACE ?? 'marketplace';
const DEPLOYMENT = 'marketplace-api';
const HOST = '127.0.0.1';
const PORT = Number(process.env.DEMO_PORT ?? 30080);
const MIN_REQUESTS = Number(process.env.DEMO_MIN_REQUESTS ?? 5000);
const CONCURRENCY = Number(process.env.DEMO_CONCURRENCY ?? 12);
const KEEP_ALIVE = process.env.DEMO_KEEPALIVE !== '0';
const BEFORE_MS = 2000;
const TAIL_MS = 5000;
const REQUEST_TIMEOUT_MS = 5000;
const EXTRA_LOAD_LIMIT_MS = 120000;
const SHELL = process.env.npm_config_script_shell || 'bash';

const WORK = mkdtempSync(join(tmpdir(), 'hw28-rollout-'));
const CODES_FILE = join(WORK, 'codes.txt');
writeFileSync(CODES_FILE, '');

const step = (line) => console.error(`[demo:rollout] ${line}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function exec(command, args, extraEnv = {}) {
    return new Promise((resolve) => {
        const child = spawn(command, args, { cwd: ROOT, env: { ...process.env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        child.stdout.on('data', (chunk) => {
            out += chunk;
        });
        child.stderr.on('data', (chunk) => {
            err += chunk;
        });
        child.on('error', (error) => resolve({ code: -1, out, err: `${err}${error.message}` }));
        child.on('close', (code) => resolve({ code: code ?? -1, out, err }));
    });
}

async function execOk(command, args, extraEnv) {
    const result = await exec(command, args, extraEnv);
    if (result.code !== 0) {
        throw new Error(`${command} ${args.slice(0, 3).join(' ')} -> код ${result.code}\n${`${result.out}\n${result.err}`.slice(-2500)}`);
    }
    return result.out;
}

function pulumiUp(profile, rev) {
    return execOk(SHELL, ['scripts/pulumi.sh', 'up'], { ROLLOUT_PROFILE: profile, ROLLOUT_REV: rev });
}

function kubectl(args) {
    return execOk('kubectl', ['--context', CONTEXT, '-n', NAMESPACE, ...args]);
}

const agent = new http.Agent({ keepAlive: KEEP_ALIVE, maxSockets: CONCURRENCY });

function request(fresh = false) {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (code, rev = '', pod = '') => {
            if (settled) {
                return;
            }
            settled = true;
            resolve({ code, rev, pod });
        };

        const req = http.request(
            {
                host: HOST,
                port: PORT,
                path: '/products',
                method: 'GET',
                agent: fresh ? false : agent,
                headers: fresh || !KEEP_ALIVE ? { connection: 'close' } : {},
                timeout: REQUEST_TIMEOUT_MS,
            },
            (res) => {
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    let rev = '';
                    let pod = '';
                    try {
                        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                        rev = String(body.rev ?? '');
                        pod = String(body.pod ?? '');
                    } catch {
                        rev = '';
                    }
                    finish(res.statusCode ?? 0, rev, pod);
                });
                res.on('error', () => finish(0));
                res.on('close', () => finish(0));
            },
        );
        req.on('timeout', () => {
            req.destroy();
            finish(0);
        });
        req.on('error', () => finish(0));
        req.end();
    });
}

function startLoad() {
    const state = { requests: 0, revs: new Map(), stopRequested: false, hardStop: false };

    const worker = async () => {
        while (!state.hardStop && !(state.stopRequested && state.requests >= MIN_REQUESTS)) {
            const { code, rev } = await request();
            appendFileSync(CODES_FILE, `${String(code).padStart(3, '0')}\n`);
            state.requests += 1;
            if (rev !== '') {
                state.revs.set(rev, (state.revs.get(rev) ?? 0) + 1);
            }
        }
    };

    const workers = Array.from({ length: CONCURRENCY }, worker);

    return {
        state,
        async stop() {
            state.stopRequested = true;
            const timer = setTimeout(() => {
                state.hardStop = true;
            }, EXTRA_LOAD_LIMIT_MS);
            await Promise.all(workers);
            clearTimeout(timer);
        },
    };
}

async function waitUntilWarm(rev, replicas) {
    const seen = new Set();
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
        const { code, rev: answered, pod } = await request(true);
        if (code === 200 && answered === rev) {
            seen.add(pod);
        }
        if (seen.size >= replicas) {
            return;
        }
        await sleep(50);
    }
    throw new Error(`за 90 с не всі ${replicas} реплік віддали ревізію ${rev}: бачили ${seen.size}`);
}

async function main() {
    if (!['zero', 'naive'].includes(PROFILE)) {
        throw new Error(`ROLLOUT_PROFILE="${PROFILE}": дозволено zero | naive`);
    }

    const stamp = Date.now().toString(36);
    const baseRev = `${stamp}-a`;
    const newRev = `${stamp}-b`;

    step(`готуємо початковий стан: профіль ${PROFILE}, ревізія ${baseRev}`);
    await pulumiUp(PROFILE, baseRev);
    const replicas = Number((await kubectl(['get', 'deployment', DEPLOYMENT, '-o', 'jsonpath={.spec.replicas}'])).trim());
    await waitUntilWarm(baseRev, replicas);

    step(`запускаємо навантаження: ${CONCURRENCY} потоків, keep-alive=${KEEP_ALIVE ? 1 : 0}`);
    const load = startLoad();
    await sleep(BEFORE_MS);

    step(`розкочуємо ревізію ${newRev} під навантаженням`);
    const startedAt = Date.now();
    await pulumiUp(PROFILE, newRev);
    await kubectl(['rollout', 'status', `deployment/${DEPLOYMENT}`, '--timeout=120s']);
    const rolloutSeconds = (Date.now() - startedAt) / 1000;

    step(`оновлення завершено за ${rolloutSeconds.toFixed(1)} с, ще ${TAIL_MS / 1000} с тримаємо навантаження`);
    await sleep(TAIL_MS);
    await load.stop();

    const summary = summarizeCodes(readFileSync(CODES_FILE, 'utf8'));
    const oldRev = load.state.revs.get(baseRev) ?? 0;
    const newRevCount = load.state.revs.get(newRev) ?? 0;

    console.log(`profile=${PROFILE}`);
    console.log(`requests=${summary.requests}`);
    console.log(`ok=${summary.ok}`);
    console.log(`failed=${summary.failed}`);
    console.log(`rollout-seconds=${rolloutSeconds.toFixed(1)}`);
    console.log(`codes=${formatCodes(summary.byCode)}`);
    console.log(`old-rev-responses=${oldRev}`);
    console.log(`new-rev-responses=${newRevCount}`);

    const problems = judge({
        profile: PROFILE,
        requests: summary.requests,
        failed: summary.failed,
        oldRev,
        newRev: newRevCount,
        minRequests: MIN_REQUESTS,
    });

    if (problems.length > 0) {
        console.log(`FAIL: ${problems.join('; ')}`);
        return 1;
    }

    console.log(PROFILE === 'zero' ? 'OK' : `OK (контроль ${PROFILE}: втрати ${summary.failed} очікувані, це не вердикт)`);
    return 0;
}

let exitCode = 1;
try {
    exitCode = await main();
} catch (error) {
    console.error(`[demo:rollout] помилка: ${error instanceof Error ? error.message : error}`);
} finally {
    agent.destroy();
    if (PROFILE !== 'zero') {
        step('повертаємо кластер у профіль zero');
        try {
            await pulumiUp('zero', `${Date.now().toString(36)}-restore`);
        } catch (error) {
            console.error(`[demo:rollout] не вдалося повернути профіль zero: ${error instanceof Error ? error.message : error}`);
            exitCode = 1;
        }
    }
    rmSync(WORK, { recursive: true, force: true });
}
process.exit(exitCode);

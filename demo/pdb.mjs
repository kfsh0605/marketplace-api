import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { readyPodNames, pdbSnapshot, judgeEvictions } = require('./lib/pdb-logic.cjs');

const CONTEXT = process.env.KUBE_CONTEXT ?? 'kind-hw28';
const NAMESPACE = process.env.K8S_NAMESPACE ?? 'marketplace';
const APP = 'marketplace-api';

const step = (line) => console.error(`[demo:pdb] ${line}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function kubectl(args) {
    return new Promise((resolve, reject) => {
        const child = spawn('kubectl', ['--context', CONTEXT, '-n', NAMESPACE, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        child.stdout.on('data', (chunk) => {
            out += chunk;
        });
        child.stderr.on('data', (chunk) => {
            err += chunk;
        });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) {
                resolve(out);
                return;
            }
            reject(new Error(`kubectl ${args.slice(0, 3).join(' ')} -> код ${code}\n${err.slice(-1500)}`));
        });
    });
}

async function getJson(args) {
    return JSON.parse(await kubectl([...args, '-o', 'json']));
}

const readPdb = async () => pdbSnapshot(await getJson(['get', 'pdb', APP]));
const readPods = async () => readyPodNames(await getJson(['get', 'pods', '-l', `app=${APP}`]));

async function waitUntil(description, check, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await check()) {
            return;
        }
        await sleep(1000);
    }
    throw new Error(`за ${timeoutMs / 1000} с не дочекались: ${description}`);
}

function startProxy() {
    return new Promise((resolve, reject) => {
        const child = spawn('kubectl', ['--context', CONTEXT, 'proxy', '--port=0'], { stdio: ['ignore', 'pipe', 'pipe'] });
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error('kubectl proxy не запустився за 15 с'));
        }, 15000);
        child.stdout.on('data', (chunk) => {
            const match = /127\.0\.0\.1:(\d+)/.exec(String(chunk));
            if (match) {
                clearTimeout(timer);
                resolve({ port: Number(match[1]), stop: () => child.kill() });
            }
        });
        child.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
}

async function evict(port, pod) {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/namespaces/${NAMESPACE}/pods/${pod}/eviction`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiVersion: 'policy/v1', kind: 'Eviction', metadata: { name: pod, namespace: NAMESPACE } }),
    });
    await response.arrayBuffer();
    return response.status;
}

async function main() {
    const replicas = Number((await kubectl(['get', 'deployment', APP, '-o', 'jsonpath={.spec.replicas}'])).trim());

    const settled = async () => {
        const pdb = await readPdb();
        const pods = await readPods();
        return pods.length >= replicas && pdb.healthy >= replicas && pdb.disruptionsAllowed >= 1;
    };

    step('чекаємо, поки всі репліки Ready, а бюджет дозволяє хоча б одну перерву');
    await waitUntil('усі репліки Ready і disruptionsAllowed >= 1', settled, 60000);

    const before = await readPdb();
    const pods = await readPods();

    const proxy = await startProxy();
    let first;
    let second;
    try {
        first = await evict(proxy.port, pods[0]);
        second = await evict(proxy.port, pods[1]);
    } finally {
        proxy.stop();
    }

    console.log(`healthy=${before.healthy}`);
    console.log(`minAvailable=${before.minAvailable}`);
    console.log(`disruptions-allowed-before=${before.disruptionsAllowed}`);
    console.log(`evict-1=${first}`);
    console.log(`evict-2=${second}`);

    const problems = judgeEvictions(first, second);

    step('чекаємо, поки Deployment замінить виселений під');
    await waitUntil('усі репліки знову Ready і disruptionsAllowed >= 1', settled, 90000);

    if (problems.length > 0) {
        console.log(`FAIL: ${problems.join('; ')}`);
        return 1;
    }

    console.log('OK');
    return 0;
}

let exitCode = 1;
try {
    exitCode = await main();
} catch (error) {
    console.error(`[demo:pdb] помилка: ${error instanceof Error ? error.message : error}`);
}
process.exit(exitCode);
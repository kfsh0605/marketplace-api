// Просування образу замість перезбирання (deploy.yml після злиття в main).
//   node scripts/ci-promote.mjs find                        -> знаходить PR і його зелений pipeline-прогін
//   node scripts/ci-promote.mjs verify --evidence <file>    -> звіряє evidence.txt того прогону, друкує ref
// Env: GITHUB_REPOSITORY, GITHUB_SHA (коміт у main), GITHUB_TOKEN, GITHUB_OUTPUT, GITHUB_API_URL (необов'язково).
// Код виходу: 0 - можна просувати, 1 - не можна (причина в stderr), 2 - помилка запуску.
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { COST_LABEL, PIPELINE_PATH, parseEvidence, pickPullRequest, pickRun, verifyEvidence } from './lib/promote.mjs';

const [command, ...rest] = process.argv.slice(2);
const API = process.env.GITHUB_API_URL ?? 'https://api.github.com';

function need(name) {
    const value = process.env[name];
    if (!value) {
        console.error(`ci-promote: не задано ${name}`);
        process.exit(2);
    }
    return value;
}

async function github(path) {
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (process.env.GITHUB_TOKEN) {
        headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }
    const response = await fetch(`${API}${path}`, { headers });
    if (!response.ok) {
        throw new Error(`GitHub API ${path}: ${response.status} ${response.statusText}`);
    }
    return response.json();
}

function output(key, value) {
    console.log(`${key}=${value}`);
    if (process.env.GITHUB_OUTPUT) {
        appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
    }
}

async function find() {
    const repo = need('GITHUB_REPOSITORY');
    const sha = need('GITHUB_SHA');

    const pulls = await github(`/repos/${repo}/commits/${sha}/pulls?per_page=20`);
    const pr = pickPullRequest(pulls, sha);
    if (!pr) {
        console.error(
            `ci-promote: до коміту ${sha} немає злитого PR у main. Пряме проштовхування в main не проходило PR-конвеєр, ` +
                'тому нескановану збірку не викочуємо: відкрийте PR і дочекайтесь зеленого pipeline.',
        );
        return 1;
    }

    const headSha = pr.head.sha;
    const runs = await github(`/repos/${repo}/actions/runs?head_sha=${headSha}&event=pull_request&status=success&per_page=50`);
    const run = pickRun(runs.workflow_runs ?? [], headSha);
    if (!run) {
        console.error(`ci-promote: у PR #${pr.number} немає успішного прогону ${PIPELINE_PATH} на голові ${headSha}`);
        return 1;
    }

    const labels = (pr.labels ?? []).map((label) => label.name);
    output('pr-number', pr.number);
    output('pr-head-sha', headSha);
    output('run-id', run.id);
    output('cost-approved', String(labels.includes(COST_LABEL)));
    return 0;
}

function verify(argv) {
    const { values } = parseArgs({ args: argv, options: { evidence: { type: 'string' }, out: { type: 'string', default: 'ci-out' } } });
    if (!values.evidence) {
        console.error('verify: потрібен --evidence <файл>');
        return 2;
    }
    const headSha = need('PR_HEAD_SHA');
    const labels = process.env.COST_APPROVED === 'true' ? [COST_LABEL] : [];
    const evidence = parseEvidence(readFileSync(values.evidence, 'utf8'));
    const result = verifyEvidence(evidence, { prHeadSha: headSha, labels });
    if (!result.ok) {
        for (const message of result.errors) {
            console.error(`ci-promote: відмова: ${message}`);
        }
        return 1;
    }

    // Інформаційно: чи збігається вміст main з тим, що тестували в PR (не збігається, якщо main пішов далі за PR).
    let treeMatch = 'unknown';
    try {
        execFileSync('git', ['fetch', '--no-tags', '--depth=1', 'origin', headSha], { stdio: 'ignore' });
        const prTree = execFileSync('git', ['rev-parse', `${headSha}^{tree}`], { encoding: 'utf8' }).trim();
        const mainTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
        treeMatch = String(prTree === mainTree);
    } catch {
        // немає доступу до голови PR: це лише довідка, відмовою не є
    }
    if (treeMatch === 'false') {
        console.error('::warning::Вміст main не збігається з головою PR (main пішов далі). Образ усе одно той, що пройшов PR-гейти; щоб цього не було, увімкніть "Require branches to be up to date".');
    }

    const ref = evidence.get('image-ref');
    mkdirSync(values.out, { recursive: true });
    writeFileSync(
        `${values.out}/promote.env`,
        [
            `promoted-ref=${ref}`,
            `promoted-from-pr=${process.env.PR_NUMBER ?? ''}`,
            `promoted-from-run=${process.env.PR_RUN_ID ?? ''}`,
            `promoted-head-sha=${headSha}`,
            `promoted-source-tree-match=${treeMatch}`,
            `promoted-built-digest=${evidence.get('built-digest')}`,
            `promoted-scanned-digest=${evidence.get('scanned-digest')}`,
            '',
        ].join('\n'),
    );
    output('ref', ref);
    output('digest', evidence.get('built-digest'));
    return 0;
}

let code = 2;
try {
    if (command === 'find') {
        code = await find();
    } else if (command === 'verify') {
        code = verify(rest);
    } else {
        console.error('використання: ci-promote.mjs find | verify --evidence <file>');
    }
} catch (error) {
    console.error(`ci-promote: ${error instanceof Error ? error.message : String(error)}`);
    code = 2;
}
process.exitCode = code;

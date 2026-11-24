// npm run demo:promote - просування образу з PR у обидва боки на готових доказах (fixtures/promote/evidence-ok.txt).
// Одна справна evidence-картка проходить; кожна зіпсована в одному місці - відхиляється з іншою причиною.
import { readFileSync } from 'node:fs';
import { COST_LABEL, PIPELINE_PATH, parseEvidence, pickPullRequest, pickRun, verifyEvidence } from './lib/promote.mjs';

const base = readFileSync('fixtures/promote/evidence-ok.txt', 'utf8');
const HEAD = parseEvidence(base).get('head-sha');
const OTHER = `sha256:${'0'.repeat(64)}`;

const mutate = (key, value) => {
    const evidence = parseEvidence(base);
    evidence.set(key, value);
    return evidence;
};

const cases = [
    { name: 'справна картка PR', evidence: parseEvidence(base), expectOk: true },
    { name: 'зібрано одне, викочено інше (перезбірка після merge)', evidence: mutate('deployed-digest', OTHER), expectOk: false },
    { name: 'просканували не той digest', evidence: mutate('scanned-digest', OTHER), expectOk: false },
    { name: 'скан червоний', evidence: mutate('gate-scan-exit', '1'), expectOk: false },
    { name: 'дві збірки в одному прогоні', evidence: mutate('build-invocations', '2'), expectOk: false },
    { name: 'картка від іншого коміту', evidence: mutate('head-sha', 'a'.repeat(40)), expectOk: false },
    { name: 'OIDC не доведено', evidence: mutate('oidc-sig-verified', '0'), expectOk: false },
    { name: 'rollout із помилками', evidence: mutate('rollout-failed', '3'), expectOk: false },
    { name: 'секрет у маніфесті', evidence: mutate('secret-in-manifest', '1'), expectOk: false },
    { name: 'гейт вартості fail без мітки', evidence: mutate('cost-gate', 'fail'), expectOk: false },
    { name: 'гейт вартості fail із міткою', evidence: mutate('cost-gate', 'fail'), labels: [COST_LABEL], expectOk: true },
];

let unexpected = 0;
for (const item of cases) {
    const result = verifyEvidence(item.evidence, { prHeadSha: HEAD, labels: item.labels ?? [] });
    console.log(`case=${item.name}`);
    console.log(`promote=${result.ok ? 'allow' : 'deny'}`);
    for (const message of result.errors) {
        console.log(`  reason=${message}`);
    }
    if (result.ok !== item.expectOk) {
        unexpected += 1;
    }
}

// Вибір PR і прогону: чужі прогони й відкриті PR не підходять.
const pulls = [
    { number: 1, merged_at: null, base: { ref: 'main' }, merge_commit_sha: 'aaa', head: { sha: 'h1' } },
    { number: 2, merged_at: '2026-11-22T00:00:00Z', base: { ref: 'main' }, merge_commit_sha: 'bbb', head: { sha: 'h2' } },
];
const runs = [
    { id: 10, path: '.github/workflows/other.yml', event: 'pull_request', conclusion: 'success', head_sha: 'h2', created_at: '2026-11-22T10:00:00Z' },
    { id: 11, path: PIPELINE_PATH, event: 'pull_request', conclusion: 'failure', head_sha: 'h2', created_at: '2026-11-22T11:00:00Z' },
    { id: 12, path: PIPELINE_PATH, event: 'pull_request', conclusion: 'success', head_sha: 'h2', created_at: '2026-11-22T12:00:00Z' },
    { id: 13, path: PIPELINE_PATH, event: 'push', conclusion: 'success', head_sha: 'h2', created_at: '2026-11-22T13:00:00Z' },
];
const checks = [
    ['pick-pr (злитий, merge_commit_sha збігся)', pickPullRequest(pulls, 'bbb')?.number === 2],
    ['pick-pr (відкритий PR не береться)', pickPullRequest([pulls[0]], 'aaa') === undefined],
    ['pick-run (лише pipeline.yml + pull_request + success)', pickRun(runs, 'h2')?.id === 12],
    ['pick-run (на чужій голові нічого)', pickRun(runs, 'zzz') === undefined],
];
for (const [name, passed] of checks) {
    console.log(`check=${name} ${passed ? 'ok' : 'FAIL'}`);
    if (!passed) {
        unexpected += 1;
    }
}
console.log(`cases=${cases.length + checks.length}`);
console.log(`unexpected=${unexpected}`);
process.exitCode = unexpected === 0 ? 0 : 1;

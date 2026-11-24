// Чиста логіка «просування»: що має бути правдою, щоб образ із PR можна було викотити після злиття в main.
// Без мережі й файлів: усе приходить аргументами, тому demo:promote ганяє ті самі функції на фікстурах.
//
// Принцип: після злиття НЕ збираємо образ знову. Беремо digest, який у PR уже зібрали, просканували й викотили,
// і перевіряємо за evidence.txt того PR-прогону, що це справді так.

export const PIPELINE_PATH = '.github/workflows/pipeline.yml';
export const COST_LABEL = 'cost-approved';

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const IMAGE_REF = /^ghcr\.io\/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$/;

/** Розбір evidence.txt (рядки key=value) у Map. */
export function parseEvidence(text) {
    const result = new Map();
    for (const line of text.split(/\r?\n/)) {
        const match = /^([A-Za-z0-9_-]+)=(.*)$/.exec(line);
        if (match) {
            result.set(match[1], match[2]);
        }
    }
    return result;
}

/**
 * Серед PR, які GitHub знає для коміту main, лишаємо той, що справді злитий САМЕ цим комітом
 * (merge_commit_sha збігається: для merge/squash/rebase GitHub записує сюди коміт у main).
 */
export function pickPullRequest(pulls, sha) {
    const merged = pulls.filter((pr) => pr.merged_at && pr.base?.ref === 'main');
    return merged.find((pr) => pr.merge_commit_sha === sha) ?? merged[0];
}

/** Останній УСПІШНИЙ прогін pipeline.yml від події pull_request на голові PR. */
export function pickRun(runs, headSha) {
    return runs
        .filter(
            (run) =>
                run.path === PIPELINE_PATH &&
                run.event === 'pull_request' &&
                run.conclusion === 'success' &&
                run.head_sha === headSha,
        )
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
}

/**
 * Перевірка доказів PR-прогону. Повертає { ok, errors }: кожна помилка - одна причина відмови.
 * expect = { prHeadSha, labels: [назви міток PR] }.
 */
export function verifyEvidence(evidence, expect) {
    const errors = [];
    const get = (key) => evidence.get(key) ?? '';
    const need = (condition, message) => {
        if (!condition) {
            errors.push(message);
        }
    };

    need(get('head-sha') === expect.prHeadSha, `head-sha в evidence (${get('head-sha') || 'порожньо'}) не збігається з головою PR (${expect.prHeadSha})`);
    need(IMAGE_REF.test(get('image-ref')), `image-ref не схожий на ghcr.io/...@sha256:...: ${get('image-ref') || 'порожньо'}`);
    need(DIGEST.test(get('built-digest')), 'built-digest порожній або не sha256');
    need(get('image-ref').endsWith(`@${get('built-digest')}`), 'image-ref не закінчується на built-digest');
    need(get('deployed-digest') === get('built-digest'), `у PR викотили ${get('deployed-digest') || 'нічого'}, а зібрали ${get('built-digest')}`);
    need(get('scanned-digest') === get('built-digest'), `просканували ${get('scanned-digest') || 'нічого'}, а зібрали ${get('built-digest')}`);
    need(get('build-invocations') === '1', `збірок у PR-прогоні ${get('build-invocations') || '?'}, має бути рівно 1`);
    need(get('gate-scan-exit') === '0', `gate-scan-exit=${get('gate-scan-exit') || 'порожньо'}, має бути 0`);
    need(get('creds-source') === 'oidc' && get('oidc-sig-verified') === '1', 'OIDC-гейт не доведено (creds-source=oidc, oidc-sig-verified=1)');
    need(get('rollout-failed') === '0' && Number(get('rollout-requests')) > 0, `rollout: failed=${get('rollout-failed') || '?'} з ${get('rollout-requests') || '?'}`);
    need(get('secret-in-manifest') === '0', `secret-in-manifest=${get('secret-in-manifest') || '?'}, має бути 0`);

    const gate = get('cost-gate');
    const approved = (expect.labels ?? []).includes(COST_LABEL);
    need(gate === 'pass' || (gate === 'fail' && approved), `cost-gate=${gate || 'порожньо'}${gate === 'fail' ? `, а мітки ${COST_LABEL} на PR немає` : ''}`);

    return { ok: errors.length === 0, errors };
}

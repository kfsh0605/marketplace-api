// Гейт «контракт»: чи ламає ця зміна спецификації тих, хто вже живе на попередній версії.
// Порівнює openapi.yaml з голови гілки з openapi.yaml з базової гілки (за замовчуванням origin/main).
// Код виходу 0: нічого не зламано; 1: є ламаючі зміни; 2: гейт не зміг порівняти.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBreaking } from './lib/oasdiff.mjs';

const SPEC = 'openapi.yaml';
const baseRef = process.env.BASE_REF ?? 'origin/main';
const revision = process.env.REVISION_SPEC ?? SPEC;

let baseSpec = process.env.BASE_SPEC;
let tempDir;

try {
    if (!baseSpec) {
        const shown = spawnSync('git', ['show', `${baseRef}:${SPEC}`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
        if (shown.status !== 0) {
            console.error(`gate:contract: не вдалося прочитати ${baseRef}:${SPEC}: ${shown.stderr.trim()}`);
            console.error('gate:contract: без бази порівнювати нема з чим, а мовчки пропускати не можна');
            process.exit(2);
        }
        tempDir = mkdtempSync(join(tmpdir(), 'gate-contract-'));
        baseSpec = join(tempDir, 'base-openapi.yaml');
        writeFileSync(baseSpec, shown.stdout);
    }

    const { code, output } = await runBreaking(baseSpec, revision);
    process.stdout.write(output);
    console.log(`contract-base=${process.env.BASE_SPEC ?? baseRef}`);
    console.log(`contract-breaking-exit=${code}`);
    process.exitCode = code;
} finally {
    if (tempDir) {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

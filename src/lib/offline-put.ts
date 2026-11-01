import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const PASS_THROUGH = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP'];

export function putFromKeylessProcess(url: string, contentType: string, body: Buffer): number {
    const env: NodeJS.ProcessEnv = {};
    for (const name of PASS_THROUGH) {
        const value = process.env[name];
        if (value !== undefined) {
            env[name] = value;
        }
    }

    const result = spawnSync(process.execPath, [join(__dirname, 'offline-put-child.js'), url, contentType], {
        env,
        input: body,
        encoding: 'utf8',
        timeout: 30_000,
    });
    if (result.status !== 0) {
        throw new Error(`окремий процес без ключів завершився з кодом ${result.status}: ${result.stderr.trim()}`);
    }
    return Number(result.stdout.trim());
}
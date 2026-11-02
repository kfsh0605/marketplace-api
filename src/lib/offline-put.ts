import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { keylessEnv } from './keyless-env';

export function putFromKeylessProcess(url: string, contentType: string, body: Buffer): number {
    const result = spawnSync(process.execPath, [join(__dirname, 'offline-put-child.js'), url, contentType], {
        env: keylessEnv(),
        input: body,
        encoding: 'utf8',
        timeout: 30_000,
    });
    if (result.status !== 0) {
        throw new Error(`окремий процес без ключів завершився з кодом ${result.status}: ${result.stderr.trim()}`);
    }
    return Number(result.stdout.trim());
}
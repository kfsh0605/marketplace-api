import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { keylessEnv } from './keyless-env';

export interface ChildResult {
    code: number | null;
    stdout: string;
    stderr: string;
}

export function runMultipartChild(
    apiBase: string,
    token: string,
    fileId: string,
    totalSize: number,
    stopAfter?: number,
): Promise<ChildResult> {
    return new Promise((resolve, reject) => {
        const args = [join(__dirname, 'multipart-child.js'), fileId, String(totalSize)];
        if (stopAfter !== undefined) {
            args.push(String(stopAfter));
        }

        const child = spawn(process.execPath, args, {
            env: keylessEnv({ API_BASE: apiBase, API_ACCESS_TOKEN: token }),
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
        });
        child.once('error', reject);
        child.once('close', (code) => resolve({ code, stdout, stderr }));
    });
}

export function uploadedCountOf(result: ChildResult): number | null {
    const match = result.stdout.match(/\{"uploaded":(\d+)\}/);
    return match ? Number(match[1]) : null;
}
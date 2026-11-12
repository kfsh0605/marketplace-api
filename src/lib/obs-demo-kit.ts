import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { join } from 'node:path';
import { sleep } from './sleep';

export interface ObsServer {
    port: number;
    lines: string[];
    stderr: string[];
    stop(): Promise<void>;
}

export interface HttpResult {
    status: number;
    body: string;
}

export type LogRow = Record<string, any>;

export const newTraceId = (): string => randomBytes(16).toString('hex');

export const makeTraceparent = (traceId: string): string => `00-${traceId}-${randomBytes(8).toString('hex')}-01`;

export const traceIdOf = (traceparent: string): string => traceparent.split('-')[1];

function collectLines(stream: NodeJS.ReadableStream, target: string[]): void {
    let tail = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
        const parts = (tail + chunk).split('\n');
        tail = parts.pop() ?? '';
        for (const part of parts) {
            const line = part.replace(/\r$/, '');
            if (line.length > 0) {
                target.push(line);
            }
        }
    });
}

export function request(
    port: number,
    method: string,
    path: string,
    headers: Record<string, string> = {},
    body?: unknown,
): Promise<HttpResult> {
    return new Promise((resolve, reject) => {
        const payload = body === undefined ? undefined : JSON.stringify(body);
        const extra = payload
            ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) }
            : {};
        const req = http.request({ host: '127.0.0.1', port, method, path, agent: false, headers: { ...headers, ...extra } }, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
        });
        req.on('error', reject);
        req.end(payload);
    });
}

export async function settle(lines: string[], quietMs = 250, maxMs = 8000): Promise<void> {
    const started = Date.now();
    let last = lines.length;
    let changedAt = Date.now();
    while (Date.now() - started < maxMs) {
        await sleep(25);
        if (lines.length !== last) {
            last = lines.length;
            changedAt = Date.now();
        } else if (Date.now() - changedAt >= quietMs) {
            return;
        }
    }
}

export function parseLogLines(lines: string[]): { rows: LogRow[]; nonJson: number } {
    const rows: LogRow[] = [];
    let nonJson = 0;
    for (const line of lines) {
        try {
            const parsed = JSON.parse(line);
            if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                rows.push(parsed);
            } else {
                nonJson += 1;
            }
        } catch {
            nonJson += 1;
        }
    }
    return { rows, nonJson };
}

export async function startObsServer(extraEnv: Record<string, string> = {}): Promise<ObsServer> {
    const port = Number(process.env.OBS_DEMO_PORT ?? 22911);
    const entry = join(__dirname, '..', 'obs-app', 'server.js');
    const child = spawn(process.execPath, [entry], {
        env: {
            ...process.env,
            OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://127.0.0.1:22918',
            ...extraEnv,
            OTEL_SERVICE_NAME: 'marketplace-api',
            OBS_APP_PORT: String(port),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const lines: string[] = [];
    const stderr: string[] = [];
    collectLines(child.stdout, lines);
    collectLines(child.stderr, stderr);

    let exited = false;
    child.on('exit', () => {
        exited = true;
    });

    const deadline = Date.now() + 20000;
    for (;;) {
        if (exited) {
            throw new Error(`сервер завершився на старті (порт ${port} зайнятий?): ${stderr.slice(-3).join(' | ')}`);
        }
        try {
            const probe = await request(port, 'GET', '/metrics');
            if (probe.status === 200) {
                break;
            }
        } catch {
            // сервер ще не слухає
        }
        if (Date.now() > deadline) {
            child.kill();
            throw new Error(`сервер не відповів за 20 с на порту ${port}`);
        }
        await sleep(100);
    }

    return {
        port,
        lines,
        stderr,
        async stop() {
            if (exited) {
                return;
            }
            child.kill();
            const until = Date.now() + 5000;
            while (!exited && Date.now() < until) {
                await sleep(50);
            }
            if (!exited) {
                child.kill('SIGKILL');
            }
        },
    };
}

export interface Sample {
    name: string;
    labels: Record<string, string>;
    value: number;
}

const SAMPLE_LINE = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})?\s+(\S+)/;
const LABEL_PAIR = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g;

export function parseMetrics(text: string): Sample[] {
    const samples: Sample[] = [];
    for (const line of text.split('\n')) {
        if (line.length === 0 || line[0] === '#') {
            continue;
        }
        const match = SAMPLE_LINE.exec(line);
        if (!match) {
            continue;
        }
        const labels: Record<string, string> = {};
        for (const pair of (match[2] ?? '').matchAll(LABEL_PAIR)) {
            labels[pair[1]] = pair[2];
        }
        samples.push({ name: match[1], labels, value: Number(match[3]) });
    }
    return samples;
}

export async function scrape(port: number): Promise<Sample[]> {
    const result = await request(port, 'GET', '/metrics');
    return parseMetrics(result.body);
}

export function sumOf(
    samples: Sample[],
    name: string,
    match: (labels: Record<string, string>) => boolean = () => true,
): number {
    return samples.filter((sample) => sample.name === name && match(sample.labels)).reduce((sum, sample) => sum + sample.value, 0);
}
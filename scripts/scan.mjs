import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { collectFindings, evaluateGate, parseMax, parseSeverities } = require('./lib/scan-gate.cjs');

const IMAGE = process.env.SCAN_IMAGE ?? 'marketplace-api:hw28';
const SCANNER = process.env.SCAN_TRIVY_IMAGE ?? 'aquasec/trivy:0.76.1@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c';
const CACHE_VOLUME = 'hw28-trivy-cache';
const DEFAULT_MAX = 13;

function run(command, args, options = {}) {
    const result = spawnSync(command, args, { stdio: ['ignore', 'ignore', 'inherit'], ...options });
    if (result.error || result.status !== 0) {
        throw new Error(`${command} ${args.slice(0, 2).join(' ')} -> ${result.error ? result.error.message : `код ${result.status}`}`);
    }
}

function runScanner() {
    const dir = mkdtempSync(join(tmpdir(), 'hw28-scan-'));
    try {
        run('docker', ['save', '-o', 'image.tar', IMAGE], { cwd: dir });
        run('docker', [
            'run', '--rm',
            '-v', `${CACHE_VOLUME}:/root/.cache/trivy`,
            '-v', `${dir}:/work`,
            SCANNER,
            'image',
            '--input', '/work/image.tar',
            '--scanners', 'vuln',
            '--format', 'json',
            '--output', '/work/report.json',
            '--quiet',
        ]);
        return JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

function main() {
    const severities = parseSeverities(process.env.SCAN_SEVERITY ?? 'CRITICAL,HIGH');
    const ignoreUnfixed = (process.env.SCAN_IGNORE_UNFIXED ?? '1') !== '0';
    const max = parseMax(process.env.SCAN_MAX ?? String(DEFAULT_MAX));

    const report = process.env.SCAN_REPORT
        ? JSON.parse(readFileSync(process.env.SCAN_REPORT, 'utf8'))
        : runScanner();

    const findings = collectFindings(report, { severities, ignoreUnfixed });
    const verdict = evaluateGate(findings, max);

    console.log(`image=${IMAGE}`);
    console.log(`scanner=${process.env.SCAN_REPORT ? 'report' : SCANNER}`);
    console.log(`severity=${severities.join(',')}`);
    console.log(`ignore-unfixed=${ignoreUnfixed ? 1 : 0}`);
    for (const severity of severities) {
        console.log(`found-${severity.toLowerCase()}=${findings.filter((item) => item.severity === severity).length}`);
    }
    console.log(`found=${verdict.found}`);
    console.log(`max-allowed=${verdict.max}`);
    console.log(`gate=${verdict.pass ? 'pass' : 'fail'}`);

    for (const item of findings.slice(0, 15)) {
        console.error(`  ${item.severity} ${item.id} ${item.pkg} ${item.installed} -> ${item.fixed || 'без виправлення'}`);
    }
    if (findings.length > 15) {
        console.error(`  ... і ще ${findings.length - 15}`);
    }

    process.exit(verdict.pass ? 0 : 1);
}

try {
    main();
} catch (error) {
    console.log('gate=error');
    console.error(`scan: ${error.message}`);
    process.exit(2);
}
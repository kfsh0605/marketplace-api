'use strict';

const SEVERITIES = ['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

function parseSeverities(raw) {
    const list = String(raw)
        .split(',')
        .map((item) => item.trim().toUpperCase())
        .filter((item) => item !== '');

    if (list.length === 0) {
        throw new Error('SCAN_SEVERITY порожній: вкажіть, наприклад, CRITICAL,HIGH');
    }

    const unknown = list.filter((item) => !SEVERITIES.includes(item));
    if (unknown.length > 0) {
        throw new Error(`SCAN_SEVERITY містить невідомі рівні: ${unknown.join(', ')}`);
    }

    return list;
}

function parseMax(raw) {
    const text = String(raw).trim();
    if (!/^-?\d+$/.test(text)) {
        throw new Error(`SCAN_MAX має бути цілим числом, отримано "${raw}"`);
    }
    return Number(text);
}

function collectFindings(report, options) {
    const severities = new Set(options.severities);
    const findings = [];

    for (const result of report.Results ?? []) {
        for (const vulnerability of result.Vulnerabilities ?? []) {
            if (!severities.has(vulnerability.Severity)) {
                continue;
            }
            if (options.ignoreUnfixed && !vulnerability.FixedVersion) {
                continue;
            }
            findings.push({
                target: result.Target,
                id: vulnerability.VulnerabilityID,
                pkg: vulnerability.PkgName,
                installed: vulnerability.InstalledVersion,
                fixed: vulnerability.FixedVersion ?? '',
                severity: vulnerability.Severity,
            });
        }
    }

    return findings;
}

function evaluateGate(findings, max) {
    return { found: findings.length, max, pass: findings.length <= max };
}

module.exports = { SEVERITIES, parseSeverities, parseMax, collectFindings, evaluateGate };
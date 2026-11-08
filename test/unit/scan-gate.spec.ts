export {};

const { collectFindings, evaluateGate, parseMax, parseSeverities } = require('../../scripts/lib/scan-gate.cjs');

const report = {
    Results: [
        {
            Target: 'debian 12',
            Vulnerabilities: [
                { VulnerabilityID: 'CVE-1', PkgName: 'libc6', InstalledVersion: '1', FixedVersion: '2', Severity: 'CRITICAL' },
                { VulnerabilityID: 'CVE-2', PkgName: 'libssl3', InstalledVersion: '1', Severity: 'HIGH' },
                { VulnerabilityID: 'CVE-3', PkgName: 'zlib1g', InstalledVersion: '1', FixedVersion: '2', Severity: 'MEDIUM' },
                { VulnerabilityID: 'CVE-4', PkgName: 'tar', InstalledVersion: '1', FixedVersion: '3', Severity: 'HIGH' },
            ],
        },
        { Target: 'node-pkg' },
        { Target: 'empty', Vulnerabilities: null },
    ],
};

describe('scan: вердикт рахується зі звіту', () => {
    it('враховує лише потрібні рівні серйозності', () => {
        const findings = collectFindings(report, { severities: ['CRITICAL', 'HIGH'], ignoreUnfixed: false });
        expect(findings.map((item: { id: string }) => item.id)).toEqual(['CVE-1', 'CVE-2', 'CVE-4']);
    });

    it('--ignore-unfixed відкидає знахідки без виправлення', () => {
        const findings = collectFindings(report, { severities: ['CRITICAL', 'HIGH'], ignoreUnfixed: true });
        expect(findings.map((item: { id: string }) => item.id)).toEqual(['CVE-1', 'CVE-4']);
    });

    it('звіт без знахідок і без Results не ламає підрахунок', () => {
        expect(collectFindings({}, { severities: ['HIGH'], ignoreUnfixed: true })).toEqual([]);
    });

    it('поріг -1 ламається навіть на чистому образі, 99999 проходить на будь-якому', () => {
        expect(evaluateGate([], -1).pass).toBe(false);
        const many = collectFindings(report, { severities: ['CRITICAL', 'HIGH', 'MEDIUM'], ignoreUnfixed: false });
        expect(evaluateGate(many, 99999).pass).toBe(true);
    });

    it('рівність порога проходить, перевищення ні', () => {
        const findings = collectFindings(report, { severities: ['CRITICAL', 'HIGH'], ignoreUnfixed: true });
        expect(evaluateGate(findings, 2).pass).toBe(true);
        expect(evaluateGate(findings, 1).pass).toBe(false);
    });

    it('parseMax приймає цілі, у тому числі від’ємні, і відкидає решту', () => {
        expect(parseMax('-1')).toBe(-1);
        expect(parseMax('99999')).toBe(99999);
        expect(() => parseMax('abc')).toThrow(/SCAN_MAX/);
        expect(() => parseMax('1.5')).toThrow(/SCAN_MAX/);
        expect(() => parseMax('')).toThrow(/SCAN_MAX/);
    });

    it('parseSeverities нормалізує регістр і відкидає невідомі рівні', () => {
        expect(parseSeverities('critical, High')).toEqual(['CRITICAL', 'HIGH']);
        expect(() => parseSeverities('SEVERE')).toThrow(/SEVERE/);
        expect(() => parseSeverities(' , ')).toThrow(/SCAN_SEVERITY/);
    });
});
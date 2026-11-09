'use strict';

function summarizeCodes(text) {
    const codes = String(text)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== '');

    const byCode = {};
    for (const code of codes) {
        byCode[code] = (byCode[code] ?? 0) + 1;
    }

    const requests = codes.length;
    const ok = byCode['200'] ?? 0;

    return { requests, ok, failed: requests - ok, byCode };
}

function formatCodes(byCode) {
    return Object.keys(byCode)
        .sort()
        .map((code) => `${code}:${byCode[code]}`)
        .join(',');
}

function judge({ profile, requests, failed, oldRev, newRev, minRequests }) {
    const problems = [];

    if (requests < minRequests) {
        problems.push(`requests=${requests} менше за ${minRequests}`);
    }
    if (oldRev === 0 || newRev === 0) {
        problems.push(`оновлення не відбулося під навантаженням: old-rev-responses=${oldRev}, new-rev-responses=${newRev}`);
    }
    if (profile === 'zero' && failed > 0) {
        problems.push(`failed=${failed}, а має бути 0`);
    }

    return problems;
}

module.exports = { summarizeCodes, formatCodes, judge };

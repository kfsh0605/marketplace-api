export {};

const { readyPodNames, pdbSnapshot, judgeEvictions } = require('../../demo/lib/pdb-logic.cjs');

function pod(name: string, options: { phase?: string; ready?: boolean; deleting?: boolean } = {}) {
    const { phase = 'Running', ready = true, deleting = false } = options;
    return {
        metadata: { name, ...(deleting ? { deletionTimestamp: '2026-11-09T10:00:00Z' } : {}) },
        status: { phase, conditions: [{ type: 'Ready', status: ready ? 'True' : 'False' }] },
    };
}

describe('pdb: вибір подів для виселення', () => {
    it('бере лише Running і Ready поди та сортує їх', () => {
        const list = { items: [pod('b'), pod('a'), pod('c', { ready: false }), pod('d', { phase: 'Pending' })] };
        expect(readyPodNames(list)).toEqual(['a', 'b']);
    });

    it('пропускає под, який уже завершується', () => {
        const list = { items: [pod('a'), pod('b', { deleting: true })] };
        expect(readyPodNames(list)).toEqual(['a']);
    });

    it('порожній список не ламає функцію', () => {
        expect(readyPodNames({})).toEqual([]);
    });
});

describe('pdb: знімок бюджету', () => {
    it('читає здорові поди, minAvailable та дозволені перерви', () => {
        const snapshot = pdbSnapshot({ spec: { minAvailable: 2 }, status: { currentHealthy: 3, disruptionsAllowed: 1 } });
        expect(snapshot).toEqual({ healthy: 3, minAvailable: 2, disruptionsAllowed: 1 });
    });

    it('при maxUnavailable бере мінімум зі status.desiredHealthy', () => {
        const snapshot = pdbSnapshot({
            spec: { maxUnavailable: 1 },
            status: { currentHealthy: 3, desiredHealthy: 2, disruptionsAllowed: 1 },
        });
        expect(snapshot).toEqual({ healthy: 3, minAvailable: 2, disruptionsAllowed: 1 });
    });

    it('без статусу дає нулі, а не undefined', () => {
        expect(pdbSnapshot({ spec: { minAvailable: 2 } })).toEqual({ healthy: 0, minAvailable: 2, disruptionsAllowed: 0 });
    });
});

describe('pdb: вердикт виселень', () => {
    it('201 потім 429 це успіх', () => {
        expect(judgeEvictions(201, 429)).toEqual([]);
    });

    it('кожне відхилення дає окрему проблему', () => {
        expect(judgeEvictions(429, 429)).toHaveLength(1);
        expect(judgeEvictions(201, 201)).toHaveLength(1);
        expect(judgeEvictions(500, 500)).toHaveLength(2);
    });
});
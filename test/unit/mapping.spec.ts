import { PlanError, RATES, decide, estimatePlan, monthlyUsdPerPod, parseCpu, parseMemoryGiB, toCents } from '../../src/mapping';

const deployment = (spec: unknown, op = 'create', urn = 'urn:x::kubernetes:apps/v1:Deployment::d') => ({
    op,
    urn,
    newState: { type: 'kubernetes:apps/v1:Deployment', inputs: { spec } },
});
const podSpec = (requests: Record<string, string>, limits?: Record<string, string>) => ({
    template: { spec: { containers: [{ name: 'api', resources: { requests, limits } }] } },
});

describe('mapping: quantities', () => {
    it('parses cpu', () => {
        expect(parseCpu('50m')).toBeCloseTo(0.05);
        expect(parseCpu('2')).toBe(2);
        expect(parseCpu('0.5')).toBe(0.5);
        expect(() => parseCpu('lots')).toThrow(PlanError);
    });

    it('parses memory to GiB', () => {
        expect(parseMemoryGiB('1Gi')).toBe(1);
        expect(parseMemoryGiB('64Mi')).toBe(0.0625);
        expect(parseMemoryGiB('1G')).toBeCloseTo(0.9313, 3);
        expect(parseMemoryGiB(2 ** 30)).toBe(1);
        expect(() => parseMemoryGiB('1 gig')).toThrow(PlanError);
    });
});

describe('mapping: estimatePlan', () => {
    it('prices replicas x (cpu*rate + mem*rate) x 730h', () => {
        const plan = { steps: [deployment({ replicas: 2, ...podSpec({ cpu: '50m', memory: '64Mi' }) })] };
        const expected = 2 * monthlyUsdPerPod(0.05, 0.0625);
        expect(estimatePlan(plan).totalUsd).toBeCloseTo(expected, 6);
        expect(toCents(expected)).toBe(3.36);
        expect(RATES.hoursPerMonth).toBe(730);
    });

    it('falls back to limits when requests are absent', () => {
        const plan = { steps: [deployment({ replicas: 1, ...podSpec({}, { cpu: '1', memory: '1Gi' }) })] };
        expect(estimatePlan(plan).items[0]).toMatchObject({ cpuCores: 1, memoryGiB: 1 });
    });

    it('ignores deleted resources and keeps the replacement once', () => {
        const spec = { replicas: 1, ...podSpec({ cpu: '1', memory: '1Gi' }) };
        const plan = {
            steps: [
                deployment(spec, 'create-replacement'),
                deployment(spec, 'delete-replaced'),
                deployment(spec, 'delete', 'urn:x::kubernetes:apps/v1:Deployment::gone'),
            ],
        };
        expect(estimatePlan(plan).items).toHaveLength(1);
    });

    it('refuses a plan without steps and unknown values', () => {
        expect(() => estimatePlan({})).toThrow(PlanError);
        const unknown = { steps: [deployment({ replicas: '04da6b54-80e4-46f7-96ec-b56ff0331ba9', ...podSpec({ cpu: '1' }) })] };
        expect(() => estimatePlan(unknown)).toThrow(PlanError);
    });
});

describe('mapping: decide (гейт міряє зміну, а не суму)', () => {
    const base = { workloads: 1, budgetUsd: 10 };

    it('passes a small change on top of a big baseline although the sum is far above the budget', () => {
        const decision = decide({ ...base, planUsd: 1083.0, baselineUsd: 1081.2 });
        expect(decision.deltaUsd).toBe(1.8);
        expect(decision.pass).toBe(true);
    });

    it('fails a big jump on top of a small baseline', () => {
        const decision = decide({ ...base, planUsd: 18.95, baselineUsd: 5.04 });
        expect(decision.deltaUsd).toBe(13.91);
        expect(decision.pass).toBe(false);
        expect(decision.reason).toContain('+13.91');
    });

    it('passes exactly at the allowed increase and fails one cent above', () => {
        expect(decide({ ...base, planUsd: 15, baselineUsd: 5 }).pass).toBe(true);
        expect(decide({ ...base, planUsd: 15.01, baselineUsd: 5 }).pass).toBe(false);
    });

    it('always passes a decrease, even with a zero budget', () => {
        const decision = decide({ ...base, budgetUsd: 0, planUsd: 3.36, baselineUsd: 1081.2 });
        expect(decision.deltaUsd).toBe(-1077.84);
        expect(decision.pass).toBe(true);
    });

    it('without a baseline the delta equals the whole plan', () => {
        expect(decide({ ...base, planUsd: 5.04, baselineUsd: 0 }).deltaUsd).toBe(5.04);
    });

    it('does not accept a plan without workloads', () => {
        const decision = decide({ ...base, workloads: 0, planUsd: 0, baselineUsd: 0 });
        expect(decision.pass).toBe(false);
        expect(decision.reason).toContain('немає жодного');
    });
});

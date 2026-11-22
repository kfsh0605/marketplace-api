import { PlanError, RATES, estimatePlan, monthlyUsdPerPod, parseCpu, parseMemoryGiB, toCents } from '../../src/mapping';

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

// Переклад плану інфраструктури (вивід `pulumi preview --json`) у гроші на місяць.
// Чиста функція без файлів і мережі: на вході JSON плану, на виході число доларів.
// Зараз ціниться те, що в нашій програмі infra/ справді коштує обчислювальних ресурсів:
// Deployment і StatefulSet = репліки × (requests.cpu × ставка vCPU + requests.memory × ставка GiB) × 730 год.
// Namespace, Secret, Service, PDB і HPA грошей не коштують (їх вартість у цій моделі дорівнює нулю).
// Ставки оголошені в README, розділ «## CI/CD»; зміна числа тут без зміни README є помилкою.

/** Ставки On-Demand для Linux/x86 у US East (N. Virginia), https://aws.amazon.com/fargate/pricing/ (на 22.11.2026). */
export const RATES = Object.freeze({
    vcpuHourUsd: 0.04048,
    gibHourUsd: 0.004445,
    hoursPerMonth: 730,
    source: 'https://aws.amazon.com/fargate/pricing/',
});

/** Pulumi підставляє це значення замість ще не відомих під час preview полів. */
const UNKNOWN_VALUE = '04da6b54-80e4-46f7-96ec-b56ff0331ba9';

/** Кроки, після яких ресурс уже не існує, у вартість не входять. */
const GONE_OPS = new Set(['delete', 'delete-replaced', 'discard', 'discard-replaced', 'remove-pending-replace']);

const WORKLOAD_KINDS = new Set(['Deployment', 'StatefulSet']);

export class PlanError extends Error {}

type Json = Record<string, unknown>;

export interface PricedResource {
    urn: string;
    kind: string;
    replicas: number;
    cpuCores: number;
    memoryGiB: number;
    monthlyUsd: number;
}

export interface Estimate {
    items: PricedResource[];
    totalUsd: number;
}

function asRecord(value: unknown): Json | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined;
}

function assertKnown(value: unknown, where: string): void {
    if (value === UNKNOWN_VALUE) {
        throw new PlanError(`${where}: значення ще невідоме на етапі preview, ціну порахувати неможливо`);
    }
}

/** Kubernetes-кількість CPU: "50m", "0.5", "2", 1 -> ядра. */
export function parseCpu(quantity: unknown, where = 'cpu'): number {
    assertKnown(quantity, where);
    if (typeof quantity === 'number' && Number.isFinite(quantity) && quantity >= 0) {
        return quantity;
    }
    const match = typeof quantity === 'string' ? /^(\d+(?:\.\d+)?)(n|u|m)?$/.exec(quantity.trim()) : null;
    if (!match) {
        throw new PlanError(`${where}: не розумію кількість CPU ${JSON.stringify(quantity)}`);
    }
    const scale: Record<string, number> = { n: 1e-9, u: 1e-6, m: 1e-3 };
    return Number(match[1]) * (match[2] ? scale[match[2]] : 1);
}

/** Kubernetes-кількість пам'яті: "64Mi", "1Gi", "128M", 134217728 -> ГіБ (GiB, 1024^3 байт). */
export function parseMemoryGiB(quantity: unknown, where = 'memory'): number {
    assertKnown(quantity, where);
    if (typeof quantity === 'number' && Number.isFinite(quantity) && quantity >= 0) {
        return quantity / 2 ** 30;
    }
    const match = typeof quantity === 'string' ? /^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti|Pi|Ei|k|M|G|T|P|E)?$/.exec(quantity.trim()) : null;
    if (!match) {
        throw new PlanError(`${where}: не розумію кількість пам'яті ${JSON.stringify(quantity)}`);
    }
    const bytes: Record<string, number> = {
        Ki: 2 ** 10, Mi: 2 ** 20, Gi: 2 ** 30, Ti: 2 ** 40, Pi: 2 ** 50, Ei: 2 ** 60,
        k: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18,
    };
    return (Number(match[1]) * (match[2] ? bytes[match[2]] : 1)) / 2 ** 30;
}

/** Запит ресурсів пода = сума requests по контейнерах; якщо requests немає, Kubernetes бере limits. */
function podResources(podSpec: Json | undefined, where: string): { cpuCores: number; memoryGiB: number } {
    const containers = Array.isArray(podSpec?.containers) ? (podSpec.containers as unknown[]) : [];
    let cpuCores = 0;
    let memoryGiB = 0;
    containers.forEach((entry, index) => {
        const resources = asRecord(asRecord(entry)?.resources);
        const requests = asRecord(resources?.requests);
        const limits = asRecord(resources?.limits);
        const label = `${where}.containers[${index}]`;
        const cpu = requests?.cpu ?? limits?.cpu;
        const memory = requests?.memory ?? limits?.memory;
        cpuCores += cpu === undefined ? 0 : parseCpu(cpu, `${label}.cpu`);
        memoryGiB += memory === undefined ? 0 : parseMemoryGiB(memory, `${label}.memory`);
    });
    return { cpuCores, memoryGiB };
}

export function monthlyUsdPerPod(cpuCores: number, memoryGiB: number): number {
    const hourly = cpuCores * RATES.vcpuHourUsd + memoryGiB * RATES.gibHourUsd;
    return hourly * RATES.hoursPerMonth;
}

function workloadKind(step: Json, state: Json, fields: Json): string | undefined {
    const type = String(state.type ?? step.type ?? '');
    const fromType = /:(Deployment|StatefulSet)$/.exec(type)?.[1];
    const fromKind = typeof fields.kind === 'string' ? fields.kind : undefined;
    const kind = fromType ?? fromKind;
    return kind && WORKLOAD_KINDS.has(kind) ? kind : undefined;
}

/** Рахує місячну вартість запланованого стану: що існуватиме після застосування плану. */
export function estimatePlan(plan: unknown): Estimate {
    const steps = asRecord(plan)?.steps;
    if (!Array.isArray(steps)) {
        throw new PlanError('у плані немає масиву steps: очікується вивід `pulumi preview --json`');
    }

    // Один ресурс може мати кілька кроків (replace = create-replacement + delete-replaced): беремо стан, що лишається.
    const survivors = new Map<string, { step: Json; state: Json }>();
    steps.forEach((raw, index) => {
        const step = asRecord(raw);
        const state = asRecord(step?.newState);
        if (!step || !state || GONE_OPS.has(String(step.op))) {
            return;
        }
        survivors.set(String(step.urn ?? state.urn ?? `step-${index}`), { step, state });
    });

    const items: PricedResource[] = [];
    for (const [urn, { step, state }] of survivors) {
        const fields = asRecord(state.inputs) ?? asRecord(state.outputs);
        const kind = fields ? workloadKind(step, state, fields) : undefined;
        if (!fields || !kind) {
            continue;
        }
        const spec = asRecord(fields.spec);
        const replicasRaw = spec?.replicas ?? 1;
        assertKnown(replicasRaw, `${urn}: spec.replicas`);
        const replicas = Number(replicasRaw);
        if (!Number.isInteger(replicas) || replicas < 0) {
            throw new PlanError(`${urn}: spec.replicas=${JSON.stringify(replicasRaw)} не є цілим невід'ємним числом`);
        }
        const podSpec = asRecord(asRecord(spec?.template)?.spec);
        const { cpuCores, memoryGiB } = podResources(podSpec, `${urn}: spec.template.spec`);
        items.push({
            urn,
            kind,
            replicas,
            cpuCores,
            memoryGiB,
            monthlyUsd: replicas * monthlyUsdPerPod(cpuCores, memoryGiB),
        });
    }

    return { items, totalUsd: items.reduce((sum, item) => sum + item.monthlyUsd, 0) };
}

export const toCents = (usd: number): number => Math.round(usd * 100) / 100;

export interface CostDecisionInput {
    /** Вартість плану цієї гілки (PR), $/міс. */
    planUsd: number;
    /** Вартість плану базової гілки, $/міс. Якщо бази немає, 0: тоді зміна дорівнює всій вартості. */
    baselineUsd: number;
    /** Дозволене ЗБІЛЬШЕННЯ місячної вартості, $/міс. */
    budgetUsd: number;
    /** Скільки Deployment/StatefulSet знайдено в плані цієї гілки. */
    workloads: number;
}

export interface CostDecision {
    planUsd: number;
    baselineUsd: number;
    deltaUsd: number;
    budgetUsd: number;
    pass: boolean;
    /** Чому fail (порожньо, коли pass). */
    reason: string;
}

/**
 * Рішення гейта: міряємо ЗМІНУ (план мінус база), а не абсолютну суму.
 * Усе рахується в центах, щоб 0.1 + 0.2 не давало сюрпризів на межі бюджету.
 * Зменшення вартості (delta < 0) завжди проходить. План без жодного навантаження не вважається результатом.
 */
export function decide(input: CostDecisionInput): CostDecision {
    const cents = (usd: number): number => Math.round(usd * 100);
    const planCents = cents(input.planUsd);
    const baselineCents = cents(input.baselineUsd);
    const budgetCents = cents(input.budgetUsd);
    const deltaCents = planCents - baselineCents;

    let reason = '';
    if (input.workloads === 0) {
        reason = 'у плані немає жодного Deployment/StatefulSet, вартість 0 не є результатом';
    } else if (deltaCents > budgetCents) {
        reason = `зміна вартості +${(deltaCents / 100).toFixed(2)} $/міс перевищує дозволене збільшення ${(budgetCents / 100).toFixed(2)}`;
    }
    return {
        planUsd: planCents / 100,
        baselineUsd: baselineCents / 100,
        deltaUsd: deltaCents / 100,
        budgetUsd: budgetCents / 100,
        pass: reason === '',
        reason,
    };
}

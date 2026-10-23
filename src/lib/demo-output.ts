import { sleep } from './sleep';

export function printLines(pairs: Record<string, string | number>): void {
    for (const [key, value] of Object.entries(pairs)) {
        console.log(`${key}=${value}`);
    }
}

export function expectEq(failures: string[], name: string, actual: unknown, expected: unknown): void {
    if (actual !== expected) {
        failures.push(`${name}: очікували ${expected}, отримали ${actual}`);
    }
}

export function expectAtLeast(failures: string[], name: string, actual: number, min: number): void {
    if (!(actual >= min)) {
        failures.push(`${name}: очікували >= ${min}, отримали ${actual}`);
    }
}

export async function runStandalone(body: (failures: string[]) => Promise<void>): Promise<never> {
    const failures: string[] = [];
    try {
        await body(failures);
    } catch (err) {
        failures.push(`виняток: ${(err as Error).message}`);
    }

    if (failures.length > 0) {
        for (const failure of failures) {
            console.error(`FAIL ${failure}`);
        }
        process.exit(1);
    }
    console.log('OK: усі інваріанти виконано');
    process.exit(0);
}

export async function waitUntil(
    condition: () => boolean | Promise<boolean>,
    timeoutMs: number,
    stepMs = 50,
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await condition()) {
            return true;
        }
        await sleep(stepMs);
    }
    return condition();
}
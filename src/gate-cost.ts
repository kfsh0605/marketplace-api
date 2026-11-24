// Гейт вартості: `npm run gate:cost`. Міряє ЗМІНУ місячної вартості, а не суму: план цієї гілки мінус план базової.
//   PLAN_JSON           шлях до plan.json цієї гілки (вивід `pulumi preview --json`), типово plan.json
//   BASELINE_PLAN_JSON  шлях до плану БАЗОВОЇ гілки (той самий preview, але з коду main); не задано = бази немає,
//                       тоді baseline-usd=0 і зміна дорівнює всій вартості плану
//   COST_BUDGET_USD     дозволене ЗБІЛЬШЕННЯ вартості, $/міс, обов'язково (зменшення проходить завжди)
// Код виходу: 0 - gate=pass, 1 - gate=fail (зміна більша за дозволену), 2 - гейт не зміг порахувати
// (у тому числі коли BASELINE_PLAN_JSON задано, а файл зіпсований: мовчки рахувати від нуля не можна).
import { readFileSync } from 'node:fs';
import { RATES, decide, estimatePlan, toCents } from './mapping';

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function main(): number {
    const planPath = process.env.PLAN_JSON ?? 'plan.json';
    const baselinePath = process.env.BASELINE_PLAN_JSON?.trim() || undefined;
    const budgetRaw = process.env.COST_BUDGET_USD;
    const budget = Number(budgetRaw);
    if (budgetRaw === undefined || budgetRaw.trim() === '' || !Number.isFinite(budget) || budget < 0) {
        console.error('gate:cost: задайте COST_BUDGET_USD як невід\'ємне число доларів на місяць (дозволене збільшення)');
        return 2;
    }

    let estimate;
    try {
        estimate = estimatePlan(JSON.parse(readFileSync(planPath, 'utf8')));
    } catch (error) {
        console.error(`gate:cost: ${describe(error)} (PLAN_JSON=${planPath})`);
        return 2;
    }

    // База може не мати жодного навантаження (інфраструктури ще не було): це 0 $, а не помилка.
    let baselineUsd = 0;
    if (baselinePath) {
        try {
            baselineUsd = estimatePlan(JSON.parse(readFileSync(baselinePath, 'utf8'))).totalUsd;
        } catch (error) {
            console.error(`gate:cost: не вдалося порахувати базу: ${describe(error)} (BASELINE_PLAN_JSON=${baselinePath})`);
            return 2;
        }
    }

    console.log(`rate-vcpu-hour-usd=${RATES.vcpuHourUsd}`);
    console.log(`rate-gib-hour-usd=${RATES.gibHourUsd}`);
    console.log(`rate-hours-per-month=${RATES.hoursPerMonth}`);
    console.log(`rate-source=${RATES.source}`);
    for (const item of estimate.items) {
        const name = item.urn.split('::').slice(-1)[0];
        console.log(
            `cost-item=${item.kind}/${name} replicas=${item.replicas} cpu=${item.cpuCores} memory-gib=${item.memoryGiB} usd-month=${toCents(item.monthlyUsd).toFixed(2)}`,
        );
    }

    const decision = decide({
        planUsd: estimate.totalUsd,
        baselineUsd,
        budgetUsd: budget,
        workloads: estimate.items.length,
    });
    console.log(`baseline=${baselinePath ? 'plan' : 'none'}`);
    console.log(`baseline-usd=${decision.baselineUsd.toFixed(2)}`);
    console.log(`plan-usd=${decision.planUsd.toFixed(2)}`);
    console.log(`delta-usd=${decision.deltaUsd.toFixed(2)}`);
    console.log(`budget-usd=${decision.budgetUsd.toFixed(2)}`);
    if (!decision.pass) {
        console.error(`gate:cost: ${decision.reason}`);
    }
    console.log(`gate=${decision.pass ? 'pass' : 'fail'}`);
    return decision.pass ? 0 : 1;
}

process.exitCode = main();

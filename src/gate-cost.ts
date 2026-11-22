// Гейт вартості: `npm run gate:cost`. Порівнює числа (а не файли планів): вартість плану з бюджетом.
//   PLAN_JSON         шлях до plan.json (вивід `pulumi preview --json`), типово plan.json
//   COST_BUDGET_USD   місячний бюджет у доларах, обов'язково
// Код виходу: 0 - gate=pass, 1 - gate=fail (план дорожчий за бюджет), 2 - гейт не зміг порахувати.
import { readFileSync } from 'node:fs';
import { RATES, PlanError, estimatePlan, toCents } from './mapping';

function main(): number {
    const planPath = process.env.PLAN_JSON ?? 'plan.json';
    const budgetRaw = process.env.COST_BUDGET_USD;
    const budget = Number(budgetRaw);
    if (budgetRaw === undefined || budgetRaw.trim() === '' || !Number.isFinite(budget) || budget < 0) {
        console.error('gate:cost: задайте COST_BUDGET_USD як невід\'ємне число доларів на місяць');
        return 2;
    }

    let estimate;
    try {
        estimate = estimatePlan(JSON.parse(readFileSync(planPath, 'utf8')));
    } catch (error) {
        console.error(`gate:cost: ${error instanceof PlanError || error instanceof Error ? error.message : String(error)} (PLAN_JSON=${planPath})`);
        return 2;
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

    const planUsd = toCents(estimate.totalUsd);
    const budgetUsd = toCents(budget);
    console.log(`budget-usd=${budgetUsd.toFixed(2)}`);
    console.log(`plan-usd=${planUsd.toFixed(2)}`);

    const pass = estimate.items.length > 0 && planUsd <= budgetUsd;
    if (estimate.items.length === 0) {
        console.error('gate:cost: у плані немає жодного Deployment/StatefulSet, вартість 0 не є результатом: перевірте plan.json');
    }
    console.log(`gate=${pass ? 'pass' : 'fail'}`);
    return pass ? 0 : 1;
}

process.exitCode = main();

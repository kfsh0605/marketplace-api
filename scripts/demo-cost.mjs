// npm run demo:cost - гейт вартості в обидва боки на готових планах.
//   plan-ok.json     2 репліки по 50m CPU / 64Mi  -> вкладається в бюджет  -> gate=pass, код 0
//   plan-heavy.json  30 реплік по 1 CPU / 2Gi     -> перевищує бюджет       -> gate=fail, код 1
import { spawnSync } from 'node:child_process';

const BUDGET = process.env.COST_BUDGET_USD ?? '10';
const run = (plan) => {
    const result = spawnSync('npm', ['run', '--silent', 'gate:cost'], {
        env: { ...process.env, PLAN_JSON: plan, COST_BUDGET_USD: BUDGET },
        encoding: 'utf8',
        shell: process.platform === 'win32',
    });
    const out = `${result.stdout}${result.stderr}`;
    const value = (key) => out.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1] ?? '';
    return { plan, budget: value('budget-usd'), usd: value('plan-usd'), gate: value('gate'), code: result.status };
};

const cases = [
    { ...run('fixtures/cost/plan-ok.json'), expect: ['pass', 0] },
    { ...run('fixtures/cost/plan-heavy.json'), expect: ['fail', 1] },
];
let unexpected = 0;
for (const item of cases) {
    console.log(`plan=${item.plan}`);
    console.log(`budget-usd=${item.budget}`);
    console.log(`plan-usd=${item.usd}`);
    console.log(`gate=${item.gate}`);
    console.log(`exit=${item.code}`);
    if (item.gate !== item.expect[0] || item.code !== item.expect[1]) {
        unexpected += 1;
    }
}
console.log(`unexpected=${unexpected}`);
process.exitCode = unexpected === 0 ? 0 : 1;

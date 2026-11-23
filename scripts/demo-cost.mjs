// npm run demo:cost - гейт вартості в обидва боки на готових планах. Міряється ЗМІНА (план мінус база), не сума.
//   COST_BUDGET_USD = дозволене збільшення, $/міс (типово 10)
//   випадок                              база          план            зміна      очікується
//   без бази, невелика інфраструктура    -             plan-ok         +3.36      pass 0
//   без бази, важка інфраструктура       -             plan-heavy      +1081.20   fail 1
//   дрібна зміна на великій базі         plan-heavy    plan-heavy      0.00       pass 0  (сума 1081.20 була б fail)
//   +1 репліка до малої бази             plan-ok       plan-plus-one   +1.68      pass 0
//   стрибок із малої бази у важку        plan-ok       plan-heavy      +1077.84   fail 1
//   зменшення вартості                   plan-heavy    plan-ok         -1077.84   pass 0
//   база без навантажень (перший деплой) plan-empty    plan-ok         +3.36      pass 0
import { spawnSync } from 'node:child_process';

const BUDGET = process.env.COST_BUDGET_USD ?? '10';
const run = (plan, baseline) => {
    const env = { ...process.env, PLAN_JSON: plan, COST_BUDGET_USD: BUDGET };
    delete env.BASELINE_PLAN_JSON;
    if (baseline) {
        env.BASELINE_PLAN_JSON = baseline;
    }
    const result = spawnSync('npm', ['run', '--silent', 'gate:cost'], {
        env,
        encoding: 'utf8',
        shell: process.platform === 'win32',
    });
    const out = `${result.stdout}${result.stderr}`;
    const value = (key) => out.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1] ?? '';
    return {
        plan,
        baseline: baseline ?? '-',
        baselineUsd: value('baseline-usd'),
        usd: value('plan-usd'),
        delta: value('delta-usd'),
        budget: value('budget-usd'),
        gate: value('gate'),
        code: result.status,
    };
};

const dir = 'fixtures/cost';
const cases = [
    { ...run(`${dir}/plan-ok.json`), expect: ['pass', 0] },
    { ...run(`${dir}/plan-heavy.json`), expect: ['fail', 1] },
    { ...run(`${dir}/plan-heavy.json`, `${dir}/plan-heavy.json`), expect: ['pass', 0] },
    { ...run(`${dir}/plan-plus-one.json`, `${dir}/plan-ok.json`), expect: ['pass', 0] },
    { ...run(`${dir}/plan-heavy.json`, `${dir}/plan-ok.json`), expect: ['fail', 1] },
    { ...run(`${dir}/plan-ok.json`, `${dir}/plan-heavy.json`), expect: ['pass', 0] },
    { ...run(`${dir}/plan-ok.json`, `${dir}/plan-empty.json`), expect: ['pass', 0] },
];
let unexpected = 0;
for (const item of cases) {
    console.log(`plan=${item.plan}`);
    console.log(`baseline=${item.baseline}`);
    console.log(`baseline-usd=${item.baselineUsd}`);
    console.log(`plan-usd=${item.usd}`);
    console.log(`delta-usd=${item.delta}`);
    console.log(`budget-usd=${item.budget}`);
    console.log(`gate=${item.gate}`);
    console.log(`exit=${item.code}`);
    if (item.gate !== item.expect[0] || item.code !== item.expect[1]) {
        unexpected += 1;
    }
}
console.log(`cases=${cases.length}`);
console.log(`unexpected=${unexpected}`);
process.exitCode = unexpected === 0 ? 0 : 1;

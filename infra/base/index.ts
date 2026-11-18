import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

const cfg = new pulumi.Config("hw31");

// ---------------------------------------------------------------------------
// 1. БЮДЖЕТ - первый ресурс стека, раньше любой сети (ТЗ, критерий C1).
//
// Бюджет в AWS только ПРЕДУПРЕЖДАЕТ, он ничего не выключает, и цифры в нём
// отстают на 8-12 часов. Поэтому порог стоит низко: 20 % от $5 = $1.
//
// notificationType = ACTUAL (уже потрачено), а не FORECASTED (прогноз).
// Прогноз на новом аккаунте не работает: AWS нужно около 5 недель истории,
// и письмо не придёт, когда оно нужнее всего (ТЗ, критерий C2).
// ---------------------------------------------------------------------------
export const budget = new aws.budgets.Budget("monthly-cost", {
  name: "hw31-monthly-5usd",
  budgetType: "COST",
  limitAmount: "5",
  limitUnit: "USD",
  timeUnit: "MONTHLY",
  notifications: [
    {
      comparisonOperator: "GREATER_THAN",
      threshold: 20,
      thresholdType: "PERCENTAGE",
      notificationType: "ACTUAL",
      subscriberEmailAddresses: [cfg.require("budgetEmail")],
    },
  ],
});

// Справочные data source: ничего не создают, показывают, под кем и где работаем.
const identity = aws.getCallerIdentityOutput({});
const region = aws.getRegionOutput({});

export const accountId = identity.accountId;
export const regionName = region.name;
export const budgetName = budget.name;

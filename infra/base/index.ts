import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { createCiAccess } from "./src/ci-access";

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
const budget = new aws.budgets.Budget("monthly-cost", {
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

// ---------------------------------------------------------------------------
// 2. СЕТЬ. Ничего из того, что тарифицируется по часам: ни NAT, ни EIP, ни EC2.
//
// Схема: один VPC, в двух зонах доступности (AZ) по две подсети.
//   публичные  (маршрут 0.0.0.0/0 -> IGW)     сюда встанет балансировщик (ALB)
//   приватные  (маршрута в интернет НЕТ)      сюда встанет база (RDS)
// Две AZ нужны, потому что ALB и RDS Multi-AZ требуют минимум две зоны.
//
// dependsOn: [budget] делает бюджет первым и в самом состоянии Pulumi:
// всё остальное зависит от VPC, значит, строится после бюджета.
// ---------------------------------------------------------------------------
const vpc = new aws.ec2.Vpc(
  "main",
  {
    cidrBlock: "10.31.0.0/16",
    enableDnsSupport: true,
    enableDnsHostnames: true,
    tags: { Name: "hw31-vpc" },
  },
  { dependsOn: [budget] },
);

const azs = aws.getAvailabilityZonesOutput({
  state: "available",
  filters: [{ name: "opt-in-status", values: ["opt-in-not-required"] }],
});
const azNames = [azs.names.apply((n) => n[0]), azs.names.apply((n) => n[1])];

// mapPublicIpOnLaunch=false: случайно запущенная машина не получит платный публичный IPv4.
// Балансировщику это не мешает, у него свои адреса.
const publicSubnets = azNames.map(
  (az, i) =>
    new aws.ec2.Subnet(`public-${i + 1}`, {
      vpcId: vpc.id,
      cidrBlock: `10.31.${i}.0/24`,
      availabilityZone: az,
      mapPublicIpOnLaunch: false,
      tags: { Name: `hw31-public-${i + 1}`, Tier: "public" },
    }),
);

const privateSubnets = azNames.map(
  (az, i) =>
    new aws.ec2.Subnet(`private-${i + 1}`, {
      vpcId: vpc.id,
      cidrBlock: `10.31.${10 + i}.0/24`,
      availabilityZone: az,
      mapPublicIpOnLaunch: false,
      tags: { Name: `hw31-private-${i + 1}`, Tier: "private" },
    }),
);

const igw = new aws.ec2.InternetGateway("igw", {
  vpcId: vpc.id,
  tags: { Name: "hw31-igw" },
});

const publicRt = new aws.ec2.RouteTable("public", {
  vpcId: vpc.id,
  tags: { Name: "hw31-public-rt", Tier: "public" },
});
new aws.ec2.Route("public-default", {
  routeTableId: publicRt.id,
  destinationCidrBlock: "0.0.0.0/0",
  gatewayId: igw.id,
});
publicSubnets.forEach(
  (subnet, i) =>
    new aws.ec2.RouteTableAssociation(`public-${i + 1}`, {
      subnetId: subnet.id,
      routeTableId: publicRt.id,
    }),
);

// Приватная таблица маршрутов: только локальный маршрут VPC, 0.0.0.0/0 нет (критерий A2).
// Маршрут через NAT добавит стек demo при флаге hw31:withNat и уберёт при destroy.
const privateRt = new aws.ec2.RouteTable("private", {
  vpcId: vpc.id,
  tags: { Name: "hw31-private-rt", Tier: "private" },
});
privateSubnets.forEach(
  (subnet, i) =>
    new aws.ec2.RouteTableAssociation(`private-${i + 1}`, {
      subnetId: subnet.id,
      routeTableId: privateRt.id,
    }),
);

// ---------------------------------------------------------------------------
// 3. SECURITY GROUPS. Правила - отдельными ресурсами, чтобы группы могли
// ссылаться друг на друга без цикла. Описание (description) в AWS допускает
// только ASCII, поэтому оно английское, а пояснения - в комментариях.
// ---------------------------------------------------------------------------
const edgeSg = new aws.ec2.SecurityGroup("edge", {
  vpcId: vpc.id,
  description: "Public entrance: internet-facing load balancer",
  tags: { Name: "hw31-edge-sg" },
});
const appSg = new aws.ec2.SecurityGroup("app", {
  vpcId: vpc.id,
  description: "Database clients: whoever carries this group may reach the database",
  tags: { Name: "hw31-app-sg" },
});
const dbSg = new aws.ec2.SecurityGroup("db", {
  vpcId: vpc.id,
  description: "PostgreSQL: reachable only from the app group",
  tags: { Name: "hw31-db-sg" },
});

// Порт 80 открыт всему интернету: единственная открытая наружу дверь стека.
// Только HTTP, потому что у демо нет домена и сертификата; персональных данных нет.
new aws.vpc.SecurityGroupIngressRule("edge-http", {
  securityGroupId: edgeSg.id,
  ipProtocol: "tcp",
  fromPort: 80,
  toPort: 80,
  cidrIpv4: "0.0.0.0/0",
  description: "HTTP from the internet (demo ALB, no domain or certificate)",
});

// Порт 5432 открыт НЕ миру, а только группе app: пустить в базу можно лишь тех,
// кто носит эту группу. Из интернета до базы дороги нет.
new aws.vpc.SecurityGroupIngressRule("db-postgres-from-app", {
  securityGroupId: dbSg.id,
  ipProtocol: "tcp",
  fromPort: 5432,
  toPort: 5432,
  referencedSecurityGroupId: appSg.id,
  description: "PostgreSQL only from the app security group",
});

// Исходящее у клиентов базы тоже сужено до одного порта и одной группы.
new aws.vpc.SecurityGroupEgressRule("app-postgres-to-db", {
  securityGroupId: appSg.id,
  ipProtocol: "tcp",
  fromPort: 5432,
  toPort: 5432,
  referencedSecurityGroupId: dbSg.id,
  description: "PostgreSQL to the database group only",
});

// ---------------------------------------------------------------------------
// 4. IAM. Доступ для CI (пользователь hw31-ci + роль hw31-ci-teardown) и роль для Lambda.
//
// Роль Lambda лежит здесь, в base, а не в demo: её создаёт админ с ноутбука,
// а ночная уборка в CI только сносит функцию и в IAM не заходит вовсе.
// Это позволяет не давать роли CI ни одного права iam:*.
// Роль бесплатная, у неё нет политик: Lambda ничего не пишет в логи, и лог-группа
// (которая осталась бы после уборки и копила бы хранение) не появляется.
// ---------------------------------------------------------------------------
const githubRepo = cfg.require("githubRepo");
const accountIdForNames = aws.getCallerIdentityOutput({}).accountId;

// Доступ CI: пользователь hw31-ci (может только взять роль) и роль hw31-ci-teardown.
// Подробности и причины - в src/ci-access.ts. Флаги:
//   hw31:ciOidc          - добавить в доверие роли блок GitHub OIDC (если AWS его не примет, выключить)
//   hw31:ciOidcProvider  - создавать сам OIDC-провайдер (на Free plan запрещено, оставить выключенным)
const ci = createCiAccess({
  githubRepo,
  branches: ["main", "hw-31"],
  regions: ["eu-north-1", "us-east-1"],
  accountId: accountIdForNames,
  stateBucketName: pulumi.interpolate`hw31-pulumi-state-${accountIdForNames}`,
  oidcTrust: cfg.getBoolean("ciOidc") ?? false,
  oidcProvider: cfg.getBoolean("ciOidcProvider") ?? false,
});

const lambdaRole = new aws.iam.Role("lambda-exec", {
  name: "hw31-lambda-exec",
  description: "Execution role for the ALB target Lambda in the demo stack; no policies",
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      { Effect: "Allow", Principal: { Service: "lambda.amazonaws.com" }, Action: "sts:AssumeRole" },
    ],
  }),
});

// Справочные data source: ничего не создают, показывают, под кем и где работаем.
const identity = aws.getCallerIdentityOutput({});
const region = aws.getRegionOutput({});

export const accountId = identity.accountId;
export const regionName = region.name;
export const budgetName = budget.name;
export const vpcId = vpc.id;
export const vpcCidr = vpc.cidrBlock;
export const publicSubnetIds = publicSubnets.map((s) => s.id);
export const privateSubnetIds = privateSubnets.map((s) => s.id);
export const privateRouteTableId = privateRt.id;
export const edgeSgId = edgeSg.id;
export const appSgId = appSg.id;
export const dbSgId = dbSg.id;
export const ciUserName = ci.user.name;
export const ciUserArn = ci.user.arn;
export const ciRoleArn = ci.role.arn;
export const ciRoleName = ci.role.name;
export const lambdaRoleArn = lambdaRole.arn;

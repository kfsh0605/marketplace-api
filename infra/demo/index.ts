import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";

// ---------------------------------------------------------------------------
// 0. TRANSFORM - регистрируется ДО любого ресурса.
//
// Страховка для сноса: что бы ни написали в коде ниже, у любой базы RDS защита от удаления
// выключена, а финальный снимок не требуется. Иначе забытая deletionProtection=true или
// отсутствие финального снимка остановят ночной destroy, и база (около $0,04 в час) останется.
// ---------------------------------------------------------------------------
pulumi.runtime.registerResourceTransform((args) => {
  if (args.type === "aws:rds/instance:Instance") {
    return {
      props: { ...args.props, deletionProtection: false, skipFinalSnapshot: true },
      opts: args.opts,
    };
  }
  return undefined;
});

const cfg = new pulumi.Config("hw31");
const withNat = cfg.getBoolean("withNat") ?? false;

// ---------------------------------------------------------------------------
// 1. Что нам даёт стек base (сеть и группы безопасности лежат там, они бесплатные).
// ---------------------------------------------------------------------------
const base = new pulumi.StackReference("base", {
  name: cfg.get("baseStack") ?? "organization/hw31-base/base",
});
const publicSubnetIds = base.requireOutput("publicSubnetIds") as pulumi.Output<string[]>;
const privateSubnetIds = base.requireOutput("privateSubnetIds") as pulumi.Output<string[]>;
const privateRouteTableId = base.requireOutput("privateRouteTableId") as pulumi.Output<string>;
const edgeSgId = base.requireOutput("edgeSgId") as pulumi.Output<string>;
const dbSgId = base.requireOutput("dbSgId") as pulumi.Output<string>;
const lambdaRoleArn = base.requireOutput("lambdaRoleArn") as pulumi.Output<string>;

// ---------------------------------------------------------------------------
// 2. БАЗА ДАННЫХ: RDS PostgreSQL, Multi-AZ instance.
//
// Multi-AZ instance - это основная база + синхронная запасная копия в другой зоне (AZ).
// Это НЕ read replica (она отстаёт и нужна для чтения) и НЕ резервная копия (бэкап
// восстанавливают минутами, а Multi-AZ переключается за 1-2 минуты автоматически).
// Шифрование идёт стандартным ключом AWS (aws/rds): собственный ключ KMS стоит $1 в месяц
// и нам не нужен.
// ---------------------------------------------------------------------------
const dbPassword = new random.RandomPassword("db-password", { length: 24, special: false });

const subnetGroup = new aws.rds.SubnetGroup("db", {
  name: "hw31-demo-db",
  subnetIds: privateSubnetIds,
});

export const db = new aws.rds.Instance("db", {
  identifier: "hw31-demo-db",
  engine: "postgres",
  engineVersion: cfg.get("pgVersion") ?? "17",
  instanceClass: "db.t4g.micro",
  allocatedStorage: 20,
  storageType: "gp3",
  storageEncrypted: true,
  multiAz: true,
  dbName: "marketplace",
  username: "marketplace",
  password: dbPassword.result,
  dbSubnetGroupName: subnetGroup.name,
  vpcSecurityGroupIds: [dbSgId],
  publiclyAccessible: false,
  backupRetentionPeriod: 1,
  // Эти два значения transform выше всё равно переопределит; они здесь для читателя.
  deletionProtection: false,
  skipFinalSnapshot: true,
  applyImmediately: true,
});

// ---------------------------------------------------------------------------
// 3. БАЛАНСИРОВЩИК: ALB (internet-facing) -> целевая группа с проверкой здоровья -> Lambda.
// Lambda вместо EC2: нет почасовой машины и публичного IPv4 под неё, образа и SSH.
// ---------------------------------------------------------------------------
const handlerCode = `exports.handler = async (event) => ({
  statusCode: 200,
  statusDescription: "200 OK",
  isBase64Encoded: false,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ok: true, service: "hw31-demo", path: event.path }),
});
`;

const fn = new aws.lambda.Function("target", {
  name: "hw31-demo-target",
  runtime: "nodejs22.x",
  handler: "index.handler",
  role: lambdaRoleArn,
  architectures: ["arm64"],
  memorySize: 128,
  timeout: 5,
  code: new pulumi.asset.AssetArchive({ "index.js": new pulumi.asset.StringAsset(handlerCode) }),
});

const targetGroup = new aws.lb.TargetGroup("target", {
  name: "hw31-demo-tg",
  targetType: "lambda",
  healthCheck: {
    enabled: true, // у Lambda-целей проверка выключена по умолчанию; включаем явно
    path: "/health",
    interval: 15,
    timeout: 5,
    healthyThreshold: 2,
    unhealthyThreshold: 2,
    matcher: "200",
  },
});

// Без этого разрешения ALB не имеет права вызывать функцию.
const invokePermission = new aws.lambda.Permission("alb-invoke", {
  action: "lambda:InvokeFunction",
  function: fn.name,
  principal: "elasticloadbalancing.amazonaws.com",
  sourceArn: targetGroup.arn,
});

new aws.lb.TargetGroupAttachment(
  "lambda",
  { targetGroupArn: targetGroup.arn, targetId: fn.arn },
  { dependsOn: [invokePermission] },
);

export const alb = new aws.lb.LoadBalancer("alb", {
  name: "hw31-demo-alb",
  loadBalancerType: "application",
  internal: false,
  securityGroups: [edgeSgId],
  subnets: publicSubnetIds,
  enableDeletionProtection: false,
});

new aws.lb.Listener("http", {
  loadBalancerArn: alb.arn,
  port: 80,
  protocol: "HTTP",
  defaultActions: [{ type: "forward", targetGroupArn: targetGroup.arn }],
});

// ---------------------------------------------------------------------------
// 4. NAT - только за флагом hw31:withNat. NAT-шлюз стоит $0,052 в час, а Elastic IP
// ещё $0,005 в час, причём начатый час считается целым. Поэтому по умолчанию выключено,
// а скрипт demo:nat включает флаг на минуты, снимает доказательство и выключает обратно.
// ---------------------------------------------------------------------------
let natGatewayId: pulumi.Output<string> | undefined;
if (withNat) {
  const eip = new aws.ec2.Eip("nat", { domain: "vpc" });
  const nat = new aws.ec2.NatGateway("nat", {
    allocationId: eip.id,
    subnetId: publicSubnetIds.apply((ids) => ids[0]),
    connectivityType: "public",
  });
  new aws.ec2.Route("private-default-via-nat", {
    routeTableId: privateRouteTableId,
    destinationCidrBlock: "0.0.0.0/0",
    natGatewayId: nat.id,
  });
  natGatewayId = nat.id;
}

export const albDns = alb.dnsName;
export const albArn = alb.arn;
export const targetGroupArn = targetGroup.arn;
export const dbIdentifier = db.identifier;
export const dbEndpoint = db.address;
export const natEnabled = withNat;
export const natGateway = natGatewayId;

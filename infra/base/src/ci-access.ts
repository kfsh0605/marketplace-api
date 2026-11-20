import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

// Доступ CI в AWS. Задумка была такой: GitHub Actions показывает AWS подписанный токен (OIDC),
// и никаких постоянных ключей нет. Но на аккаунтах Free plan политика организации
// DenyIAMRestrictedActions запрещает iam:*Provider*, поэтому OIDC-провайдера создать нельзя.
//
// Рабочая схема (согласована с преподавателем):
//   1. IAM-пользователь hw31-ci: у него НЕТ прав, кроме одного - взять роль hw31-ci-teardown.
//   2. Ключ этого пользователя лежит только в секретах GitHub Environment "teardown".
//   3. Роль hw31-ci-teardown делает всю работу. Всё, что умеет роль, получит тот, кто украдёт ключ,
//      поэтому в роли нет iam:Create*, Put*, Attach*, PassRole, UpdateAssumeRolePolicy, CreateAccessKey.
//   4. Доверие к GitHub OIDC (Federated, aud, sub) оставлено в коде за флагом hw31:ciOidc:
//      если AWS примет такую роль, оно заработает, как только провайдер станет разрешён.

type Perm = readonly [action: string, why: string];

interface Group {
  sid: string;
  title: string;
  // bucket   - сам бакет состояния; objects - файлы внутри него;
  // regional - ресурсы AWS в разрешённых регионах (Resource "*" вынужден: у Describe-вызовов нет ARN)
  // global   - глобальные сервисы (IAM): регион в запросе не меняется, условие по региону не ставим
  scope: "bucket" | "objects" | "regional" | "global";
  perms: Perm[];
}

// Каждое разрешение записано вместе с причиной: из этого списка строится и политика,
// и таблица в README. Ни одного "*" в Action: только перечисленные действия.
export const PERMISSION_GROUPS: Group[] = [
  {
    sid: "StateBucketList",
    title: "Состояние Pulumi в S3: сам бакет",
    scope: "bucket",
    perms: [
      ["s3:ListBucket", "Pulumi перечисляет файлы состояния стека"],
      ["s3:GetBucketLocation", "бэкенд узнаёт регион бакета"],
    ],
  },
  {
    sid: "StateBucketObjects",
    title: "Состояние Pulumi в S3: файлы внутри бакета",
    scope: "objects",
    perms: [
      ["s3:GetObject", "прочитать состояние стека demo и base"],
      ["s3:PutObject", "записать новое состояние после destroy"],
      ["s3:DeleteObject", "убрать устаревшие снимки состояния"],
    ],
  },
  {
    sid: "EmptinessChecks",
    title: "Шесть проверок пустоты (только чтение)",
    scope: "regional",
    perms: [
      ["tag:GetResources", "tagged-resources-left: всё, что осталось с тегами проекта"],
      ["rds:DescribeDBInstances", "rds-left и ожидание удаления базы"],
      ["elasticloadbalancing:DescribeLoadBalancers", "alb-left"],
      ["ec2:DescribeNatGateways", "nat-left"],
      ["ec2:DescribeAddresses", "eip-left"],
    ],
  },
  {
    sid: "ScpEvidence",
    title: "Доказательство, что OIDC закрыт политикой организации",
    scope: "global",
    perms: [
      [
        "iam:ListOpenIDConnectProviders",
        "прав у роли достаточно, но AWS всё равно отвечает explicit deny in a service control policy: это видно в логе",
      ],
    ],
  },
  {
    sid: "DestroyDatabase",
    title: "Снос базы данных",
    scope: "regional",
    perms: [
      ["rds:DeleteDBInstance", "удалить сам экземпляр RDS"],
      ["rds:ModifyDBInstance", "провайдер снимает защиту от удаления перед сносом"],
      ["rds:ListTagsForResource", "провайдер читает теги перед сносом"],
      ["rds:DescribeDBSubnetGroups", "прочитать группу подсетей перед сносом"],
      ["rds:DeleteDBSubnetGroup", "удалить группу подсетей базы"],
    ],
  },
  {
    sid: "DestroyLoadBalancer",
    title: "Снос балансировщика и целевой группы",
    scope: "regional",
    perms: [
      ["elasticloadbalancing:DeleteLoadBalancer", "удалить ALB"],
      ["elasticloadbalancing:DescribeLoadBalancerAttributes", "провайдер читает атрибуты ALB"],
      ["elasticloadbalancing:ModifyLoadBalancerAttributes", "снять защиту от удаления ALB, если она включена"],
      ["elasticloadbalancing:DescribeTags", "провайдер читает теги ALB и целевой группы"],
      ["elasticloadbalancing:DescribeListeners", "найти слушатели ALB"],
      ["elasticloadbalancing:DescribeListenerAttributes", "провайдер читает атрибуты слушателя"],
      ["elasticloadbalancing:DeleteListener", "удалить слушатель порта 80"],
      ["elasticloadbalancing:DescribeTargetGroups", "найти целевую группу"],
      ["elasticloadbalancing:DescribeTargetGroupAttributes", "провайдер читает атрибуты целевой группы"],
      ["elasticloadbalancing:DescribeTargetHealth", "проверить, кто ещё зарегистрирован в группе"],
      ["elasticloadbalancing:DeregisterTargets", "отцепить Lambda от целевой группы"],
      ["elasticloadbalancing:DeleteTargetGroup", "удалить целевую группу"],
    ],
  },
  {
    sid: "DestroyLambdaTarget",
    title: "Снос Lambda-цели для ALB",
    scope: "regional",
    perms: [
      ["lambda:GetFunction", "прочитать функцию перед сносом и дождаться удаления"],
      ["lambda:ListVersionsByFunction", "убедиться, что версий не осталось"],
      ["lambda:GetPolicy", "прочитать разрешение для ALB"],
      ["lambda:RemovePermission", "убрать разрешение ALB вызывать функцию"],
      ["lambda:DeleteFunction", "удалить функцию"],
    ],
  },
  {
    sid: "DestroyNat",
    title: "Снос NAT, его адреса и маршрута (если стек поднимали с withNat)",
    scope: "regional",
    perms: [
      ["ec2:DeleteNatGateway", "удалить NAT-шлюз"],
      ["ec2:ReleaseAddress", "вернуть Elastic IP: он платный, пока не освобождён"],
      ["ec2:DisassociateAddress", "отвязать адрес перед освобождением"],
      ["ec2:DescribeAddressesAttribute", "провайдер читает атрибуты адреса"],
      ["ec2:DeleteRoute", "убрать маршрут 0.0.0.0/0 из приватной таблицы"],
      ["ec2:DescribeRouteTables", "найти этот маршрут"],
      ["ec2:DescribeNetworkInterfaces", "дождаться, пока сетевые интерфейсы NAT и ALB исчезнут"],
      ["ec2:DescribeTags", "провайдер читает теги ресурсов EC2"],
    ],
  },
];

export interface CiAccessArgs {
  githubRepo: string; // owner/name
  branches: string[]; // ветки, которым разрешено брать роль (для OIDC-доверия)
  regions: string[]; // регионы, где роли вообще можно что-то делать
  accountId: pulumi.Input<string>;
  stateBucketName: pulumi.Input<string>;
  oidcTrust: boolean; // добавить в доверие роли блок GitHub OIDC (Federated)
  oidcProvider: boolean; // создавать сам OIDC-провайдер (на Free plan запрещено SCP)
}

export function createCiAccess(args: CiAccessArgs) {
  const oidcHost = "token.actions.githubusercontent.com";

  // Пользователь для CI. forceDestroy: при удалении пользователя Pulumi сначала снесёт его ключ,
  // который создан вручную через CLI и в состоянии Pulumi не значится.
  const user = new aws.iam.User("ci", { name: "hw31-ci", forceDestroy: true });

  const provider = args.oidcProvider
    ? new aws.iam.OpenIdConnectProvider("github", {
        url: `https://${oidcHost}`,
        clientIdLists: ["sts.amazonaws.com"],
      })
    : undefined;
  const providerArn = provider
    ? provider.arn
    : pulumi.interpolate`arn:aws:iam::${args.accountId}:oidc-provider/${oidcHost}`;

  const trust: Record<string, unknown>[] = [
    {
      // Взять роль может только пользователь hw31-ci. TagSession нужен, потому что
      // configure-aws-credentials помечает сессию данными запуска GitHub.
      Sid: "CiUser",
      Effect: "Allow",
      Principal: { AWS: user.arn },
      Action: ["sts:AssumeRole", "sts:TagSession"],
    },
  ];
  if (args.oidcTrust) {
    trust.push({
      // Токен выпущен GitHub (Federated), для AWS STS (aud), от нашего репозитория на разрешённой ветке (sub).
      Sid: "GithubOidc",
      Effect: "Allow",
      Principal: { Federated: providerArn },
      Action: "sts:AssumeRoleWithWebIdentity",
      Condition: {
        StringEquals: { [`${oidcHost}:aud`]: "sts.amazonaws.com" },
        StringLike: {
          [`${oidcHost}:sub`]: args.branches.map((b) => `repo:${args.githubRepo}:ref:refs/heads/${b}`),
        },
      },
    });
  }

  // IAM принимает в description только латиницу (ASCII и Latin-1), кириллицу отвергает
  const role = new aws.iam.Role("ci-teardown", {
    name: "hw31-ci-teardown",
    description: "GitHub Actions: nightly teardown of the demo stack and emptiness checks",
    assumeRolePolicy: pulumi.jsonStringify({ Version: "2012-10-17", Statement: trust }),
  });

  // Единственное, что может пользователь: взять эту одну роль.
  new aws.iam.UserPolicy("ci-assume", {
    name: "assume-ci-role",
    user: user.name,
    policy: pulumi.jsonStringify({
      Version: "2012-10-17",
      Statement: [
        { Effect: "Allow", Action: ["sts:AssumeRole", "sts:TagSession"], Resource: role.arn },
      ],
    }),
  });

  const bucketArn = pulumi.interpolate`arn:aws:s3:::${args.stateBucketName}`;
  const regionCondition = { StringEquals: { "aws:RequestedRegion": args.regions } };

  const statements = PERMISSION_GROUPS.map((g) => {
    const actions = g.perms.map(([action]) => action);
    switch (g.scope) {
      case "bucket":
        return { Sid: g.sid, Effect: "Allow", Action: actions, Resource: bucketArn };
      case "objects":
        return { Sid: g.sid, Effect: "Allow", Action: actions, Resource: pulumi.interpolate`${bucketArn}/*` };
      case "regional":
        return { Sid: g.sid, Effect: "Allow", Action: actions, Resource: "*", Condition: regionCondition };
      case "global":
        return { Sid: g.sid, Effect: "Allow", Action: actions, Resource: "*" };
    }
  });

  new aws.iam.RolePolicy("ci-teardown", {
    name: "teardown",
    role: role.name,
    policy: pulumi.jsonStringify({ Version: "2012-10-17", Statement: statements }),
  });

  return { provider, role, user };
}

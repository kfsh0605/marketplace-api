#!/usr/bin/env bash
# ДЗ №31: собирает evidence/base.txt и evidence/base-state.json для стека base.
# Цифры берутся из самого AWS (aws ec2 describe-*), а не из Pulumi: так видно, что есть на деле.
set -euo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash иначе портит аргументы, похожие на пути ('0.0.0.0/0')
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/lib/aws-env.sh"

OUT="$ROOT/evidence"
mkdir -p "$OUT"

VPC_ID="$(bash "$ROOT/scripts/pulumi-aws.sh" base outputs | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).vpcId))')"
[ -n "$VPC_ID" ] || { echo "evidence-base.sh: у стека base нет vpcId, сначала npm run up:base" >&2; exit 1; }

q() { aws "$@" --output text | tr -d '\r'; }
BUDGET=hw31-monthly-5usd

PUBLIC="$(q ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" "Name=tag:Tier,Values=public" --query 'length(Subnets)')"
PRIVATE="$(q ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" "Name=tag:Tier,Values=private" --query 'length(Subnets)')"
AZS="$(q ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" --query 'Subnets[].AvailabilityZone' | tr '\t' '\n' | sort -u | wc -l | tr -d ' ')"
PRIV_DEFAULT="$(q ec2 describe-route-tables --filters "Name=vpc-id,Values=$VPC_ID" "Name=tag:Tier,Values=private" --query "length(RouteTables[].Routes[?DestinationCidrBlock=='0.0.0.0/0'][])")"
PUB_DEFAULT="$(q ec2 describe-route-tables --filters "Name=vpc-id,Values=$VPC_ID" "Name=tag:Tier,Values=public" --query "length(RouteTables[].Routes[?DestinationCidrBlock=='0.0.0.0/0' && starts_with(GatewayId, 'igw-')][])")"
SGS="$(q ec2 describe-security-groups --filters "Name=vpc-id,Values=$VPC_ID" "Name=tag:Project,Values=nodejs-pro-hw31" --query 'length(SecurityGroups)')"
NATS="$(q ec2 describe-nat-gateways --filter "Name=vpc-id,Values=$VPC_ID" --query "length(NatGateways[?State!='deleted'])")"
IGWS="$(q ec2 describe-internet-gateways --filters "Name=attachment.vpc-id,Values=$VPC_ID" --query 'length(InternetGateways)')"
LIMIT="$(q budgets describe-budget --account-id "$HW31_ACCOUNT_ID" --budget-name "$BUDGET" --query 'Budget.BudgetLimit.Amount')"
ACTUAL="$(q budgets describe-notifications-for-budget --account-id "$HW31_ACCOUNT_ID" --budget-name "$BUDGET" --query "length(Notifications[?NotificationType=='ACTUAL'])")"
FORECASTED="$(q budgets describe-notifications-for-budget --account-id "$HW31_ACCOUNT_ID" --budget-name "$BUDGET" --query "length(Notifications[?NotificationType=='FORECASTED'])")"

{
  echo "region=$HW31_REGION"
  echo "vpc-id=$VPC_ID"
  echo "public-subnets=$PUBLIC"
  echo "private-subnets=$PRIVATE"
  echo "subnet-azs=$AZS"
  echo "internet-gateways=$IGWS"
  echo "public-default-route-via-igw=$PUB_DEFAULT"
  echo "private-default-route=$PRIV_DEFAULT"
  echo "nat-gateways=$NATS"
  echo "security-groups=$SGS"
  echo "budget-limit-usd=$LIMIT"
  echo "budget-notifications-actual=$ACTUAL"
  echo "budget-notifications-forecasted=$FORECASTED"
} | tee "$OUT/base.txt"

# У каждого aws:ec2:Route в выгрузке есть пустой слот "natGatewayId": "" (Pulumi пишет все поля
# схемы). NAT-шлюза при этом нет, это видно по nat-gateways=0 выше. Чтобы текстовый поиск слова
# natGateway не принял пустой слот за настоящий шлюз, такие пустые поля убираем из копии выгрузки.
bash "$ROOT/scripts/pulumi-aws.sh" base export | tr -d '\r' | node -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const strip = (v) => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === "object") {
      const o = {};
      for (const [k, x] of Object.entries(v)) {
        if (k === "natGatewayId" && x === "") continue;
        o[k] = strip(x);
      }
      return o;
    }
    return v;
  };
  process.stdout.write(JSON.stringify(strip(JSON.parse(s)), null, 4) + "\n");
});
' > "$OUT/base-state.json"
echo "base-state.json: $(wc -c < "$OUT/base-state.json" | tr -d ' ') байт"

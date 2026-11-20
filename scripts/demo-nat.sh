#!/usr/bin/env bash
# ДЗ №31: demo:nat - включить NAT-шлюз на минуты, снять доказательство и выключить обратно.
# NAT и его Elastic IP стоят денег каждый начатый час, поэтому шлюз живёт считанные минуты,
# а при любой ошибке скрипт всё равно выключает его (trap).
# Печатает nat-minutes и nat-billed-hours и записывает их в evidence/demos.txt.
set -euo pipefail
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# node.exe - программа Windows: ей нужен путь вида C:/..., а не /c/... (pwd -W даёт его в Git Bash)
ROOT_NATIVE="$(cd "$ROOT" && { pwd -W 2>/dev/null || pwd; })"
source "$ROOT/scripts/lib/aws-env.sh"
PULUMI="$ROOT/scripts/pulumi-aws.sh"

NAT_ON=0
disable_nat() {
  if [ "$NAT_ON" = "1" ]; then
    echo "demo-nat.sh: выключаю NAT..." >&2
    bash "$PULUMI" demo up --config hw31:withNat=false >&2 || echo "demo-nat.sh: НЕ УДАЛОСЬ выключить NAT, выполните npm run up:demo вручную!" >&2
    NAT_ON=0
  fi
}
trap disable_nat EXIT

NAT_ON=1
bash "$PULUMI" demo up --config hw31:withNat=true

OUTPUTS="$(bash "$PULUMI" demo outputs | tr -d '\r')"
NAT_ID="$(OUTPUTS="$OUTPUTS" node -e 'process.stdout.write(String(JSON.parse(process.env.OUTPUTS).natGateway??""))')"
[ -n "$NAT_ID" ] && [ "$NAT_ID" != "none" ] || { echo "demo-nat.sh: у стека нет natGateway" >&2; exit 1; }

NAT_STATE="$(aws ec2 describe-nat-gateways --nat-gateway-ids "$NAT_ID" --query 'NatGateways[0].State' --output text | tr -d '\r')"
CREATED="$(aws ec2 describe-nat-gateways --nat-gateway-ids "$NAT_ID" --query 'NatGateways[0].CreateTime' --output text | tr -d '\r')"
VPC_ID="$(bash "$PULUMI" base outputs | tr -d '\r' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).vpcId))')"
VIA_NAT="$(aws ec2 describe-route-tables --filters "Name=vpc-id,Values=$VPC_ID" "Name=tag:Tier,Values=private" \
  --query "length(RouteTables[].Routes[?DestinationCidrBlock=='0.0.0.0/0' && NatGatewayId=='$NAT_ID'][])" --output text | tr -d '\r')"

# Выключаем NAT и ждём, пока AWS покажет состояние deleted с временем удаления
disable_nat
DELETED=""
for _ in $(seq 1 60); do
  STATE_NOW="$(aws ec2 describe-nat-gateways --nat-gateway-ids "$NAT_ID" --query 'NatGateways[0].State' --output text | tr -d '\r')"
  if [ "$STATE_NOW" = "deleted" ]; then
    DELETED="$(aws ec2 describe-nat-gateways --nat-gateway-ids "$NAT_ID" --query 'NatGateways[0].DeleteTime' --output text | tr -d '\r')"
    break
  fi
  sleep 10
done
[ -n "$DELETED" ] || { echo "demo-nat.sh: NAT не перешёл в deleted вовремя" >&2; exit 1; }

# Минуты жизни шлюза округляем вверх; тарификация идёт по ЦЕЛЫМ часам (начатый час = целый).
MINUTES="$(CREATED="$CREATED" DELETED="$DELETED" node -e 'const m=(Date.parse(process.env.DELETED)-Date.parse(process.env.CREATED))/60000;process.stdout.write(String(Math.ceil(m)))')"
HOURS="$(MINUTES="$MINUTES" node -e 'process.stdout.write(String(Math.max(1,Math.ceil(Number(process.env.MINUTES)/60))))')"

LINES="$(printf 'nat-gateway=%s\nnat-state-up=%s\nprivate-default-route-via-nat=%s\nnat-minutes=%s\nnat-billed-hours=%s' "$NAT_ID" "$NAT_STATE" "$VIA_NAT" "$MINUTES" "$HOURS")"
printf '%s\n' "$LINES"
printf '%s\n' "$LINES" | node "$ROOT_NATIVE/scripts/lib/demos-write.mjs" demo:nat

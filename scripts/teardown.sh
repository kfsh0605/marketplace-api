#!/usr/bin/env bash
# ДЗ №31: уборка. Порядок: destroy стека demo -> выгрузка состояния -> шесть проверок пустоты
# -> печать контракта. Любое "не ноль" или "не удалось проверить" даёт ненулевой код выхода:
# неизвестное не проходит молча.
#
# Проверки идут только в своём регионе (eu-north-1): us-east-1 на аккаунте Free plan закрыт
# политикой организации (tag:GetResources там даёт explicit deny), см. README.
set -uo pipefail
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/lib/aws-env.sh" || exit 1

STATE_FILE="$(mktemp)"
IGNORED_FILE="$(mktemp)"
trap 'rm -f "$STATE_FILE" "$IGNORED_FILE"' EXIT

echo "::group::pulumi destroy (stack demo)"
bash "$ROOT/scripts/pulumi-aws.sh" demo destroy
DESTROY_RC=$?
echo "::endgroup::"
echo "destroy-exit-code=$DESTROY_RC"

bash "$ROOT/scripts/pulumi-aws.sh" demo export 2>/dev/null | tr -d '\r' > "$STATE_FILE"

count_state() {
  node -e '
    const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const rs = (d.deployment && d.deployment.resources) || [];
    process.stdout.write(String(rs.filter((r) => !r.type.startsWith("pulumi:")).length));
  ' "$STATE_FILE"
}
# Удалённый NAT-шлюз AWS ещё долго (больше часа) показывает в API тегов как запись
# в состоянии "deleted": ресурса уже нет, он не тарифицируется, но тег-API его помнит.
# Поэтому шлюзы в состоянии deleted (или уже не найденные в EC2) не считаются остатком;
# каждый такой пропуск печатается в лог. Любой другой ресурс и любая неопределённость - остаток.
count_tagged() {
  local arns arn id out left=0
  arns="$(aws resourcegroupstaggingapi get-resources --tag-filters Key=Project,Values=nodejs-pro-hw31 Key=Stack,Values=demo \
    --query 'ResourceTagMappingList[].ResourceARN' --output text | tr '\t' '\n' | tr -d '\r')" || return 1
  for arn in $arns; do
    case "$arn" in
      arn:aws:ec2:*:natgateway/*)
        id="${arn##*/}"
        out="$(aws ec2 describe-nat-gateways --nat-gateway-ids "$id" --query 'NatGateways[0].State' --output text 2>&1 | tr -d '\r')"
        if [ "$out" = "deleted" ] || printf '%s' "$out" | grep -q 'NatGatewayNotFound'; then
          echo "$id (EC2 state: ${out%%$'\n'*})" >> "$IGNORED_FILE"
          continue
        fi
        ;;
    esac
    left=$((left + 1))
  done
  printf '%s' "$left"
}
count_rds() { aws rds describe-db-instances --query 'length(DBInstances)' --output text; }
count_alb() { aws elbv2 describe-load-balancers --query 'length(LoadBalancers)' --output text; }
count_nat() { aws ec2 describe-nat-gateways --filter Name=state,Values=pending,available --query 'length(NatGateways)' --output text; }
count_eip() { aws ec2 describe-addresses --query 'length(Addresses)' --output text; }

FAILED=0
RESULTS=""
# Каждая проверка повторяется до 5 минут: API тегов и удаление сетевых ресурсов отстают на минуты.
# Если значение не число (ошибка доступа и т.п.), это провал, а не ноль.
check() { # <имя> <функция>
  local name="$1" fn="$2" value="" i
  for i in $(seq 1 15); do
    value="$("$fn" 2>&1 | tr -d '\r')"
    if [[ "$value" =~ ^[0-9]+$ ]]; then
      [ "$value" = "0" ] && break
    else
      echo "$name: не удалось получить число (попытка $i): $value" >&2
    fi
    sleep 20
  done
  if [ "$value" = "0" ]; then
    RESULTS+="$name=0 OK"$'\n'
  else
    RESULTS+="$name=${value:-unknown} FAIL"$'\n'
    FAILED=1
    if [ "$name" = "tagged-resources-left" ]; then
      echo "leftover-tagged-arns:"
      aws resourcegroupstaggingapi get-resources --tag-filters Key=Project,Values=nodejs-pro-hw31 Key=Stack,Values=demo \
        --query 'ResourceTagMappingList[].ResourceARN' --output text 2>&1 | tr '\t' '\n' | tr -d '\r'
    fi
  fi
}

echo "::group::emptiness checks (region $HW31_REGION)"
check state-resources-left count_state
check tagged-resources-left count_tagged
check rds-left count_rds
check alb-left count_alb
check nat-left count_nat
check eip-left count_eip
echo "::endgroup::"

echo "================ teardown contract ================"
echo "account=$HW31_ACCOUNT_ID region=$HW31_REGION run=${GITHUB_RUN_ID:-local}"
printf '%s' "$RESULTS"
if [ -s "$IGNORED_FILE" ]; then
  while read -r line; do
    echo "ignored-deleted-nat-gateway=$line: tombstone of a deleted gateway in the tagging API, not a live resource, not billed"
  done < "$IGNORED_FILE"
fi
echo "us-east-1-checks=skipped (explicit deny by the organization policy on this Free plan account)"
if [ "$FAILED" = "0" ] && [ "$DESTROY_RC" = "0" ]; then
  echo "teardown-result=OK"
  exit 0
fi
echo "teardown-result=FAIL"
exit 1

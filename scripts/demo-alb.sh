#!/usr/bin/env bash
# ДЗ №31: demo:alb - достучаться до балансировщика снаружи и убедиться, что цель здорова.
# Печатает alb-dns, http-code и target-state и записывает их в evidence/demos.txt.
set -euo pipefail
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# node.exe - программа Windows: ей нужен путь вида C:/..., а не /c/... (pwd -W даёт его в Git Bash)
ROOT_NATIVE="$(cd "$ROOT" && { pwd -W 2>/dev/null || pwd; })"
source "$ROOT/scripts/lib/aws-env.sh"

OUTPUTS="$(bash "$ROOT/scripts/pulumi-aws.sh" demo outputs | tr -d '\r')"
field() { OUTPUTS="$OUTPUTS" node -e 'const o=JSON.parse(process.env.OUTPUTS);process.stdout.write(String(o[process.argv[1]]??""))' "$1"; }
ALB_DNS="$(field albDns)"
TG_ARN="$(field targetGroupArn)"
[ -n "$ALB_DNS" ] && [ -n "$TG_ARN" ] || { echo "demo-alb.sh: у стека demo нет albDns: сначала npm run up:demo" >&2; exit 1; }

# ALB после создания ещё 1-2 минуты прогревается (DNS, первые проверки здоровья), поэтому ждём.
HTTP_CODE=000
for _ in $(seq 1 30); do
  HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://$ALB_DNS/" || true)"
  [ "$HTTP_CODE" = "200" ] && break
  sleep 10
done

STATE=unknown
for _ in $(seq 1 30); do
  STATE="$(aws elbv2 describe-target-health --target-group-arn "$TG_ARN" --query 'TargetHealthDescriptions[0].TargetHealth.State' --output text | tr -d '\r')"
  [ "$STATE" = "healthy" ] && break
  sleep 10
done

BODY="$(curl -s --max-time 10 "http://$ALB_DNS/" | tr -d '\r' || true)"
LINES="$(printf 'alb-dns=%s\nhttp-code=%s\ntarget-state=%s\nbody=%s' "$ALB_DNS" "$HTTP_CODE" "$STATE" "$BODY")"
printf '%s\n' "$LINES"
printf '%s\n' "$LINES" | node "$ROOT_NATIVE/scripts/lib/demos-write.mjs" demo:alb
[ "$HTTP_CODE" = "200" ] && [ "$STATE" = "healthy" ]

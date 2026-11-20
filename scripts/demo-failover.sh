#!/usr/bin/env bash
# ДЗ №31: demo:failover - принудительно переключить Multi-AZ базу на запасную зону и измерить время.
# Печатает az-before, az-after, failover-seconds, event и записывает их в evidence/demos.txt.
set -euo pipefail
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/lib/aws-env.sh"

DB=hw31-demo-db
q() { aws rds describe-db-instances --db-instance-identifier "$DB" --query "DBInstances[0].$1" --output text | tr -d '\r'; }

[ "$(q MultiAZ)" = "True" ] || { echo "demo-failover.sh: база $DB не Multi-AZ или не создана: сначала npm run up:demo" >&2; exit 1; }
[ "$(q DBInstanceStatus)" = "available" ] || { echo "demo-failover.sh: база ещё не available, подождите и повторите" >&2; exit 1; }

AZ_BEFORE="$(q AvailabilityZone)"
STANDBY="$(q SecondaryAvailabilityZone)"
START_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
T0="$(date +%s)"

aws rds reboot-db-instance --db-instance-identifier "$DB" --force-failover >/dev/null

# Ждём, пока зона сменится И база снова станет available (проверяем раз в 5 секунд, до 15 минут).
AZ_AFTER="$AZ_BEFORE"
for _ in $(seq 1 180); do
  sleep 5
  AZ_NOW="$(q AvailabilityZone)"
  STATUS="$(q DBInstanceStatus)"
  if [ "$AZ_NOW" != "$AZ_BEFORE" ] && [ "$STATUS" = "available" ]; then
    AZ_AFTER="$AZ_NOW"
    break
  fi
done
SECONDS_TOTAL=$(( $(date +%s) - T0 ))

# Событие RDS о переключении (события появляются с небольшой задержкой)
EVENT=""
for _ in $(seq 1 12); do
  EVENT="$(aws rds describe-events --source-type db-instance --source-identifier "$DB" --start-time "$START_ISO" \
    --query "Events[?contains(Message, 'failover completed')].Message | [0]" --output text | tr -d '\r')"
  [ -n "$EVENT" ] && [ "$EVENT" != "None" ] && break
  sleep 5
done

LINES="$(printf 'standby-az-before=%s\naz-before=%s\naz-after=%s\nfailover-seconds=%s\nevent=%s' "$STANDBY" "$AZ_BEFORE" "$AZ_AFTER" "$SECONDS_TOTAL" "$EVENT")"
printf '%s\n' "$LINES"
printf '%s\n' "$LINES" | node "$ROOT/scripts/lib/demos-write.mjs" demo:failover
[ "$AZ_BEFORE" != "$AZ_AFTER" ]

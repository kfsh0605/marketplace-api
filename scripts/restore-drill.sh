#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/lib/parse-database-url.sh"
cd "$ROOT"

BACKUP_DIR="$ROOT/backups"

LATEST_DUMP="$(ls -t "$BACKUP_DIR"/marketplace_*.dump 2>/dev/null | head -n1 || true)"
if [ -z "$LATEST_DUMP" ]; then
  echo "restore-drill.sh: у $BACKUP_DIR немає жодного дампу. Спочатку запусти scripts/backup.sh." >&2
  exit 1
fi
DUMP_SIZE_BYTES=$(wc -c < "$LATEST_DUMP" | tr -d ' ')
echo "Останній дамп: $LATEST_DUMP (${DUMP_SIZE_BYTES} bytes)"

CHECKSUM_FILE="${LATEST_DUMP}.checksum"
if [ ! -f "$CHECKSUM_FILE" ]; then
  echo "restore-drill.sh: не знайдено $CHECKSUM_FILE. Цей дамп зроблено старою версією backup.sh — перестворіть дамп." >&2
  exit 1
fi
BEFORE_CHECKSUM="$(cat "$CHECKSUM_FILE")"
echo "BEFORE (checksum, збережений у момент backup.sh): $BEFORE_CHECKSUM"

CHECKSUM_SQL="SELECT count(*) || '|' || COALESCE(sum(\"priceCents\"), 0) FROM products;"

DRILL_CONTAINER="restore-drill-$(date +%s)-$$"
cleanup() {
  docker stop "$DRILL_CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Піднімаємо чистий контейнер (порожній volume): $DRILL_CONTAINER"
RTO_START=$(date +%s)

docker run -d --rm \
  --name "$DRILL_CONTAINER" \
  -e POSTGRES_USER="$DB_URL_USER" \
  -e POSTGRES_PASSWORD="$DB_URL_PASS" \
  -e POSTGRES_DB="$DB_URL_NAME" \
  postgres:16-alpine >/dev/null

for _ in $(seq 1 30); do
  if docker exec "$DRILL_CONTAINER" pg_isready -U "$DB_URL_USER" -d "$DB_URL_NAME" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

docker exec -i "$DRILL_CONTAINER" \
  pg_restore --no-owner --no-privileges -U "$DB_URL_USER" -d "$DB_URL_NAME" < "$LATEST_DUMP"

RTO_END=$(date +%s)
RTO_SECONDS=$((RTO_END - RTO_START))
echo "RTO (підняти чистий Postgres + відновити дамп): ${RTO_SECONDS}s"

AFTER_CHECKSUM="$(docker exec "$DRILL_CONTAINER" \
  psql -U "$DB_URL_USER" -d "$DB_URL_NAME" -tAc "$CHECKSUM_SQL" | tr -d '[:space:]')"
echo "AFTER (щойно відновлений чистий контейнер): $AFTER_CHECKSUM"

if [ "$BEFORE_CHECKSUM" = "$AFTER_CHECKSUM" ]; then
  echo "MATCH ($BEFORE_CHECKSUM)"
  exit 0
else
  echo "MISMATCH: before=$BEFORE_CHECKSUM after=$AFTER_CHECKSUM"
  exit 1
fi
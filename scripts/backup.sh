#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/lib/parse-database-url.sh"
cd "$ROOT"

BACKUP_DIR="$ROOT/backups"
mkdir -p "$BACKUP_DIR"

TS="$(date -u +%Y%m%d_%H%M%S)"
OUT_FILE="$BACKUP_DIR/marketplace_${TS}.dump"
TMP_FILE="${OUT_FILE}.tmp"
CHECKSUM_FILE="${OUT_FILE}.checksum"

CHECKSUM_SQL="SELECT count(*) || '|' || COALESCE(sum(\"priceCents\"), 0) FROM products;"

CHECKSUM="$(docker compose exec -T -e PGPASSWORD="$DB_URL_PASS" postgres \
  psql -h postgres -p 5432 -U "$DB_URL_USER" -d "$DB_URL_NAME" -tAc "$CHECKSUM_SQL" | tr -d '[:space:]')"

docker compose exec -T \
  -e PGPASSWORD="$DB_URL_PASS" \
  postgres \
  pg_dump -Fc --no-owner -h postgres -p 5432 -U "$DB_URL_USER" -d "$DB_URL_NAME" \
  > "$TMP_FILE"

mv "$TMP_FILE" "$OUT_FILE"
echo -n "$CHECKSUM" > "$CHECKSUM_FILE"

SIZE_BYTES=$(wc -c < "$OUT_FILE" | tr -d ' ')
echo "Backup created: $OUT_FILE (${SIZE_BYTES} bytes)"
echo "Checksum at backup time: $CHECKSUM -> $CHECKSUM_FILE"

echo "--- pg_restore --list (доказ валідного -Fc архіву) ---"
docker run --rm -i postgres:16-alpine pg_restore --list < "$OUT_FILE"
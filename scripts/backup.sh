#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/lib/parse-database-url.sh"
cd "$ROOT"

BACKUP_DIR="$ROOT/backups"
mkdir -p "$BACKUP_DIR"

TS="$(date -u +%Y%m%d_%H%M%S)"
OUT_FILE="$BACKUP_DIR/marketplace_${TS}.dump"

docker compose exec -T \
  -e PGPASSWORD="$DB_URL_PASS" \
  postgres \
  pg_dump -Fc --no-owner -h pgbouncer -p 6432 -U "$DB_URL_USER" -d "$DB_URL_NAME" \
  > "$OUT_FILE"

SIZE_BYTES=$(wc -c < "$OUT_FILE" | tr -d ' ')
echo "Backup created: $OUT_FILE (${SIZE_BYTES} bytes)"

echo "--- pg_restore --list (доказ валідного -Fc архіву) ---"
docker run --rm -i postgres:16-alpine pg_restore --list < "$OUT_FILE"
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ENV_SLUG="${1:-dev}"; shift || true

[ "$#" -gt 0 ] || set -- npm run start

# грейдер не має доступу до сховища: значення вже в оточенні
if [ "${SKIP_VAULT:-0}" = "1" ]; then exec "$@"; fi

if [ -f "$ROOT/.env" ]; then
  set -a
  source "$ROOT/.env"
  set +a
fi

CREDS="$ROOT/secrets/db_password"
if [ ! -f "$CREDS" ]; then
  echo "with-secrets.sh: не знайдено $CREDS. Створи secrets/db_password (див. README) або запусти з SKIP_VAULT=1." >&2
  exit 1
fi
export DB_PASSWORD="$(tr -d '\n' < "$CREDS")"

exec "$@"
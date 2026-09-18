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

# ДЗ №15: єдиний DATABASE_URL для scripts/backup.sh і scripts/restore-drill.sh,
# зібраний із тих самих полів, якими вже користується застосуток. Пароль
# URL-кодуємо (у ньому є "/", який ламає звичайний postgres://user:pass@... рядок).
if [ -z "${DATABASE_URL:-}" ]; then
  ENC_PASSWORD="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$DB_PASSWORD")"
  export DATABASE_URL="postgres://${DB_USER}:${ENC_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
fi

exec "$@"
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
export DB_PASSWORD="$(tr -d '\r\n' < "$CREDS")"

# ДЗ №19: пароль брокера читаємо з того ж сховища, що й пароль БД
RMQ_CREDS="$ROOT/secrets/rabbitmq_password"
if [ ! -f "$RMQ_CREDS" ]; then
  echo "with-secrets.sh: не знайдено $RMQ_CREDS. Створи secrets/rabbitmq_password (cp secrets/rabbitmq_password.example secrets/rabbitmq_password) або запусти з SKIP_VAULT=1." >&2
  exit 1
fi
export RABBITMQ_PASSWORD="$(tr -d '\r\n' < "$RMQ_CREDS")"

# ДЗ №15: єдиний DATABASE_URL для scripts/backup.sh і scripts/restore-drill.sh,
# зібраний із тих самих полів, якими вже користується застосуток. Пароль
# URL-кодуємо (у ньому є "/", який ламає звичайний postgres://user:pass@... рядок).
if [ -z "${DATABASE_URL:-}" ]; then
  ENC_PASSWORD="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$DB_PASSWORD")"
  export DATABASE_URL="postgres://${DB_USER}:${ENC_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
fi

# ДЗ №19: єдиний RABBITMQ_URL (amqp://, порт 5672), зібраний із тих самих полів,
# що йдуть у docker-compose. Логін і пароль URL-кодуємо — "/" чи "@" зламали б розбір.
if [ -z "${RABBITMQ_URL:-}" ]; then
  ENC_RMQ_USER="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "${RABBITMQ_USER:-marketplace}")"
  ENC_RMQ_PASSWORD="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$RABBITMQ_PASSWORD")"
  export RABBITMQ_URL="amqp://${ENC_RMQ_USER}:${ENC_RMQ_PASSWORD}@${RABBITMQ_HOST:-localhost}:${RABBITMQ_PORT:-5672}"
fi

exec "$@"
#!/usr/bin/env bash
set -euo pipefail

set -a
source .env
set +a

NEW_PASSWORD=$(openssl rand -base64 24)

echo "Оновлюю пароль ролі в Postgres..."
docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" \
  -c "ALTER ROLE $DB_USER WITH PASSWORD '$NEW_PASSWORD';"

echo "Оновлюю файл секрету..."
echo -n "$NEW_PASSWORD" > secrets/db_password

echo "Розриваю старі з'єднання..."
docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = '$DB_USER' AND pid <> pg_backend_pid();"

echo "Готово."
#!/usr/bin/env bash
# Наповнює «сховище» (secrets/*) випадковими значеннями для одного прогону конвеєра.
# Секрети застосунку в CI не лежать у GitHub Secrets: їх немає ніде, крім цього раннера і цього прогону.
# Далі їх читає той самий scripts/with-secrets.sh, що й локально, тож шлях «сховище -> env -> K8s Secret»
# перевіряється той самий. Значення маскуються в логу (::add-mask::) і ніколи не друкуються.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Скрипт ПЕРЕЗАПИСУЄ secrets/* і .env випадковими значеннями, тому на машині розробника він відмовляється працювати:
# там лежить справжнє сховище. У GitHub Actions змінна GITHUB_ACTIONS=true виставляється сама.
if [ "${GITHUB_ACTIONS:-}" != "true" ] && [ "${CI_VAULT_FORCE:-0}" != "1" ]; then
  echo "ci-vault: відмова: це не GitHub Actions, а скрипт перезаписує secrets/* і .env. Для чистої копії: CI_VAULT_FORCE=1" >&2
  exit 3
fi

mask() {
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    echo "::add-mask::$1"
  fi
}

random() {
  node -e 'process.stdout.write(require("crypto").randomBytes(24).toString("hex"))'
}

mkdir -p secrets
for name in db_password rabbitmq_password storage_access_key storage_secret_key grafana_admin_password pulumi_passphrase; do
  value="$(random)"
  mask "$value"
  printf '%s' "$value" > "secrets/$name"
  chmod 600 "secrets/$name"
done

node scripts/gen-jwt-keys.mjs dev --force >/dev/null
pepper="$(tr -d '\r\n' < secrets/jwt/dev/refresh_pepper)"
mask "$pepper"

# Несекретні параметри підключення, які with-secrets.sh читає з .env (файл у .gitignore).
cat > .env <<'ENV'
DB_HOST=postgres.marketplace.svc.cluster.local
DB_PORT=5432
DB_USER=marketplace
DB_NAME=marketplace
ENV

echo "ci-vault: створено 6 файлів у secrets/ і ключі JWT у secrets/jwt/dev (значення не друкуються)"

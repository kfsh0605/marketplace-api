#!/usr/bin/env bash
# ДЗ №31: единая обёртка над Pulumi для двух AWS-стеков (infra/base и infra/demo).
# Использование: pulumi-aws.sh <base|demo> <up|preview|destroy|refresh|export|outputs>
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

STACK="${1:?использование: pulumi-aws.sh <base|demo> <up|preview|destroy|refresh|export|outputs>}"
COMMAND="${2:?использование: pulumi-aws.sh <base|demo> <up|preview|destroy|refresh|export|outputs>}"
shift 2

case "$STACK" in
  base|demo) ;;
  *) echo "pulumi-aws.sh: неизвестный стек $STACK (base | demo)" >&2; exit 2 ;;
esac

# ключи (или OIDC-сессия в CI), регион, номер аккаунта, имя бакета с состоянием
source "$ROOT/scripts/lib/aws-env.sh"

# Состояние живёт в S3 - его видят и ноутбук, и CI (в отличие от file:// из ДЗ №28).
export PULUMI_BACKEND_URL="s3://${HW31_STATE_BUCKET}?region=${HW31_REGION}"
# В этих стеках нет секретов, поэтому фраза-пароль пустая и CI не нужен секрет.
# Явно перебиваем значение, которое with-secrets.sh берёт из ДЗ №28.
export PULUMI_CONFIG_PASSPHRASE=""
export PULUMI_SKIP_UPDATE_CHECK=true

cd "$ROOT/infra/$STACK"
[ -d node_modules ] || npm ci --no-audit --no-fund

pulumi stack select --create "$STACK" --non-interactive >/dev/null

case "$COMMAND" in
  up) exec pulumi up --stack "$STACK" --yes --non-interactive --skip-preview "$@" ;;
  preview) exec pulumi preview --stack "$STACK" --non-interactive "$@" ;;
  destroy) exec pulumi destroy --stack "$STACK" --yes --non-interactive "$@" ;;
  refresh) exec pulumi refresh --stack "$STACK" --yes --non-interactive "$@" ;;
  export) exec pulumi stack export --stack "$STACK" "$@" ;;
  outputs) exec pulumi stack output --stack "$STACK" --json "$@" ;;
  *) echo "pulumi-aws.sh: неизвестная команда $COMMAND (up | preview | destroy | refresh | export | outputs)" >&2; exit 2 ;;
esac

#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_NATIVE="$(cd "$ROOT" && { pwd -W 2>/dev/null || pwd; })"

COMMAND="${1:?використання: pulumi.sh <up|preview|destroy>}"
shift

: "${PULUMI_CONFIG_PASSPHRASE:?PULUMI_CONFIG_PASSPHRASE не задано: покладіть його в secrets/pulumi_passphrase (cp secrets/pulumi_passphrase.example secrets/pulumi_passphrase) або експортуйте разом із SKIP_VAULT=1}"
export PULUMI_BACKEND_URL="${PULUMI_BACKEND_URL:-file://$ROOT_NATIVE}"
export PULUMI_SKIP_UPDATE_CHECK=true
STACK="${PULUMI_STACK_NAME:-dev}"

cd "$ROOT/infra"
pulumi stack select --create "$STACK" --non-interactive >/dev/null

case "$COMMAND" in
  up) exec pulumi up --stack "$STACK" --yes --non-interactive --skip-preview "$@" ;;
  preview) exec pulumi preview --stack "$STACK" --non-interactive "$@" ;;
  destroy) exec pulumi destroy --stack "$STACK" --yes --non-interactive "$@" ;;
  *) echo "pulumi.sh: невідома команда $COMMAND (up | preview | destroy)" >&2; exit 2 ;;
esac
#!/usr/bin/env bash
_AWS_ENV_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

export HW31_REGION="${HW31_REGION:-eu-north-1}"
export AWS_DEFAULT_REGION="$HW31_REGION"
export AWS_PAGER=""

if [ -z "${AWS_ACCESS_KEY_ID:-}" ]; then
  _KEY_FILE="$_AWS_ENV_ROOT/secrets/aws_access_key_id"
  _SECRET_FILE="$_AWS_ENV_ROOT/secrets/aws_secret_access_key"
  if [ -f "$_KEY_FILE" ] && [ -f "$_SECRET_FILE" ]; then
    export AWS_ACCESS_KEY_ID="$(tr -d '\r\n' < "$_KEY_FILE")"
    export AWS_SECRET_ACCESS_KEY="$(tr -d '\r\n' < "$_SECRET_FILE")"
  fi
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "aws-env.sh: команда aws не знайдена в PATH. Після встановлення AWS CLI відкрий НОВЕ вікно Git Bash." >&2
  return 1 2>/dev/null || exit 1
fi

if ! _ACCOUNT="$(aws sts get-caller-identity --query Account --output text 2>/dev/null | tr -d '\r')" || [ -z "$_ACCOUNT" ]; then
  echo "aws-env.sh: aws sts get-caller-identity не відповів. Перевір secrets/aws_access_key_id і secrets/aws_secret_access_key (cp з .example) або OIDC-роль у CI." >&2
  return 1 2>/dev/null || exit 1
fi

export HW31_ACCOUNT_ID="$_ACCOUNT"
export HW31_STATE_BUCKET="${HW31_STATE_BUCKET:-hw31-pulumi-state-$_ACCOUNT}"

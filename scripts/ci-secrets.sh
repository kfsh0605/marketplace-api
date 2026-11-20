#!/usr/bin/env bash
# ДЗ №31: Environment "teardown" в GitHub и ключ пользователя hw31-ci в его секретах.
# Использование: ci-secrets.sh <env|create|delete>
#   env    - создать Environment teardown и разрешить в нём только ветки main и hw-31
#   create - создать ключ hw31-ci и сразу положить в секреты CI_KEY_ID и CI_KEY_SECRET этого Environment
#   delete - удалить все ключи hw31-ci и оба секрета (после сдачи ДЗ)
# Ключ нигде не печатается, не пишется в файл и не создаётся через Pulumi (иначе он попал бы в состояние).
set -euo pipefail
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:?использование: ci-secrets.sh <env|create|delete>}"

GH_REPO="${GH_REPO:-kfsh0605/marketplace-api}"
ENVIRONMENT=teardown
IAM_USER=hw31-ci

command -v gh >/dev/null 2>&1 || { echo "ci-secrets.sh: нет команды gh (откройте НОВОЕ окно Git Bash)" >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "ci-secrets.sh: gh не авторизован, выполните: gh auth login" >&2; exit 1; }

case "$MODE" in
  env)
    gh api -X PUT "repos/$GH_REPO/environments/$ENVIRONMENT" --input - >/dev/null <<'JSON'
{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
JSON
    EXISTING="$(gh api "repos/$GH_REPO/environments/$ENVIRONMENT/deployment-branch-policies" --jq '.branch_policies[].name' | tr -d '\r')"
    for BRANCH in main hw-31; do
      if ! printf '%s\n' "$EXISTING" | grep -qx "$BRANCH"; then
        gh api -X POST "repos/$GH_REPO/environments/$ENVIRONMENT/deployment-branch-policies" -f name="$BRANCH" -f type=branch >/dev/null
      fi
    done
    echo "environment=$ENVIRONMENT"
    echo "environment-branches=$(gh api "repos/$GH_REPO/environments/$ENVIRONMENT/deployment-branch-policies" --jq '[.branch_policies[].name] | sort | join(",")' | tr -d '\r')"
    ;;

  create)
    source "$ROOT/scripts/lib/aws-env.sh"
    COUNT="$(aws iam list-access-keys --user-name "$IAM_USER" --query 'length(AccessKeyMetadata)' --output text | tr -d '\r')"
    if [ "$COUNT" != "0" ]; then
      echo "ci-secrets.sh: у $IAM_USER уже есть ключ(и): $COUNT. Сначала: npm run ci:key:delete" >&2
      exit 1
    fi
    KEY="$(aws iam create-access-key --user-name "$IAM_USER" --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text | tr -d '\r')"
    ID="${KEY%%$'\t'*}"
    SECRET="${KEY#*$'\t'}"
    if ! { printf %s "$ID" | gh secret set CI_KEY_ID --env "$ENVIRONMENT" --repo "$GH_REPO" >/dev/null \
        && printf %s "$SECRET" | gh secret set CI_KEY_SECRET --env "$ENVIRONMENT" --repo "$GH_REPO" >/dev/null; }; then
      aws iam delete-access-key --user-name "$IAM_USER" --access-key-id "$ID" >/dev/null
      unset KEY ID SECRET
      echo "ci-secrets.sh: не удалось записать секреты, новый ключ удалён. Проверьте Environment: npm run ci:env" >&2
      exit 1
    fi
    unset KEY ID SECRET
    echo "ci-key-created=1"
    echo "secrets=$(gh secret list --env "$ENVIRONMENT" --repo "$GH_REPO" --json name --jq '[.[].name] | sort | join(",")' | tr -d '\r')"
    ;;

  delete)
    source "$ROOT/scripts/lib/aws-env.sh"
    for KEY_ID in $(aws iam list-access-keys --user-name "$IAM_USER" --query 'AccessKeyMetadata[].AccessKeyId' --output text | tr -d '\r'); do
      aws iam delete-access-key --user-name "$IAM_USER" --access-key-id "$KEY_ID"
    done
    gh secret delete CI_KEY_ID --env "$ENVIRONMENT" --repo "$GH_REPO" 2>/dev/null || true
    gh secret delete CI_KEY_SECRET --env "$ENVIRONMENT" --repo "$GH_REPO" 2>/dev/null || true
    echo "ci-key-deleted=1"
    ;;

  *) echo "ci-secrets.sh: неизвестный режим $MODE (env | create | delete)" >&2; exit 2 ;;
esac

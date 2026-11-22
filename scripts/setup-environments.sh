#!/usr/bin/env bash
# Створює середовища GitHub для конвеєра: staging (PR-прогони) і prod (лише гілка main, для deploy.yml).
# Потрібні gh і право адміністратора репозиторію. Повторний запуск безпечний.
#   bash scripts/setup-environments.sh [owner/repo]
set -euo pipefail

REPO="${1:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"

gh api -X PUT "repos/${REPO}/environments/staging" >/dev/null
echo "environment=staging repo=${REPO}"

gh api -X PUT "repos/${REPO}/environments/prod" \
  -H "Accept: application/vnd.github+json" \
  --input - >/dev/null <<'JSON'
{ "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true } }
JSON

existing="$(gh api "repos/${REPO}/environments/prod/deployment-branch-policies" --jq '[.branch_policies[].name] | index("main")')"
if [ "$existing" = "null" ]; then
  gh api -X POST "repos/${REPO}/environments/prod/deployment-branch-policies" -f name=main -f type=branch >/dev/null
fi
echo "environment=prod repo=${REPO} branches=main"

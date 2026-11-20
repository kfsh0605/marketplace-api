#!/usr/bin/env bash
# ДЗ №31: собирает evidence/iam.json (роль CI и пользователь hw31-ci: доверие и права, расшифрованные)
# и evidence/iam.txt (негативный тест: что можно, а что нельзя; плюс доказательство про SCP).
set -euo pipefail
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/lib/aws-env.sh"

OUT="$ROOT/evidence"
mkdir -p "$OUT"
ROLE=hw31-ci-teardown
ROLE_POLICY=teardown
USER_NAME=hw31-ci
USER_POLICY=assume-ci-role

ROLE_ARN="$(aws iam get-role --role-name "$ROLE" --query Role.Arn --output text | tr -d '\r')"
USER_ARN="$(aws iam get-user --user-name "$USER_NAME" --query User.Arn --output text | tr -d '\r')"

# aws cli сам расшифровывает URL-кодированные документы в обычный JSON
TRUST="$(aws iam get-role --role-name "$ROLE" --query Role.AssumeRolePolicyDocument --output json | tr -d '\r')"
PERMS="$(aws iam get-role-policy --role-name "$ROLE" --policy-name "$ROLE_POLICY" --query PolicyDocument --output json | tr -d '\r')"
UPERMS="$(aws iam get-user-policy --user-name "$USER_NAME" --policy-name "$USER_POLICY" --query PolicyDocument --output json | tr -d '\r')"
KEYS="$(aws iam list-access-keys --user-name "$USER_NAME" --query 'length(AccessKeyMetadata)' --output text | tr -d '\r')"

ROLE_ARN="$ROLE_ARN" USER_ARN="$USER_ARN" TRUST="$TRUST" PERMS="$PERMS" UPERMS="$UPERMS" node -e '
const e = process.env;
const doc = {
  roleArn: e.ROLE_ARN,
  trustPolicy: JSON.parse(e.TRUST),
  permissionsPolicy: JSON.parse(e.PERMS),
  ciUser: { arn: e.USER_ARN, permissionsPolicy: JSON.parse(e.UPERMS) },
};
process.stdout.write(JSON.stringify(doc, null, 2) + "\n");
' > "$OUT/iam.json"

# Негативный тест: симулятор прогоняет политики и отвечает allowed / implicitDeny.
# Для роли регион передаём как контекст: без него условие aws:RequestedRegion не сработало бы.
sim_role() { # <действие> <регион>
  aws iam simulate-principal-policy --policy-source-arn "$ROLE_ARN" --action-names "$1" \
    --resource-arns '*' \
    --context-entries "ContextKeyName=aws:RequestedRegion,ContextKeyValues=$2,ContextKeyType=string" \
    --query 'EvaluationResults[0].EvalDecision' --output text | tr -d '\r'
}
sim_user() { # <действие> <ресурс>
  aws iam simulate-principal-policy --policy-source-arn "$USER_ARN" --action-names "$1" \
    --resource-arns "$2" --query 'EvaluationResults[0].EvalDecision' --output text | tr -d '\r'
}

WILDCARDS="$(PERMS="$PERMS" node -e '
const p = JSON.parse(process.env.PERMS);
const acts = p.Statement.flatMap((s) => [].concat(s.Action));
process.stdout.write(String(acts.filter((a) => a.includes("*")).length));
')"
USER_ACTIONS="$(UPERMS="$UPERMS" node -e '
const p = JSON.parse(process.env.UPERMS);
const acts = p.Statement.flatMap((s) => [].concat(s.Action));
process.stdout.write(acts.sort().join(","));
')"
# Подтверждение, что провайдеров OIDC на этом аккаунте создать нельзя именно из-за SCP
SCP_DENY="$(aws iam list-open-id-connect-providers 2>&1 | grep -c 'explicit deny in a service control policy' || true)"

{
  echo "role=$ROLE_ARN"
  echo "ci-user=$USER_ARN"
  echo "ci-user-actions=$USER_ACTIONS"
  echo "ci-user-access-keys=$KEYS"
  echo "action-wildcards=$WILDCARDS"
  echo "sim-allowed=$(sim_role rds:DescribeDBInstances eu-north-1)"
  echo "sim-denied=$(sim_role rds:CreateDBInstance eu-north-1)"
  echo "sim-denied-iam=$(sim_role iam:CreateAccessKey eu-north-1)"
  echo "sim-denied-region=$(sim_role rds:DescribeDBInstances eu-west-1)"
  echo "sim-user-assume-role=$(sim_user sts:AssumeRole "$ROLE_ARN")"
  echo "sim-user-denied=$(sim_user rds:DescribeDBInstances '*')"
  echo "scp-deny-oidc=$SCP_DENY"
} | tee "$OUT/iam.txt"

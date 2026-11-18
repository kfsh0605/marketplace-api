#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/lib/aws-env.sh"

BUCKET="$HW31_STATE_BUCKET"
REGION="$HW31_REGION"

if aws s3api head-bucket --bucket "$BUCKET" --region "$REGION" >/dev/null 2>&1; then
  echo "state-bucket-exists=$BUCKET"
else
  aws s3api create-bucket \
    --bucket "$BUCKET" \
    --region "$REGION" \
    --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
  echo "state-bucket-created=$BUCKET"
fi

aws s3api put-public-access-block \
  --bucket "$BUCKET" \
  --region "$REGION" \
  --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

PUBLIC_BLOCK="$(aws s3api get-public-access-block --bucket "$BUCKET" --region "$REGION" \
  --query 'PublicAccessBlockConfiguration.[BlockPublicAcls,IgnorePublicAcls,BlockPublicPolicy,RestrictPublicBuckets]' \
  --output text | tr -d '\r' | tr '\t' ',')"

echo "aws-account=$HW31_ACCOUNT_ID"
echo "state-bucket=$BUCKET"
echo "state-bucket-region=$REGION"
echo "state-bucket-public-block=$PUBLIC_BLOCK"

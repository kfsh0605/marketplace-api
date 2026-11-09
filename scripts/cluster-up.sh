#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CLUSTER="${KIND_CLUSTER:-hw28}"
IMAGE="${IMAGE:-marketplace-api:hw28}"

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "cluster-up: образу $IMAGE немає на хості. Спершу: npm run image:build" >&2
  exit 1
fi

if kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
  echo "cluster-up: кластер $CLUSTER уже існує, створення пропущено"
else
  kind create cluster --name "$CLUSTER" --config k8s/kind-config.yaml --wait 120s
fi

kind load docker-image "$IMAGE" --name "$CLUSTER"
kubectl --context "kind-$CLUSTER" wait --for=condition=Ready node --all --timeout=120s
echo "cluster-up: готово, контекст kind-$CLUSTER, образ $IMAGE завантажено у вузол"
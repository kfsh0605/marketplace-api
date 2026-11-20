#!/usr/bin/env bash
# ДЗ №31: собирает ставки для таблицы в README из официального API цен AWS (регион eu-north-1)
# и записывает их вместе с датой публикации прайс-листа в evidence/prices.txt.
# Ставки протухают, поэтому у каждой строки есть дата, которую видел сам студент.
set -euo pipefail
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/lib/aws-env.sh"
mkdir -p "$ROOT/evidence"
REGION=eu-north-1

fetch() { # <код сервиса> <метка> <фильтры Type=TERM_MATCH,Field=...,Value=...>
  local service="$1" label="$2"; shift 2
  local args=()
  for f in "$@"; do args+=(--filters "$f"); done
  aws pricing get-products --region us-east-1 --service-code "$service" "${args[@]}" --max-results 50 --output json \
    | tr -d '\r' \
    | LABEL="$label" node -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const list = JSON.parse(s).PriceList || [];
  if (list.length === 0) console.log(process.env.LABEL + " | (нет совпадений)");
  for (const raw of list) {
    const p = JSON.parse(raw);
    const a = p.product.attributes;
    for (const term of Object.values((p.terms && p.terms.OnDemand) || {})) {
      for (const d of Object.values(term.priceDimensions)) {
        console.log([
          process.env.LABEL,
          a.usagetype || "",
          a.instanceType || a.volumeType || a.group || "",
          d.pricePerUnit.USD + " USD / " + d.unit,
          d.description.slice(0, 100),
          "прайс-лист от " + p.publicationDate,
        ].join(" | "));
      }
    }
  }
});'
}

{
  echo "# Ставки AWS, регион $REGION, собраны $(date -u +%Y-%m-%dT%H:%MZ) через aws pricing get-products"
  fetch AWSELB "ALB" "Type=TERM_MATCH,Field=regionCode,Value=$REGION" "Type=TERM_MATCH,Field=productFamily,Value=Load Balancer-Application"
  fetch AmazonRDS "RDS Multi-AZ db.t4g.micro PostgreSQL" "Type=TERM_MATCH,Field=regionCode,Value=$REGION" "Type=TERM_MATCH,Field=instanceType,Value=db.t4g.micro" "Type=TERM_MATCH,Field=databaseEngine,Value=PostgreSQL" "Type=TERM_MATCH,Field=deploymentOption,Value=Multi-AZ"
  fetch AmazonRDS "RDS хранилище Multi-AZ" "Type=TERM_MATCH,Field=regionCode,Value=$REGION" "Type=TERM_MATCH,Field=productFamily,Value=Database Storage" "Type=TERM_MATCH,Field=databaseEngine,Value=PostgreSQL" "Type=TERM_MATCH,Field=deploymentOption,Value=Multi-AZ"
  fetch AmazonEC2 "NAT" "Type=TERM_MATCH,Field=regionCode,Value=$REGION" "Type=TERM_MATCH,Field=productFamily,Value=NAT Gateway"
  fetch AmazonVPC "Public IPv4 (используется)" "Type=TERM_MATCH,Field=regionCode,Value=$REGION" "Type=TERM_MATCH,Field=usagetype,Value=EUN1-PublicIPv4:InUseAddress"
  fetch AmazonVPC "Public IPv4 (простаивает)" "Type=TERM_MATCH,Field=regionCode,Value=$REGION" "Type=TERM_MATCH,Field=usagetype,Value=EUN1-PublicIPv4:IdleAddress"
} | tee "$ROOT/evidence/prices.txt"

#!/usr/bin/env bash
# Пини дій у .github: кожне `uses: owner/repo@<40 hex> # <тег>` має вказувати саме на коміт цього тега.
#   bash scripts/pin-actions.sh check                  перевірка всіх пинів (код 1, якщо є невалідний або непінений)
#   bash scripts/pin-actions.sh resolve owner/repo vX  друкує SHA тега, щоб вписати новий пин
# Працює через git ls-remote: без токенів і без gh. Локальні дії (./...) пинів не потребують.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

resolve() {
  local repo="$1" tag="$2" out sha
  out="$(git ls-remote "https://github.com/${repo}" "refs/tags/${tag}" "refs/tags/${tag}^{}")"
  sha="$(awk '/\^\{\}$/{print $1}' <<<"$out")"
  [ -n "$sha" ] || sha="$(awk 'NR==1{print $1}' <<<"$out")"
  if [ -z "$sha" ]; then
    echo "pin-actions: тег ${tag} не знайдено в ${repo}" >&2
    return 1
  fi
  printf '%s\n' "$sha"
}

check() {
  local total=0 bad=0 file lineno text spec ref repo sha tag expected
  declare -A cache=()
  while IFS=: read -r file lineno text; do
    text="$(tr -d '\r' <<<"$text")"
    spec="$(sed -E 's/^[[:space:]-]*uses:[[:space:]]*//' <<<"$text")"
    ref="${spec%% *}"
    case "$ref" in ./*) continue ;; esac
    total=$((total + 1))
    if ! [[ "$ref" =~ ^([^@]+)@([0-9a-f]{40})$ ]]; then
      echo "pin-bad ${file}:${lineno} ${ref} не пінений за SHA (40 hex)"
      bad=$((bad + 1))
      continue
    fi
    repo="$(cut -d/ -f1,2 <<<"${BASH_REMATCH[1]}")"
    sha="${BASH_REMATCH[2]}"
    tag="$(sed -nE 's/.*#[[:space:]]*([^[:space:]]+).*/\1/p' <<<"$spec")"
    if [ -z "$tag" ]; then
      echo "pin-bad ${file}:${lineno} ${ref} немає коментаря з тегом"
      bad=$((bad + 1))
      continue
    fi
    if [ -z "${cache[$repo@$tag]:-}" ]; then
      cache[$repo@$tag]="$(resolve "$repo" "$tag" || true)"
    fi
    expected="${cache[$repo@$tag]}"
    if [ "$expected" != "$sha" ]; then
      echo "pin-bad ${file}:${lineno} ${repo}@${tag}: у файлі ${sha}, у реєстрі тега ${expected:-<не знайдено>}"
      bad=$((bad + 1))
    else
      echo "pin-ok ${file}:${lineno} ${repo}@${sha:0:12} # ${tag}"
    fi
  done < <(grep -rnE '^[[:space:]-]*uses:' .github || true)
  echo "pinned=$((total - bad))"
  echo "unpinned-or-wrong=${bad}"
  [ "$bad" -eq 0 ]
}

case "${1:-check}" in
  check) check ;;
  resolve) resolve "${2:?owner/repo}" "${3:?tag}" ;;
  *) echo "використання: pin-actions.sh check | resolve owner/repo tag" >&2; exit 2 ;;
esac

#!/usr/bin/env bash
: "${DATABASE_URL:?DATABASE_URL: unbound variable}"

DB_URL_PARSED="$(node -e 'const u = new URL(process.env.DATABASE_URL); process.stdout.write([decodeURIComponent(u.username), decodeURIComponent(u.password), u.hostname, u.port || "5432", decodeURIComponent(u.pathname.slice(1))].join("\t"));')"

IFS=$'\t' read -r DB_URL_USER DB_URL_PASS DB_URL_HOST DB_URL_PORT DB_URL_NAME <<< "$DB_URL_PARSED"

export DB_URL_USER DB_URL_PASS DB_URL_HOST DB_URL_PORT DB_URL_NAME
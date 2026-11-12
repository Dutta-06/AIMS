#!/bin/sh
# Container start: refuse to run in an unsafe setup, bring the database up to date, start the server.
set -eu

fail() {
  echo "The backend was NOT started: $1" >&2
  exit 1
}

# This backend is reachable from the internet, so it must say who may use it, and Google must be set
# up or nobody could sign in.
[ -n "${ALLOWED_EMAILS:-}" ] || fail "ALLOWED_EMAILS is empty. List the Google accounts that may sign in."
[ -n "${GOOGLE_CLIENT_ID:-}" ] && [ -n "${GOOGLE_CLIENT_SECRET:-}" ] \
  || fail "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are empty, so nobody could sign in (see docs/GMAIL_SETUP.md)."

[ -n "${SESSION_SECRET:-}" ] \
  || echo "Note: SESSION_SECRET is empty, so everyone is signed out whenever the backend restarts." >&2
case "${DATABASE_URL:-}" in
  postgres://* | postgresql://*) ;;
  *) echo "Note: DATABASE_URL is not PostgreSQL; use the compose file's database for real use." >&2 ;;
esac

alembic upgrade head

# Behind Caddy (the only thing that can reach this port): trust its forwarding headers.
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'

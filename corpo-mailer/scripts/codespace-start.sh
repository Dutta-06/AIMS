#!/usr/bin/env bash
# Starts the Corpo Mailer backend inside a GitHub Codespace and prints the addresses you need.
# It runs automatically when the Codespace starts (see .devcontainer/corpo-mailer/devcontainer.json);
# run it by hand with:  bash corpo-mailer/scripts/codespace-start.sh
set -euo pipefail

cd "$(dirname "$0")/../backend"

# A Codespace backend can be reached from the internet, so it must have a password.
if [ -z "${APP_PASSWORD:-}" ]; then
  cat <<'MSG'

  The backend was NOT started: no team password is set.

  Add a Codespaces secret named APP_PASSWORD (GitHub > Settings > Codespaces > Secrets, give it
  access to this repository), then restart the Codespace or run this script again.

MSG
  exit 1
fi

DOMAIN="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
OWNER="$(printf '%s' "${GITHUB_REPOSITORY_OWNER:-}" | tr '[:upper:]' '[:lower:]')"
if [ -n "${CODESPACE_NAME:-}" ]; then
  BACKEND="https://${CODESPACE_NAME}-8000.${DOMAIN}"
  FRONTEND_DEV="https://${CODESPACE_NAME}-3000.${DOMAIN}"
else
  BACKEND="http://localhost:8000"
  FRONTEND_DEV="http://localhost:3000"
fi
PAGES="https://${OWNER:-your-username}.github.io"

# Where Google sends the browser after "Connect Gmail", and which websites may call this backend.
export GOOGLE_REDIRECT_URI="${GOOGLE_REDIRECT_URI:-${BACKEND}/api/v1/gmail/callback}"
export CORS_ORIGINS="${CORS_ORIGINS:-[\"${PAGES}\",\"${FRONTEND_DEV}\"]}"

uv sync --quiet
uv run alembic upgrade head >/tmp/corpo-migrate.log 2>&1 || { echo "Database setup failed; see /tmp/corpo-migrate.log"; exit 1; }

if pgrep -f "uvicorn app.main:app" >/dev/null; then
  echo "The backend is already running."
else
  # 127.0.0.1 is fine: Codespaces forwards the port from inside the machine.
  nohup uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 >/tmp/corpo-backend.log 2>&1 &
  sleep 3
fi

# Making the port public lets the Pages website reach it. Needs a token that may do that; if it
# can't, the message below says how to do it by hand.
if [ -n "${CODESPACE_NAME:-}" ] && command -v gh >/dev/null 2>&1; then
  gh codespace ports visibility 8000:public -c "$CODESPACE_NAME" >/dev/null 2>&1 || true
fi

cat <<MSG

  Corpo Mailer backend is running.

  Backend address (type this on the sign-in page of the website):
      ${BACKEND}

  Website (GitHub Pages):  ${PAGES}/$(basename "${GITHUB_REPOSITORY:-AIMS}")/

  Google redirect address (add this in the Google Cloud console):
      ${GOOGLE_REDIRECT_URI}

  Port 8000 must be Public for the website to reach it:
      Ports tab > right-click 8000 > Port Visibility > Public

MSG

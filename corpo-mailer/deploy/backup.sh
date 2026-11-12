#!/usr/bin/env bash
# Saves a compressed copy of the database into deploy/backups/ and keeps the newest 14.
# Run it by hand, or daily from cron (see docs/legacy-server/DEPLOY.md). The backups contain your leads and the
# Gmail connection, so they are kept private (mode 700 / 600).
set -euo pipefail
cd "$(dirname "$0")"

umask 077
mkdir -p backups
chmod 700 backups
file="backups/corpo-mailer-$(date +%Y%m%d-%H%M%S).sql.gz"

docker compose exec -T db pg_dump -U corpo corpo_mailer | gzip > "$file"
[ -s "$file" ] || { echo "Backup came out empty; something is wrong" >&2; rm -f "$file"; exit 1; }

ls -1t backups/corpo-mailer-*.sql.gz | tail -n +15 | xargs -r rm --
echo "Saved $file"

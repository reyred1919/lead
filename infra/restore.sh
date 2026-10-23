#!/usr/bin/env sh
# Usage: ./restore.sh backups/db-XXXX.dump [backups/media-XXXX.tgz]
set -eu
docker compose exec -T db pg_restore -U expo -d expo_leads --clean --if-exists < "$1"
if [ "${2:-}" ]; then docker compose exec -T backend tar -C /data -xzf - < "$2"; fi
echo "restore complete"

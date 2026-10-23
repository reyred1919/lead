#!/usr/bin/env sh
# Logical backup of PostgreSQL + uploaded brand assets. Run from infra/.
set -eu
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p backups
docker compose exec -T db pg_dump -U expo -Fc expo_leads > "backups/db-$STAMP.dump"
docker compose exec -T backend tar -C /data -czf - media > "backups/media-$STAMP.tgz"
echo "backup written: backups/db-$STAMP.dump backups/media-$STAMP.tgz"

#!/bin/sh
set -eu

backup_dir="${BACKUP_DIR:-/var/backups/move-intelligence}"
retention_days="${BACKUP_RETENTION_DAYS:-14}"
mkdir -p "$backup_dir"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
PGPASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}" \
  pg_dump \
    --host "${POSTGRES_HOST:-localhost}" \
    --port "${POSTGRES_PORT:-5432}" \
    --username "${POSTGRES_USER:-move}" \
    --dbname "${POSTGRES_DB:-move_intelligence}" \
    --format custom \
    --file "$backup_dir/move-intelligence-$timestamp.dump"
find "$backup_dir" -type f -name 'move-intelligence-*.dump' -mtime "+$retention_days" -delete

#!/usr/bin/env bash
# Backup database (PostgreSQL/Neon) → ./backups/backup-YYYYmmdd-HHMMSS.sql.gz
# Pemakaian: scripts/backup-db.sh [folder-tujuan]   |   retensi default 14 hari
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-$ROOT/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

if [ -z "${DATABASE_URL:-}" ]; then
  if [ -f "$ROOT/.env" ]; then
    DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ROOT/.env" | head -1 | cut -d= -f2- | tr -d '"')"
  fi
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL tidak ditemukan (env/.env)" >&2
  exit 1
fi
if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump tidak terpasang — install postgresql-client" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$OUT_DIR/backup-$STAMP.sql.gz"
pg_dump "$DATABASE_URL" --no-owner --no-privileges --clean --if-exists | gzip -9 > "$FILE"
echo "backup: $FILE ($(du -h "$FILE" | cut -f1))"

# rotasi
find "$OUT_DIR" -name 'backup-*.sql.gz' -mtime "+$RETENTION_DAYS" -delete

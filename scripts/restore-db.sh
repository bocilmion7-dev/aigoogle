#!/usr/bin/env bash
# Restore dari hasil scripts/backup-db.sh
# Pemakaian: scripts/restore-db.sh backups/backup-YYYYmmdd-HHMMSS.sql.gz
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FILE="${1:-}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "Pemakaian: $0 <file.sql.gz>" >&2
  exit 1
fi
if [ -z "${DATABASE_URL:-}" ] && [ -f "$ROOT/.env" ]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ROOT/.env" | head -1 | cut -d= -f2- | tr -d '"')"
fi
[ -n "${DATABASE_URL:-}" ] || { echo "DATABASE_URL tidak ditemukan" >&2; exit 1; }

echo "PERINGATAN: menimpa data di $DATABASE_URL"
read -r -p "Ketik 'ya' untuk lanjut: " ok
[ "$ok" = "ya" ] || { echo "dibatalkan"; exit 1; }

gunzip -c "$FILE" | psql "$DATABASE_URL" -v ON_ERROR_STOP=1
echo "restore selesai"

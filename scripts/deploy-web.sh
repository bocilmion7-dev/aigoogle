#!/usr/bin/env bash
# Deploy web TANPA menghapus aset ber-hash lama.
#
# Kenapa: service worker / tab yang sudah lama bisa menyajikan index.html lama.
# Index lama menunjuk chunk ber-hash lama. Kalau `rsync --delete` menghapus chunk
# itu, navigasi SPA & reload akan gagal/blank dan tampak "macet".
# Aset lama disimpan (default 30 hari), index & file non-aset tetap disinkronkan.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB="$ROOT/apps/web"
DEST="${WEB_DEST:-/var/www/aigoogle}"
RETENTION_DAYS="${ASSET_RETENTION_DAYS:-30}"

cd "$WEB"
pnpm build

# 1) Unggah aset baru dulu (aditif). Jangan pernah memakai --delete untuk aset.
mkdir -p "$DEST/assets"
rsync -a "$WEB/dist/assets/" "$DEST/assets/"

# 2) Perbarui index & file lain. `assets/` dilindungi dari --delete.
rsync -a --delete --exclude 'assets/' "$WEB/dist/" "$DEST/"

# 3) Buang hanya aset yang sudah sangat lama (default 30 hari).
find "$DEST/assets" -type f -mtime "+$RETENTION_DAYS" -delete

echo "web: $DEST (aset lama disimpan ${RETENTION_DAYS} hari)"

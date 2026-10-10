# AI Google — Add-on AI untuk Accurate Online

## Struktur
- `apps/api` — Express + Prisma (Neon) — port 3001
- `apps/web` — React + Vite — port 5173 (proxy /api → 3001)
- `mocks/accurate` — mock API Accurate — port 4010
- `packages/shared` — tipe TS bersama

## Dev lokal
```bash
pnpm install
cd apps/api && pnpm exec prisma migrate dev   # sekali
# 3 terminal:
cd mocks/accurate && pnpm dev
cd apps/api && MOCK_ACCURATE_URL=http://localhost:4010 pnpm dev
cd apps/web && pnpm dev
```
Buka http://localhost:5173 → landing. Launch mock: http://localhost:5173/api/launch?dbId=1001

## Uji
`pnpm test` (root, semua paket) · `pnpm typecheck`

## Environment (.env root)
DATABASE_URL (Neon), TOKEN_ENC_KEY, ACCURATE_CLIENT_ID/SECRET,
ACCURATE_API_BASE, MOCK_ACCURATE_URL, APP_ORIGIN, GEMINI_API_KEY,
GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET (menyusul)

## Fase berikutnya
Fase 2: AI chat + voice (Gemini tool loop + permission).

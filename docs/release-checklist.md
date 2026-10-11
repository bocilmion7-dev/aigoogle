# Checklist Pra-Rilis

## Prasyarat bisnis & akun

- [ ] Kemitraan / review listing Accurate Store dengan CPSsoft (spek §15).
- [ ] Developer terdaftar di account.accurate.id/developer (Client ID/Secret + callback URL produksi).
- [ ] Akun Google Cloud: OAuth consent (mode Production bila sudah verified) + scope `drive` diajukan (sensitive scope — risiko review, spek §17 #3).
- [ ] Akun Midtrans (untuk aktivasi billing di masa depan) — belum wajib selama dormant.
- [ ] Hosting: Vercel/standalone dengan HTTPS; repo private (kredensial ikut commit `.env` — keputusan pemilik).

## Teknis

- [ ] `DATABASE_URL` Neon produksi + `prisma migrate deploy`.
- [ ] Env produksi: `TOKEN_ENC_KEY`, `ACCURATE_*`, `GOOGLE_OAUTH_*`, `GEMINI_API_KEY`, `APP_ORIGIN` = domain HTTPS.
- [ ] `BILLING_ENABLED=0` (dormant) sampai kebijakan harga final; aktivasi = isi `MIDTRANS_SERVER_KEY` + `BILLING_ENABLED=1` (tanpa redesign).
- [ ] Smoke produksi: launch → chat → rapikan (mode mock dimatikan) → admin → audit.
- [ ] Golden set & suite penuh hijau terakhir (`pnpm test`, `pnpm typecheck`, build web).
- [ ] Aksesibilitas dasar: keyboard nav chat/explore/admin, screen reader cek transcript aria-live.

## Setelah rilis

- [ ] Pantau error log + kuota Gemini (free tier 20 req/hari/model).
- [ ] Golden set klasifikasi ditambah dengan PDF nyata per kategori (ambang ≥ 90%).
- [ ] Undo massal Drive (di luar scope fase) → backlog.
- [ ] Adapter Mekari/Paper.id (spek §3) → backlog.

# Spek Desain — Add-on AI untuk Accurate Online

**Tanggal:** 2026-10-10
**Status:** Disetujui pengguna (desain final sebelum implementation plan)
**Bentuk produk:** Web app SaaS multi-tenant, didistribusikan sebagai add-on di Accurate Store

---

## 1. Ringkasan & Tujuan

Add-on AI yang mempermudah pekerja kantor akuntansi lewat dua kapabilitas utama:

1. **Tanya data akuntansi** — user bertanya (teks atau suara) tentang isi database Accurate; AI menjawab dengan data live dari API provider, bukan karangan.
2. **Rapikan Google Drive** — satu tombol mengelompokkan file (PDF) ke folder berdasarkan jenis dokumen, dengan AI vision membaca isi file.

Prinsip produk: *"buat pekerja nyaman dan merasa dipermudah"* — gesekan minimal (tanpa login/register), aksi berisiko tinggi selalu punya preview + persetujuan, semua error dalam Bahasa Indonesia yang bisa ditindaklanjuti.

### Non-goals (fase ini)
- Menulis/transaksi ke data akuntansi (AI **read-only** ke provider)
- Sinkronisasi data ke warehouse (pendekatan live tool-calling, bukan NL2SQL)
- Mengaktifkan pembayaran Midtrans (core disiapkan, dormant)
- Tombol "Urungkan" massal untuk rapikan Drive (log posiisi asal disiapkan, fiturnya menyusul)
- Adapter Mekari & Paper.id (interface disiapkan, adapter menyusul)

---

## 2. Keputusan Kunci

| Topi | Keputusan |
|---|---|
| Provider akuntansi | **Accurate Online**, koneksi via **OAuth 2.0** (access token 15 hari + refresh token) |
| Distribusi | **Accurate Store** (pengguna install add-on dari sana) |
| Bentuk produk | Web app — React (Vite) + backend terpisah Node.js/TypeScript |
| Stack | React + Vite, Prisma, PostgreSQL (**Neon**) |
| Kecerdasan | **Gemini** — chat (tool-calling), vision (baca PDF), native audio (STT/TTS) |
| Voice | Dua engine: **Gemini native audio** + **Web Speech API**; dipilih admin platform di Settings |
| Strategi query AI | **Live tool-calling** — selalu data terbaru, tanpa sync/warehouse |
| Multi-provider | Interface `AccountingProvider` — Accurate (fase 1), Mekari & Paper.id menyusul |
| Auth pengguna | **Tanpa halaman login/register** — identitas dari launch provider (OAuth user info) |
| Akses langsung (bukan dari provider) | **Redirect landing page** |
| Role & hak akses | Dinamis, **checklist per role**; sumber: modul Accurate (API) + fitur app internal; **user baru tidak otomatis Admin** — permission diambil dari hak akses user di database Accurate |
| Billing | Lewat sistem tagihan Accurate; **core payment Midtrans QRIS tetap disiapkan** (dormant) |
| Arah visual | **Soft Utility** dengan radius diperkecil (4–6px, bukan 8–12px) |

---

## 3. Arsitektur

Tiga lapis + lapisan adapter provider:

```
BROWSER — React + Vite (TypeScript)
  💬 Chat AI (teks+voice) · 📁 Explore Manager · 👥 User & Role · ⚙️ Settings
            │ HTTPS / WebSocket (streaming)
API — Node.js + TypeScript
  🔐 Auth & Roles · 🔗 Connections (OAuth Accurate + Google)
  🤖 AI Core (Gemini tool loop + STT/TTS) · 🧹 Drive Organizer
  💳 Billing Core (DORMANT — Midtrans disiapkan, tidak aktif)
            │ interface AccountingProvider
  AccurateAdapter (fase 1) · MekariAdapter (plan) · PaperAdapter (plan)
            │ HTTP live
  Accurate Online API · Google Drive API · Gemini API · Neon Postgres (Prisma)
```

Prinsip modular:
- Satu monorepo (`web/` + `api/`), dipisah per modul dengan batas jelas — tiap unit bisa diuji sendiri.
- **AI tidak pernah memanggil API provider langsung** — selalu lewat `AccountingProvider`. Provider baru = implement interface.
- Billing, Mekari, Paper.id = modul terpasang tapi nonaktif/placeholder sampai fase-nya.

---

## 4. Entry & Onboarding

**Aturan utama:** semua akses aplikasi masuk melalui **launch dari provider** (Accurate Store; nanti Mekari/Paper.id dengan pola sama). Tidak ada halaman login dan tidak ada halaman register.

### Alur
1. Pengguna klik add-on di Accurate Store → Accurate membuka URL kita (`/launch`) dengan **code/token + id data usaha** (parameter persis diverifikasi di spike fase 0 — mekanisme dasarnya OAuth: authorization code / access token, sesuai dokumentasi OAuth Accurate).
2. Server menukar code → **access token + refresh token**; memanggil `open-db.do` dengan id data usaha → menyimpan `session` + `host`.
3. **Identitas user** diambil dari OAuth user info (email/id provider) → dicocokkan ke tenant (data usaha):
   - belum ada → buat user + **permission diambil dari hak akses user tersebut di database Accurate** (bukan otomatis Admin);
   - sudah ada → pakai permission-nya.
   - *Fallback (spike):* bila API tidak menyediakan pemetaan per-user, berlaku fallback yang ditetapkan saat spike — minimal, user dengan privilege Administrator di Accurate menjadi Admin di sistem kita.
4. Session cookie dibuat → masuk aplikasi.
5. Connect **Google Drive** (OAuth terpisah, scope `drive` penuh) — step tersedia di Settings/onboarding.

### Bukan dari provider
Akses tanpa konteks launch yang valid (URL langsung, bookmark, session habis) → **redirect landing page**: halaman info statis ("add-on ini dipakai dari Accurate", tombol ke Accurate Store).

### Token lifecycle
- Access token Accurate: 15 hari → **refresh otomatis** (best practice: refresh H-1 sebelum expired), refresh token gagal = status "perlu hubungkan ulang" + banner.
- `host` Accurate bisa berubah → HTTP client wajib **follow redirect 308**.
- Session `X-Session-ID` di-refresh via `open-db.do` saat diperlukan.

---

## 5. Alur Utama

### 5.1 Chat / Voice → data akuntansi
1. User mengetik atau menekan mic.
2. **STT** (sesuai setting admin: Gemini native audio atau Web Speech) → teks.
3. **Gemini tool loop**: model memanggil tool → **cek permission role** → `AccountingProvider` → API provider live. Boleh multi-langkah (ambil → hitung → ambil lagi).
4. Jawaban: teks + tabel angka; **TTS** → audio jika mode voice aktif.
5. Tersimpan di riwayat chat (per tenant).

**Penegakan:** tool ditolak bila role tidak punya hak modul terkait → AI menjawab "Anda tidak punya akses modul X".

### 5.2 Rapikan Drive (tombol, bukan chat)
1. Buka **Explore Manager** → pilih folder kerja (hanya folder yang dipilih yang disentuh).
2. Klik tombol **"Rapikan Folder Ini"**.
3. Scan isi → ambil PDF → **Gemini Vision** membaca isi dokumen → klasifikasi jenis.
4. **Preview rencana aksi** ditampilkan: folder baru apa, file apa yang di-rename & dipindah (daftar lengkap).
5. User klik **"Jalankan"** (consent wajib).
6. Eksekusi: create folder → rename → move; progress per file, bisa dibatalkan.
7. Laporan hasil + **log posisi asal tiap file** (dasar undo). *Catatan: tombol "Urungkan" (undo massal) di luar scope fase ini — yang disediakan adalah log lengkap posisi asal + laporan, sehingga undo bisa ditambahkan nanti tanpa perubahan data.*

---

## 6. Provider Abstraction

```ts
interface AccountingProvider {
  id: 'accurate' | 'mekari' | 'paper';
  startConnect(ctx): Promise<...>;      // OAuth launch/callback per provider
  refreshIfNeeded(tenantId): Promise<...>;
  capabilityCatalog(): ToolSpec[];      // tool + required module permission
  execute(tool, args, ctx): Promise<...>; // live API call, scoped tenant
  privilegeCatalog(): Promise<Perm[]>;  // daftar hak akses (modul) utk checklist role
}
```

- `AccurateAdapter`: OAuth code flow, `db-list`/`open-db`, endpoint `{host}/accurate/api/{modul}/{aksi}.do` + header `X-Session-ID`, scope `*_view` untuk baca.
- Tool AI = fungsi dari `capabilityCatalog()` — bukan daftar statis hard-coded.
- `privilegeCatalog()` menyuplai checklist "Modul Accurate" di editor role.

---

## 7. Hak Akses & Role

**Model:** Role (per tenant) → daftar permission, diedit dengan **checklist**, default sudah terisi.

**Dua kategori permission dalam satu editor (tab terpisah):**
1. **Modul Accurate** — sumber: API hak akses Accurate (`access-privilege/list.do` + `detail.do`; pemetaan per-user jadi spike) → mengontrol **tool AI mana yang boleh dipanggil**.
2. **Fitur app internal** — sumber statis: `drive.tidy` (Rapikan Drive), `users.manage` (Kelola User & Role), `settings.manage` (Pengaturan), `chat.history` (Riwayat), dll. Default terisi untuk role Admin.

**Penegakan (defense in depth):**
- Setiap **tool call AI** → cek permission modul (wajib).
- **Route/UI** → hanya render fitur yang diizinkan.
- **Aksi Drive** → wajib `drive.tidy`.

**Aturan pembentukan user:** dari launch provider saja; permission pertama kali = mirror hak akses di Accurate; **tidak ada** konsep "user pertama otomatis Admin".

---

## 8. AI Core

- **Model:** Gemini, pola **function calling / tool loop** (multi-turn, multi-tool).
- **Kurasi tool:** tool berbasis capability catalog provider, tiap tool dianotasi `requiredPermission` (modul). Batas **maks. 8 langkah** per pertanyaan + timeout 60 dtk → jawaban "butuh waktu, coba persempit pertanyaan".
- **Bahasa:** sistem prompt berbahasa Indonesia; jawaban angka format Indonesia (Rp, titik ribuan, koma desimal).
- **Voice (setting admin platform):**
  - `gemini-native` — audio in ke Gemini, audio out (satu provider, konteks sinkron);
  - `web-speech` — STT/TTS browser (ringan, gratis);
  - Admin memilih di **Settings platform**, berlaku untuk semua tenant.
- **Guardrail:** AI hanya menjawab dari data tool results; tanpa akses = jawaban "tidak punya akses", bukan mengarang.

---

## 9. Explore Manager (Drive)

- UI **file manager**: panel tree folder di kiri, daftar isi di kanan (gaya Explorer), panel chat AI tetap tersedia.
- **Folder picker** menentukan cakupan aksi (spek poin 4) — aksi di luar folder terpilih tidak mungkin.
- Aksi tersedia (tombol): **Rapikan Folder Ini**, refresh, batalkan proses; rename/create folder manual mengikuti permission.
- **Klasifikasi**: Gemini Vision membaca isi PDF (bukan hanya nama/ekstensi) → jenis dokumen → pemetaan ke folder kategori.
- **Preview + consent** sebelum eksekusi massal (lihat 5.2); eksekusi berprogres, sebagian gagal dilaporkan per-file.
- **Log aksi Drive** (fileId, dari → ke, jenis aksi, waktu, pelaku) → dasar audit & undo masa depan (tombol undo di luar scope, lihat §5.2).

---

## 10. Arah Visual

**Soft Utility — radius diperkecil (4–6px).** Karakter: tenang, hangat, membulat halus, palet low-saturation (warm gray + sage lembut), tipografi humanis (bukan Inter), pemisahan tanpa border keras (tint), bayangan tipis 2 level, motion 200ms ease-out. Cocok untuk aplikasi produktivitas harian kantor.

---

## 11. State Coverage & Error Handling

| Layar | Empty/pertama | Sedang proses | Error | Lambat/offline |
|---|---|---|---|---|
| Landing page | statis (kondisi normal) | — | — | — |
| Launch | — | loading bertahap (tukar token → open-db → cocokkan user) | layar error ID + "Coba lagi" + penyebab (mis. sesi kedaluwarsa → arahkan buka dari Accurate) | — |
| Chat | sapaan + suggested prompts; fitur akuntansi jalan meski Google belum connect | indikator "berpikir" + **badge tool call** ("Mengambil data penjualan…") | Gemini error → retry 1× lalu pesan jelas; token expired → auto-refresh, gagal → banner hubungkan ulang; rate limit → "data sedang ramai, coba lagi sebentar" | pesan offline; jawaban streaming bertahap |
| Explore Manager | belum connect Google → empty state + tombol connect; folder kosong → "Tidak ada file untuk dirapikan" | progress per file ("12/40 dianalisa") + tombol **Batalkan** | sebagian gagal (file terkunci/hak akses) → laporan per-file + retry | skeleton daftar file |
| User & Role | "belum ada user lain" (user datang dari launch) | simpan inline | validasi checklist | — |
| Settings | status koneksi + pilihan voice engine | uji koneksi | "perlu hubungkan ulang" per koneksi | — |

**Prinsip:** semua error = pesan Bahasa Indonesia actionable + tombol aksi; tidak pernah stack trace mentah.

---

## 12. Model Data (Prisma / Neon)

- **Tenant** — id, nama, provider, providerDbId, alias
- **User** — tenantId, provider, providerUserId, email, nama, roleId *(tanpa password)*
- **Role** — tenantId, nama; **RolePermission** — roleKey, permissionKey
- **PermissionCatalog** — key, kategori (`accurate_module` | `app_feature`), label (modul disuplai dari API)
- **Connection** — tenantId, provider, accessTokenEnc, refreshTokenEnc, expiresAt, host, status
- **ChatSession / ChatMessage** — tenantId, userId, role (user/ai), konten, toolTrace
- **DriveJob** — tenantId, folderId, status, rencana, hasil; **DriveActionLog** — jobId, fileId, aksi, dari, ke, waktu, status
- **AppSetting** — voiceEngine (`gemini-native` | `web-speech`), konfigurasi platform
- **AuditLog** — tenantId, userId, aksi, objek, detail, waktu
- **Subscription / Payment** — dormant (siap Midtrans QRIS)

---

## 13. Keamanan

- **Token terenkripsi at rest** (AES-256, key dari env) — access & refresh token Accurate/Google tidak pernah dikirim ke browser.
- **Isolasi multi-tenant**: setiap query & tool dibatasi `tenantId`; tes khusus wajib gagal pada kebocoran lintas-tenant.
- **Audit log** setiap tool call AI dan aksi Drive.
- **Google Drive scope `drive` penuh** dibutuhkan (rename/pindah file buatan orang lain) → *sensitive scope*, ada risiko review Google (tercatat di §17).
- Kredensial (Gemini API key, Google OAuth client id/secret, nanti Accurate client id/secret) dikelola pemilik project via **`.env` yang ikut ter-commit** (keputusan pemilik untuk kemudahan deploy Vercel) — **kredensial tidak didokumentasikan di dokumen ini**. Repo sebaiknya private.

---

## 14. Billing (Dormant)

- Akses fitur dikontrol modul **entitlement** (aktif/tidak) — bukan hard-coded.
- **Sumber entitlement fase ini**: sistem tagihan Accurate Store (perlu mekanisme verifikasi bersama CPSsoft — lihat §17).
- **Core payment Midtrans QRIS disiapkan** (endpoint, model Subscription/Payment, webhook signature) dalam kondisi **nonaktif** — siap diaktifkan bila kebijakan berubah, tanpa redesign.

---

## 15. Distribusi (Accurate Store)

- Pendaftaran developer + aplikasi (Client ID/Secret, URL callback) di `account.accurate.id/developer`.
- Listing add-on di Accurate Store kemungkinan butuh **kemitraan/proses review CPSsoft** — proses bisnis, bukan kode; jadi prasyarat rilis.
- Onboarding pengguna sepenuhnya mengikuti Store → launch (§4).

---

## 16. Testing

- **Unit** — contract test adapter (API Accurate di-**mock** karena credential belum ada), permission checker (role × tool), parser/klasifikasi.
- **Integration** — alur OAuth Accurate (mock) & **Google OAuth asli**, tool loop Gemini **asli**, operasi Drive terhadap mock Drive API.
- **E2E (Playwright)** — jalur bahagia launch → tanya → rapikan; state error (token expired, gagal sebagian, offline).
- **AI golden set** — pertanyaan Bahasa Indonesia → urutan tool yang diharapkan; **fixture PDF** → ambang akurasi klasifikasi sebelum rilis.
- **Multi-tenant isolation** — tes yang wajib gagal jika ada kebocoran lintas tenant.
- **Aksesibilitas** — keyboard navigation & screen reader dasar (chat, tabel, file manager).

---

## 17. Spike, Risiko & Open Questions

| # | Item | Jenis | Fase |
|---|---|---|---|
| 1 | Parameter persis saat Accurate membuka add-on (`dbId`, token/code) — akses developer docs login atau CPSsoft | spike | 0 |
| 2 | `access-privilege/detail.do` — apakah berisi matriks modul × hak; pemetaan per-user; fallback bila tidak ada | spike | 0 |
| 3 | Review Google untuk scope `drive` penuh (sensitive scope) | risiko | 1 |
| 4 | Kualitas Gemini native audio untuk Bahasa Indonesia (angka, istilah) | spike | 0/2 |
| 5 | Listing Accurate Store: proses kemitraan & bagaimana status bayar terbaca oleh kita | risiko bisnis | 5 |
| 6 | Scope OAuth Accurate yang dibutuhkan semua modul → daftar final | spike | 0 |
| 7 | Mekari & Paper.id: ketersediaan API & pola OAuth (untuk adapter berikutnya) | risiko rendah | nanti |

---

## 18. Fase Implementasi

| Fase | Isi | Keluaran |
|---|---|---|
| **0 — Spike & verifikasi** | Butir spike §17 (1,2,4,6), mock server Accurate | Keputusan teknis terverifikasi, mock siap |
| **1 — Fondasi platform** | Monorepo web+api, skema Prisma multi-tenant, `/launch` + session tanpa login, landing page, OAuth Accurate (mock) + Google (asli), Settings, interface `AccountingProvider` | App bisa di-launch dari Accurate (mock) & connect Google |
| **2 — AI chat + voice** | Gemini tool loop + penegakan permission, AccurateAdapter (mock→live), UI chat streaming + badge tool, riwayat, STT/TTS (2 engine + setting admin) | Tanya-jawab data akuntansi (teks & suara) berjalan |
| **3 — Explore Manager** | UI file manager, folder picker, klasifikasi Gemini Vision, preview+consent, eksekusi create/rename/move + progress/batal, log undo, laporan per-file | Fitur rapikan folder berjalan |
| **4 — Admin & audit** | Editor role checklist (modul API + fitur app), manajemen user, tampilan audit log | Hak akses dikelola dinamis |
| **5 — Kesiapan rilis** | Billing core dormant (Midtrans QRIS), dokumen listing Accurate Store, hardening, E2E, aksesibilitas, golden set | Siap rilis |

Setiap fase = spek → plan → implementasi → verifikasi. Fase 1–2 sudah memasang interface multi-provider agar Mekari/Paper.id tinggal menambah adapter.

---

## 19. Environment & Kredensial

- `.env` (ter-commit, keputusan pemilik): `GEMINI_API_KEY`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `ACCURATE_CLIENT_ID`, `ACCURATE_CLIENT_SECRET` (menyusul), `TOKEN_ENC_KEY`, `DATABASE_URL` (Neon), `APP_URL`.
- Kredensial nyata **tidak ditulis di dokumen ini** — diisi pemilik saat setup.
- Testing: Accurate **mock**, Gemini & Google OAuth **asli**.

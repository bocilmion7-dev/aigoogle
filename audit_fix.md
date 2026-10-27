# AUDIT TOTAL — AI Asisten

> Scope: working tree saat ini (termasuk file yang belum di-commit).  
> Verifikasi cepat: `pnpm typecheck` lulus, `pnpm test` **452/452 passed**, tapi banyak warning stderr di audit & billing yang menunjukkan bug nyata.

---

## 1. CODE REVIEW MENDALAM

### 🔴 CRITICAL — harus diperbaiki SEBELUM launch 10.000 user

| File:baris | Masalah | Bahaya | Solusi singkat | Status |
|---|---|---|---|---|
| `apps/web/src/pages/Insight.tsx:156-187` | Injeksi script pihak ketiga `highrevenueformat.com` langsung ke DOM aplikasi autentikasi. | XSS/RCE, pencurian cookie/session, exfil data keuangan, gagal compliance PCI/keuangan. | Hapus iklan dari app shell. Kalau perlu monetisasi, muat di iframe sandbox (`sandbox="allow-scripts"` **tanpa** `allow-same-origin`) atau hanya di landing publik. | ✅ Selesai — script iklan dihapus. |
| `apps/web/src/App.tsx:86` | Router langsung render `pageFor(window.location.pathname)` tanpa menunggu autentikasi. | User anonim dapat mount komponen protected, melihat struktur UI/JS chunks, dan bypass redirect client-side. | Bungkus route dalam auth boundary yang **blok render sampai** `/api/me` selesai. | ✅ Selesai — auth boundary sync. |
| `apps/web/src/pages/WhatsApp.tsx:526` | `<iframe src={st.embedUrl} />` dari API tanpa validasi domain. | Phishing / clickjacking alur Embedded Signup Meta. | Whitelist domain sebelum render: `const ALLOWED = /^https:\/\/(www\.)?facebook\.com\//i;`. | ✅ Selesai — `safeMetaEmbedUrl`. |
| `apps/api/src/routes/ai-providers.ts:179-196` | `preview-models` fetch URL `baseUrl` sembarangan dari admin platform; `baseUrl` tersebut juga dipakai pipeline chat. | SSRF ke metadata cloud (`169.254.169.254`), internal services, atau kredensial cloud. | Validasi hostname: tolak IP/private ranges, hanya izinkan allow-list provider publik. | ✅ Selesai — guard SSRF di create/update/preview/chat pipeline. |

### 🟠 HIGH

| File:baris | Masalah | Bahaya | Solusi singkat | Status |
|---|---|---|---|---|
| `apps/api/src/sales/wallet.ts:132-152` | `createWithdrawal` baca saldo + pending di luar transaksi, lalu decrement di dalam. | Race condition: 2 request paralel bisa over-withdraw → saldo negatif. | Wrap read-check-write dalam 1 Prisma transaction + row lock. | ✅ Selesai — transaksi Serializable. |
| `apps/api/src/routes/orders.ts:485-489` | Biteship webhook memeriksa token hanya kalau `BITESHIP_WEBHOOK_TOKEN` terisi; kalau kosong, siapa pun bisa POST. | Penyerang bisa memalsukan status pengiriman & memicu notifikasi WA ke pembeli. | Fail-closed: `if (!token \|\| given !== token) return 401`. | ✅ Selesai — fail-closed. |
| `apps/web/index.html` + `apps/api/src/app.ts:37-43` | Tidak ada CSP (meta/header) dan tidak ada HSTS. | Iklan/inline script bebas dieksekusi; SSL stripping. | Deploy CSP strict + HSTS di nginx/API; mulai report-only bila khawatir break. | ✅ Selesai — CSP meta ber-hash + HSTS nginx/API. |
| `apps/api/src/routes/billing.ts:80-123` | Midtrans legacy webhook mengulang `subscription.updateMany` setiap notifikasi tanpa idempotency. | Replay notifikasi `settlement` bisa memperpanjang langganan tanpa pembayaran baru. | Early return kalau `payment.status === n.transaction_status`. | ✅ Selesai — idempotency guard. |
| `apps/api/src/ai/tool-loop.ts:39-109` + `apps/api/src/routes/chat.ts:347` | `ThrottledEmitter` interval tidak pernah di-`end()` di path error/catch/early-return. | Memory leak & event-loop handle tertinggal saat stream dibatalkan/error. | Tambah `emitter.destroy()` dan panggil di `finally`/`catch` di `chat.ts`. | ✅ Selesai — `destroy()` + `finally`. |
| `apps/api/src/routes/wa.ts:347-386` | WA topup webhook update status tanpa idempotency; replay `cancel` bisa overwrite `settlement`. | Status pembayaran & saldo jadi tidak konsisten. | Early return kalau stored status sudah final/settlement. | ✅ Selesai — idempotency guard. |
| `apps/api/src/routes/drive.ts:231-242` | Status job dibaca lalu di-update `running` tidak atomik; `cancelFlags` in-memory. | 2 request `run` bisa jalan bersamaan; cancel bisa race. | Gunakan `updateMany` dengan `status: { not: "running" }` dalam 1 query. | ✅ Selesai — klaim atomik + status `failed`. |

### 🟡 MEDIUM

| File:baris | Masalah | Bahaya | Solusi singkat | Status |
|---|---|---|---|---|
| `apps/web/src/ai-access-guard.tsx:11-24` | Guard AI hanya `useEffect` non-blocking; halaman tetap mount dulu. | UI protected muncul sebentar untuk user tanpa akses. | Gabungkan dengan auth boundary sync sebelum render. | ✅ Selesai — auth boundary menahan render. |
| `apps/web/src/pages/Toko.tsx:24-33` | `getShippingSettings()` dipanggil sebelum `getMe()` selesai / tanpa cek auth. | Request 401 saat anonim, UX spinner-error. | Fetch data hanya setelah `me` valid. | ✅ Selesai — fetch setelah `me`. |
| `apps/web/src/pages/Explore.tsx:88-108` | `load()` tidak cancellable; toggle cepat menimpa state dengan response lama. | Folder/file lawas ditampilkan. | Simpan `AbortController` per panggilan, ignore stale. | ✅ Selesai — sequence guard per folder. |
| `apps/web/src/pages/Orders.tsx:79-86` | Debounce hanya clear timer; fetch yang sudah jalan tetap menimpa hasil baru. | Daftar pesanan tidak sinkron dengan input terakhir. | Abort fetch lama sebelum fetch baru. | ✅ Selesai — sequence guard. |
| `apps/web/src/pages/Pelanggan.tsx:89-108` | `getEntryOptions()` pakai timer tanpa abort request sebelumnya. | Stale options / race condition. | Abort/cancel request lama di cleanup. | ✅ Selesai — sequence guard. |
| `apps/api/src/sales/wallet.ts:21-22` | `creditSalesWallet` cek `orderId` di luar transaction. | Double-credit saldo saat settlement replay/race. | Enforce unique index `(tenantId, orderId, kind)` + transaction. | ✅ Selesai — transaksi Serializable. |
| `apps/api/src/sales/wallet.ts:40-74` | `reconcileSalesWallet` mengambil **semua** `appSetting` `wa:shop_order:*` secara global, lalu parse satu-satu. | O(N×M), tidak ada filter DB; lambat & mahal saat banyak tenant. | Tambahkan filter/prefix `tenantId` di key atau pindahkan ke tabel tersendiri. | ⚠️ Partial — throttle 5 menit, scan global masih ada. |
| `apps/api/src/routes/chat.ts:263-330` | Fast path bisa mengirim `start` + `text_delta`, lalu jatuh ke slow path yang kirim `start` lagi. | Event duplikat / teks interleaved di klien. | Hentikan stream & reset state sebelum fallthrough, atau pisahkan jalur respons. | ✅ Selesai — `startSent` guard. |
| `apps/api/src/routes/wa.ts:542-553` | `POST /api/wa/send` hanya `requireUser`, tanpa cek permission. | Staff biasa bisa menghabiskan kredit WA perusahaan. | Tambah `requirePerm("app:wa.send")` atau semacamnya. | ✅ Selesai — permission `app:wa.send`. |
| `apps/api/src/routes/auth.ts:48-53` | Cookie `sid`/`psid` `sameSite: "lax"` tanpa `path`, `secure` tergantung env. | CSRF surface lebih luas; cookie bisa kirim ke seluruh origin. | `sameSite: "strict"`, `path: "/api"`, dan enforce `secure: true` di prod. | ✅ Selesai — Strict + path `/api`. |
| `apps/api/src/middleware/rate-limit.ts:12` | Store rate limit in-memory Map. | Multi-instance / horizontal scale = limit tidak shared, bisa bypass. | Ganti ke Redis dengan interface yang sama. | ✅ Selesai — Redis self-hosted, 128 MB, rate limit shared. |
| `apps/api/src/routes/orders.ts:435-475` | `/public/track/:orderId` tanpa rate limit. | Enumerasi orderId & pemakaian kuota Biteship. | Tambahkan rate limit 30×/menit per IP. | ✅ Selesai — 30×/menit. |

### 🟢 LOW (hardening / polish)

| File:baris | Masalah | Bahaya | Solusi singkat | Status |
|---|---|---|---|---|
| `apps/api/src/routes/auth.ts:101-119` | Set password tidak invalidasi sesi lama. | Sesi attacker yang masuk saat akun passwordless tetap hidup. | `prisma.session.deleteMany({ where: { userId: ... } })` kecuali sesi saat ini. | ✅ Selesai — sesi lain dicabut. |
| `apps/api/src/password.ts:21-25` | Kebijakan password hanya 8 karakter + 1 angka. | `password1` lolos. | Minimal 12 karakter, mixed case + digit + simbol. | ✅ Selesai — 12+ karakter, mixed case + digit + simbol. |
| `apps/api/src/wawasan/marketplace.ts:257` | API key SerpAPI dikirim sebagai query param. | Key muncul di log proxy/server. | Pakai header kalau SerpAPI mendukung, atau rotate key rutin. | ❌ Tidak diubah — SerpAPI hanya mendukung query param; mitigasi: rotate key. |
| `apps/api/src/routes/webhook-accurate.ts:138-143` | App Key webhook diterima dari query string / body. | Key bisa bocor di log/load balancer. | Hanya terima dari header (`x-app-key`). | ✅ Selesai — header-only. |
| `apps/api/src/ai/llm-client.ts:9` | Timeout per attempt 70 detik. | 1 chat request bisa memegang worker >2 menit (tool loop + failover). | Turunkan ke 30-45 detik, atau offload ke background queue. | ✅ Selesai — 45 detik. |
| `apps/web/src/ui.tsx:49-67` | Refetch saldo AI di setiap `focus` + `visibilitychange` tanpa throttle. | Burst request saat user switch tab. | Tambahkan debounce 2 detik. | ✅ Selesai — debounce 2 detik. |
| `apps/web/src/page-boundary.tsx:49` + beberapa pages | `window.location.replace/href` dipanggil saat render. | Double redirect, flash, hydration issue. | Pindahkan ke `useEffect`. | ⚠️ Partial — page utama sudah, beberapa halaman masih redirect di render. |
| `apps/web/src/pages/Pelanggan.tsx:120` | Redirect dalam render. | Sama seperti di atas. | `useEffect`. | ✅ Selesai — pindah ke effect. |
| `apps/api/src/db.ts:19` | Tidak ada konfigurasi connection pool / query timeout. | Default pool 10 bisa jadi bottleneck 10k user. | Set `connection_limit` & `pool_timeout` sesuai load. | ✅ Selesai — default pool 20 + timeout 20 dtk (bisa override env). |

### Contoh perbaikan cepat

**1. Auth boundary sync (`App.tsx`)**

```tsx
const [me, setMe] = useState<Me | null | undefined>(undefined);
useEffect(() => { void getMe().then(setMe); }, []);
if (me === undefined) return <PageFallback />;
if (me === null) { window.location.replace("/login"); return null; }
return <Suspense ...>{pageFor(...)}</Suspense>;
```

**2. Cookie hardening (`auth.ts:48`)**

```ts
res.cookie("sid", sid, {
  httpOnly: true,
  sameSite: "strict",
  secure: true, // atau env.APP_ORIGIN.startsWith("https://")
  path: "/api",
  maxAge: 7 * 86400_000,
});
```

**3. Withdrawal atomic (`sales/wallet.ts:132`)**

```ts
await prisma.$transaction(async (tx) => {
  const wallet = await tx.salesWallet.findUnique({ where: { tenantId: opts.tenantId } });
  const pending = await tx.salesWithdrawal.aggregate({ ... });
  const available = (wallet?.balance ?? 0) - (pending._sum.amount ?? 0);
  if (amount > available) throw new Error("saldo_kurang");
  await tx.salesWallet.update({ where: { tenantId }, data: { balance: { decrement: amount } } });
  await tx.salesWalletTx.create({ ... });
  await tx.salesWithdrawal.create({ ... });
});
```

**4. Biteship webhook fail-closed (`orders.ts:485`)**

```ts
const token = process.env.BITESHIP_WEBHOOK_TOKEN ?? "";
const given = String(req.header("x-webhook-token") ?? "");
if (!token || given !== token) return res.status(401).json({ error: "unauthorized" });
```

**5. Billing idempotency (`billing.ts:80`)**

```ts
if (payment.status === n.transaction_status) {
  return res.json({ ok: true, ignored: true });
}
```

---

## 2. ANALISIS KEKURANGAN FITUR

### 1. Autentikasi

| Fitur yang HARUS ada | Status awal | Status terkini | Risiko bila tidak ada | Saran |
|---|---|---|---|---|
| Password reset / lupa password | ❌ Tidak ada | ✅ Selesai — Resend aktif, email terkirim | User terkunci permanen → support banjir tiket | Email reset token via Resend/SendGrid |
| Verifikasi email | ❌ Tidak ada | ✅ Selesai — email verifikasi terkirim + tombol kirim ulang (soft-verification, belum di-enforce) | Akun aktif tanpa validasi email | OTP/magic link saat set password |
| 2FA / MFA untuk admin | ❌ Tidak ada | ✅ Selesai — TOTP + QR + 10 backup code + OTP email default | Admin platform = god mode, 1 password saja | TOTP wajib untuk platform, opsional untuk admin perusahaan |
| Manajemen sesi & perangkat | ❌ Tidak ada | ✅ Selesai — daftar & cabut sesi di `/akun` | Tidak bisa revoke sesi curian | UI "perangkat aktif" + revoke |
| Brute-force lockout + login alert | ⚠️ Partial (rate limit only) | ⚠️ Partial — rate limit per IP; lockout per akun & alert belum | Akun bisa dibobol perlahan | Lockout 30 menit + email notifikasi login baru |
| Google OAuth end-user | ❌ Hanya untuk Drive | ❌ Belum | User minta login Google | Pertimbangkan opsional |

### 2. Pembayaran

| Fitur yang HARUS ada | Status awal | Status terkini | Risiko | Saran |
|---|---|---|---|---|
| Billing aktif (BILLING_ENABLED=0) | ❌ Dormant | ✅ Sandbox aktif (`BILLING_ENABLED=1`, `MIDTRANS_ENV=sandbox`); produksi belum | **Tidak ada revenue produksi** | Aktifkan Midtrans produksi + end-to-end test |
| Recurring / auto-renew | ❌ Tidak ada | ❌ Belum — butuh Midtrans Subscription/Scheduler | Churn tinggi karena bayar manual | Midtrans Subscription/scheduler atau reminder QRIS |
| Invoice PDF & riwayat pembayaran | ❌ Tidak ada | ⚠️ Partial — PDF + kirim email selesai; UI riwayat pembayaran belum | B2B butuh bukti bayar | Generate invoice PDF + email |
| e-Faktur / PPN | ❌ Tidak ada | ❌ Belum — butuh spesifikasi DJP | Pelanggaran perpajakan B2B Indonesia | Integrasi e-Faktur atau cetak PPN |
| Dunning / retry pembayaran gagal | ❌ Tidak ada | ✅ Selesai — pengingat H-3/H+7 via WA/email | Langganan expired tanpa notifikasi | Email reminder H-3, H-1, H+1 |
| Refund & compensation flow | ❌ Tidak ada | ⚠️ Partial — halaman kebijakan + adjust saldo manual; form otomatis belum | Keluhan user saat service gagal | Form refund + kredit otomatis |
| Usage cap alert & billing budget | ❌ Tidak ada | ✅ Selesai — alert saldo token menipis via WA/email + gate UI | User kaget tagihan AI | Alert 50/80/100% token |

### 3. Dashboard Admin

| Fitur yang HARUS ada | Status awal | Status terkini | Risiko | Saran |
|---|---|---|---|---|
| Tenant lifecycle (suspend/delete/archive) | ❌ Tidak ada | ⚠️ Partial — suspend/aktifkan selesai; delete/archive belum | Tidak bisa handle churn/abuse | Tambah status tenant + soft-delete |
| Bulk invite user perusahaan | ❌ Tidak ada | ⚠️ Partial — invite satuan via email selesai; bulk belum | Onboarding staf manual | Email invite link / QR onboarding |
| Edit profil user (nama/email/telepon) | ❌ Tidak ada | ⚠️ Partial — nama & telepon selesai; ubah email belum | Data usang, self-service nol | `PUT /me` + UI |
| Onboarding checklist / guided setup | ❌ Tidak ada | ✅ Selesai — checklist di halaman chat | Drop-off tinggi setelah login | Wizard 4 langkah: Accurate → WA → Drive → AI |
| System health dashboard + alerting | ⚠️ Partial (health endpoint) | ⚠️ Partial — endpoint health/metrics ada; UI & alert belum | Operator tidak tahu saat down | Dashboard status + alert Slack/email |
| Feature flags / kill switch | ❌ Tidak ada | ✅ Selesai — tab Fitur di Admin | Rollout berisiko | `AppSetting` boolean per fitur |
| Impersonation untuk platform admin | ❌ Tidak ada | ✅ Selesai — tombol Masuk + banner keluar + audit | Sulit debug masalah user | Token impersonate sementara + audit |

### 4. SEO & Performance

| Fitur yang HARUS ada | Status awal | Status terkini | Risiko | Saran |
|---|---|---|---|---|
| SSR / prerender untuk landing/docs publik | ❌ Tidak ada | ❌ Belum — butuh arsitektur SSR/prerender | Google tidak index konten React, SEO lemah | Vite prerender atau renderToString |
| `robots.txt` | ❌ Tidak ada | ✅ Selesai | Crawler tidak tahu aturan | Buat robots.txt |
| `sitemap.xml` | ❌ Tidak ada | ✅ Selesai | Halaman publik tidak terindex optimal | Generate sitemap otomatis |
| Structured data pricing/FAQ | ⚠️ Partial (SoftwareApplication saja) | ⚠️ Partial — baru SoftwareApplication | Rich snippet tidak muncul | Product/Offer/FAQ schema |
| Image optimization (WebP/AVIF, srcset) | ❌ Tidak ada | ❌ Belum | LCP lambat di mobile | Vite imagetools atau CDN image |
| Core Web Vitals monitoring | ❌ Tidak ada | ✅ Selesai — Web Vitals → `/api/telemetry` | Performa nyata buta | `web-vitals.js` + dashboard |
| CDN / edge caching | ❌ Tidak ada | ❌ Belum — butuh Cloudflare/CloudFront | Latensi tinggi luar Jabodetabek | Cloudflare/CloudFront |
| hreflang / multi-language | ❌ Tidak ada | ❌ Belum | Tidak siap pasar internasional | Pertimbangkan `en` alias |

### 5. UX Mobile

| Fitur yang HARUS ada | Status awal | Status terkini | Risiko | Saran |
|---|---|---|---|---|
| Web push notifications | ❌ Tidak ada | ✅ Aktif — VAPID terpasang; trigger langganan, saldo, pesanan | Engagement & retensi rendah | Integrasi push untuk alert AI/jatuh tempo |
| Offline action queue | ⚠️ Partial (SW cache shell) | ❌ Belum — cache shell saja, belum queue aksi | Aksi chat/scan gagal saat offline | IndexedDB queue + sync saat online |
| Pull-to-refresh / swipe gestures | ❌ Tidak ada | ❌ Belum | UX terasa web 2015 | Tambahkan pull-to-refresh di list |
| Biometric auth (WebAuthn/Face ID) | ❌ Tidak ada | ❌ Belum | Password di mobile merepotkan | Face ID/Touch ID setelah setup |
| Deep linking / app links | ❌ Tidak ada | ❌ Belum | Tidak bisa dibuka dari notifikasi/email | Universal links + intent filters |
| Bottom sheet untuk modal kompleks | ⚠️ Partial | ⚠️ Partial — belum diubah | Modal QR terlalu kecil di HP | Ubah modal jadi sheet full-screen mobile |

### 6. Keamanan

| Fitur yang HARUS ada | Status awal | Status terkini | Risiko | Saran |
|---|---|---|---|---|
| Content-Security-Policy (CSP) | ❌ Tidak ada | ✅ Selesai — meta CSP ber-hash (build) | XSS dari iklan/inline script | Deploy CSP strict + nonce |
| HSTS header | ❌ Tidak ada | ✅ Selesai — nginx + API | SSL stripping attack | `Strict-Transport-Security` via nginx |
| Secure cookie enforcement + `__Host-` prefix | ⚠️ Partial (tergantung env) | ⚠️ Partial — `SameSite=Strict`, path `/api`, secure ikut env; `__Host-` belum | Cookie bisa bocor HTTP | Paksa `secure` + `SameSite=Strict` |
| WAF / DDoS protection | ❌ Tidak ada | ❌ Belum — butuh Cloudflare/WAF | Mudah diserang layer 7 | Cloudflare atau rate limit agresif |
| Dependency & secret scanning di CI | ❌ Tidak ada | ⚠️ Partial — `pnpm audit` di CI; secret scanning belum | Vulnerability tertinggal | `pnpm audit`, Trivy, GitHub secret scanning |
| Data retention & deletion policy | ❌ Tidak ada | ✅ Selesai — cleanup harian chat/log/token | Pelanggaran privasi | Hapus chat/log lama otomatis |
| Pentest / security review formal | ❌ Tidak ada | ❌ Belum — butuh vendor | Celurit tidak diketahui | Budget pentest sebelum 10k user |

### 7. Analitik

| Fitur yang HARUS ada | Status awal | Status terkini | Risiko | Saran |
|---|---|---|---|---|
| Product analytics (GA4/PostHog/Amplitude) | ❌ Tidak ada | ⚠️ Partial — telemetri in-house; GA4/PostHog belum | Tidak tahu funnel onboarding/churn | Pasang event tracking tanpa PII |
| Error/crash tracking (Sentry) | ❌ Tidak ada | ❌ Belum — butuh DSN | Error produksi ditemukan user | Integrasi Sentry SDK |
| Conversion tracking pembayaran | ❌ Tidak ada | ⚠️ Partial — `login`, `subscribe_click`, `chat_send`; funnel penuh belum | Tidak tahu CAC/ROAS | Track trial → langganan |
| Real User Monitoring (RUM) | ❌ Tidak ada | ✅ Selesai — Web Vitals → telemetry | Performa nyata buta | Web-vitals + PostHog RUM |
| NPS / feedback in-app | ❌ Tidak ada | ❌ Belum | Tidak dapat signal kepuasan | Micro-survey setelah milestone |
| A/B testing infrastructure | ❌ Tidak ada | ❌ Belum | Optimasi UI menebak-nebak | Feature flag + event assignment |
| Search Console integration | ❌ Tidak ada | ❌ Belum — butuh akun Google | Tidak tahu traffic organik | Google Search Console + Looker Studio |

---

## 3. SARAN ROADMAP — TOP 10 PERBAIKAN PALING PENTING

| Prioritas | Fitur/Perbaikan | Alasan Bisnis | Kesulitan | Status |
|---|---|---|---|---|
| 1 | **Password reset / lupa password** | 10k user = ratusan lupa password/minggu. Support manual tidak scalable; retensi awal hancur tanpa ini. | Mudah–Sedang (butuh SMTP/transactional email) | ✅ Selesai — Resend aktif |
| 2 | **Aktivasi billing + recurring subscription** | Billing masih `BILLING_ENABLED=0`; platform **tidak menghasilkan revenue**. Auto-renew langsung mengurangi churn. | Sedang–Sulit (Midtrans prod + scheduler + uji end-to-end) | ⚠️ Sandbox aktif; recurring & produksi belum |
| 3 | **Hapus/hardering iklan di app + deploy CSP + HSTS** | Data keuangan perusahaan tidak boleh bersama script pihak ketiga tanpa sandbox; risiko audit & kepercayaan enterprise. | Mudah (hapus injeksi + header nginx) | ✅ Selesai |
| 4 | **SSR/prerender landing + `robots.txt` + `sitemap.xml`** | B2B SaaS bergantung organic search. SPA tanpa prerender = SEO lemah, CAC tinggi. | Sedang (Vite prerender atau migrasi parsial) | ⚠️ Partial — robots/sitemap selesai; SSR belum |
| 5 | **Product analytics + error monitoring (Sentry/PostHog)** | Tanpa ini bisnis buta: tidak tahu onboarding, churn, atau saat produksi rusak. | Mudah | ⚠️ Partial — telemetri in-house; Sentry/PostHog belum |
| 6 | **Self-service invite user & manajemen tenant** | Admin perusahaan harus bisa undang staf sendiri; tidak boleh lewat platform admin manual. | Sedang | ⚠️ Partial — invite + suspend selesai; bulk/delete/archive belum |
| 7 | **Dunning, invoice PDF/email, & faktur pajak** | B2B Indonesia butuh invoice resmi. Pembayaran manual tanpa reminder = churn tinggi. | Sedang | ⚠️ Partial — dunning + invoice PDF/email selesai; e-Faktur belum |
| 8 | **Web push notifications + offline action queue** | Mobile engagement & retensi sangat bergantung notifikasi; offline queue mencegah kehilangan data lapangan. | Sedang–Sulit | ⚠️ Partial — push scaffold; offline queue belum |
| 9 | **2FA/MFA + manajemen sesi perangkat** | Data akuntansi sensitif; 10k user = target menarik. Wajib untuk admin, opsional untuk staf. | Sedang | ✅ Selesai |
| 10 | **Usage cap alerts + refund/credit policy UI** | Transparansi biaya AI mencegah keluhan "tagihan membengkak"; trust penting untuk B2B. | Mudah–Sedang | ✅ Selesai — alert + halaman kebijakan; refund otomatis partial |

### Catatan operasional tambahan sebelum launch

- Banyak file baru yang **belum di-commit** (`apps/api/src/sales/`, `apps/api/src/analisa/`, halaman web baru). Jangan deploy dari working tree kotor; commit & push dulu.
- `apps/web/dist/` tidak boleh masuk git / jadi sumber deploy build yang berantakan. Build harus reproducible.
- API saat ini berjalan dengan `tsx` di produksi (per `AGENTS.md`). Untuk 10k user, compile ke JS dan jalankan dengan `node` untuk performa & stabilitas lebih baik.
- Rate limit in-memory tidak akan efektif saat scale horizontal; pindah ke Redis sebelum multi-instance.

---

## STATUS IMPLEMENTASI (2026-10-27)

### Sudah dikerjakan
- **Critical/High code review:** iklan pihak ketiga di app shell dihapus; auth boundary sync; validasi iframe Meta; SSRF guard provider AI; withdrawal & credit wallet atomik; Biteship webhook fail-closed; CSP + HSTS; idempotency webhook billing/WA; cleanup ThrottledEmitter; drive job race.
- **Medium/Low:** race fetch frontend (Explore/Orders/Pelanggan), permission WA send, cookie `SameSite=Strict` + `path=/api`, rate limit Redis opsional, rate limit public tracking, invalidasi sesi setelah set/reset password, password policy 12+ karakter, webhook Accurate header-only, timeout LLM 45 dtk, debounce saldo, DB pool config.
- **Auth:** lupa/reset password (nama tenant per link, throttle anti-spam), verifikasi email + kirim ulang, 2FA TOTP + QR + backup code + **OTP via email default**, edit profil. Tabel sesi dihapus dari UI.
- **Admin:** undang user via email, suspend/aktifkan tenant, feature flags/kill switch, impersonation platform.
- **SEO/observability:** `robots.txt`, `sitemap.xml`, CSP meta ber-hash, telemetri Web Vitals + event produk.
- **Billing/ops:** invoice PDF + kirim email, pengingat langganan H-3/H+1/H+7, alert saldo token menipis, halaman kebijakan refund, retensi data otomatis, CI dependency audit + build API, script build produksi API.
- **Mobile:** Web Push aktif (VAPID) + service worker push handler, trigger langganan/saldo/pesanan, onboarding checklist.

### Status kredensial
- **Resend aktif** (send-only), **VAPID aktif**, **Redis self-hosted aktif** (128 MB, tanpa persistence). `MIDTRANS_ENV=sandbox`, `BILLING_ENABLED=1` (sandbox). Meta Cloud API belum diisi; Waserver aktif.

### Verifikasi
- `pnpm typecheck` lulus.
- `pnpm test` **452/452 lulus**.
- `pnpm --filter @aigoogle/web build` dan `pnpm --filter @aigoogle/api build` lulus.
- Deploy web + restart API + `GET /api/health?deep=1` → semua check `ok`.
- HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, COOP aktif di nginx; CSP aktif via meta.

### Masih butuh infra/keputusan eksternal (bukan murni kode)
- SSR/prerender landing (butuh arsitektur render/build khusus).
- Sentry/error tracking & product analytics eksternal (butuh DSN/key).
- e-Faktur/PPN dan recurring billing Midtrans (butuh spesifikasi & kredensial sandbox/produksi).
- WAF/DDoS, pentest formal, CDN.
- Offline action queue, WebAuthn/biometric, deep linking, image optimization/CDN.
- Health dashboard UI khusus (endpoint health & metrics sudah ada).

---

## BATCH ADD-ON ACCURATE (2026-10-27)

| No | Item | Status |
|---|---|---|
| 1 | Multi-company / pilih DB Accurate | ✅ Switcher di drawer + konfirmasi + badge perusahaan; backend provision tenant/user/connection |
| 2 | Monitoring & reconciliation Accurate | ✅ Tab Sistem: koneksi, token expiry, sync terakhir, webhook 24 jam, wallet, AI usage, tombol rekonsiliasi |
| 3 | Permission parity + audit akses AI | ✅ Audit tab filter action (`tool.call`) + tenant + user |
| 4 | Health dashboard UI | ✅ Health check DB/AI/Google/Accurate + metrik runtime |
| 5 | Audit log export | ✅ Export CSV (dengan proteksi CSV injection) |
| 6 | Riwayat invoice billing add-on | ✅ Tabel riwayat + download PDF + kirim email |
| 7 | Recurring billing add-on | ⚠️ Partial — setting auto-renew + pengingat/invoice link; auto-charge tetap butuh Midtrans Subscription |
| 8 | Sentry | ⏸️ Ditunda / dihapus dari batch |
| 9 | WAF / Cloudflare | ⏳ Pending (infra) |
| 10 | Security hardening | ✅ Secret scan CI (TruffleHog) + cookie `__Host-` di HTTPS (fallback dev/test) |

Catatan tambahan:
- Switch perusahaan menyalin hash password lokal agar tidak meminta set-password ulang.
- Data tenant lama tidak dihapus; semua data tenant-scoped berganti (Accurate, chat, Drive, WA, pesanan, saldo, langganan).
- `__Host-` hanya aktif saat `APP_ORIGIN` HTTPS; test/dev tetap memakai `sid`/`psid`.

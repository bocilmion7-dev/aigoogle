# Rencana pemanfaatan webhook Accurate (sebelum implementasi)

Status sebelum implementasi:
- Receiver webhook sudah terpasang (`POST /webhook` + `x-app-key` verification, App Key terdaftar)
- Log tersimpan di `AccurateWebhookEvent` (endpoint riwayat admin sudah ada)
- **Belum ada yang memanfaatkannya** — belum ada push asli dari Accurate yang masuk

Rencana fitur yang akan diimplementasi:
1. **Activity feed** — render `AccurateWebhookEvent` sebagai "Aktivitas terbaru" di dashboard
2. **Notifikasi WhatsApp** — kirim notifikasi per event pilihan (`webhookFollow` config per tenant, rate-limit + dedup)
3. **Invalidasi cache** — hapus cache key terkait saat event masuk (CUSTOMER → `customer:*`, dll)

Target:
- Push asli Accurate masuk dulu (uji push via perubahan data di Accurate) untuk melihat format payload asli
- Setelah format jelas, langkah 1–3 diimplementasi

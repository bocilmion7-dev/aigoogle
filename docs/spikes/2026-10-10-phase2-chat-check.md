# Hasil Smoke Fase 2 — Chat AI + Voice (2026-10-10)

Skrip: `/tmp/opencode/e2e-smoke-phase2.sh` (3 proses: mock :4010 + API :3001 + web :5173) — **11/11 PASS** dengan **Gemini asli** (key pemilik, model `gemini-3.6-flash`).

| Butir | Hasil | Catatan |
|---|---|---|
| Launch → authorize mock → callback → sid cookie | ✓ | Launch kini juga memanggil `openDb` (host+session tersimpan di Connection) |
| `/api/me` tenant PT Maju Jaya | ✓ | Role admin; permission modul ter-seed dari capabilityCatalog |
| Chat live: tool `customer.list` dipanggil | ✓ | 1× generate → functionCall; 1× generate lanjutan → teks |
| Jawaban menyebut data mock "Budi" | ✓ | Bukti tool result masuk ke konteks model |
| Event `done` NDJSON | ✓ | `messageId` terisi |
| `GET /api/chat/sessions` JSON array | ✓ | Persistensi ChatSession/ChatMessage (Neon) |
| `POST /api/tts` → audio/wav > 1KB | ✓ | Model `gemini-3.8-flash-tts`, responseModalities AUDIO (tanpa speechConfig) |
| `POST /api/stt` wav senyap → `{"text":""}` | ✓ | Model `gemini-3.5-transcribe` — TIDAK mengarang (flash multimodal pernah mengarang; jangan dipakai) |

## Catatan pengembangan
- **Kuota Gemini free tier:** 20 request/hari/model (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`). `gemini-3.8-flash` habis saat pengembangan (reset ~14 jam); default pindah ke `gemini-3.6-flash` (bucket terpisah, function calling terverifikasi). Production berbayar perlu billing aktif di Google AI Studio.
- **503 high demand** sering → client retry 3× backoff 1.5/3/6 dtk; test live pakai `withRetry` + skip bila outage.
- **Bug penting yang ditemukan & diperbaiki:** functionCall + functionResponse harus **turn terpisah** (`contents: [{role,parts}]`), bukan satu turn berisi semua part — kalau digabung Gemini balas 400.
- **Multi-turn:** hasil tool dibungkus object (`{items: [...]}` bila array) di `functionResponse.response`.
- Smoke perlu memastikan port 3001/4010/5173 bersih sebelum start (proses lama → EADDRINUSE, smoke gagal palsu).

## Uji manual voice (browser)
1. Login via `http://localhost:5173/api/launch?dbId=1001`.
2. Settings → pilih engine voice (Web Speech = butuh Chrome/Edge; Gemini native = rekam via MediaRecorder → `/api/stt`, jawaban diucap via `/api/tts`).
3. Halaman `/app` → ketik pertanyaan, badge tool muncul saat data diambil.

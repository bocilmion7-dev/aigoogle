# Eval bench 509 soal (akurasi chat akuntansi)

Harness ini menguji jawaban chat terhadap 509 pertanyaan ber-GT (`questions500.json`).

```bash
# 1) siapkan sesi login (cookie sid) ke file
echo "<nilai cookie sid>" > eval/.sid

# 2) jalankan
pnpm eval                        # semua 509 soal
LIMIT=50 pnpm eval               # 50 soal pertama
RERUN=52,85,128 pnpm eval        # ulang soal tertentu (1-based)
START=101 LIMIT=50 pnpm eval     # lanjut dari soal ke-101
```

Hasil: `eval/results/bench500.json` + `.md` (kolom: q, answer, tools, correct, fails, ttft, total, err).

Env opsional: `EVAL_API` (default http://127.0.0.1:3001), `EVAL_SID`, `EVAL_SID_FILE`,
`EVAL_QUESTIONS`, `EVAL_OUT`, `EVAL_TTFT_LIMIT` (default 25 dtk), `LABEL`.

Catatan: jalankan bertahap (LIMIT=50) agar kuota LLM tidak habis sekaligus.

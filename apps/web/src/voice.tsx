import { getSettings } from "./api";

let currentAudio: HTMLAudioElement | null = null;

/** Putar blob audio; promise selesai saat pemutaran berakhir (dipakai mode voice). */
function playBlob(blob: Blob): Promise<void> {
  currentAudio?.pause();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  currentAudio = audio;
  return new Promise<void>((resolve) => {
    const done = () => {
      URL.revokeObjectURL(url);
      if (currentAudio === audio) currentAudio = null;
      resolve();
    };
    audio.onended = done;
    audio.onerror = done;
    audio.play().catch(done);
  });
}

/** TTS neural Edge (server, gratis) — menunggu sampai suara selesai. */
export async function ttsEdge(text: string): Promise<void> {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error("gagal sintesis suara Edge");
  await playBlob(await res.blob());
}

/** Batalkan semua suara yg sedang diputar (Web Speech & Audio element). */
export function stopSpeak(): void {
  window.speechSynthesis?.cancel();
  currentAudio?.pause();
  currentAudio = null;
}

/**
 * STT via Web Speech (browser) — diproses lokal/di server browser, tidak dikirim ke AI.
 * onend/error/timeout selalu menyelesaikan promise supaya tombol mic tidak macet.
 * onAbort dipanggil utk membatalkan dari luar (klik mic lagi).
 */
export function sttWebSpeech(onAbort?: (fn: () => void) => void): Promise<string> {
  const SR = (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognition })
    .webkitSpeechRecognition;
  if (!SR) return Promise.reject(new Error("browser_ini_belum_mendukung_web_speech"));
  const rec = new SR();
  rec.lang = "id-ID";
  rec.continuous = true;
  rec.interimResults = false;
  return new Promise<string>((resolve, reject) => {
    let finalText = "";
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    // batas 45 dtk — cegah listening tanpa henti
    const timer = setTimeout(() => {
      rec.stop();
      settle(finalText.trim() ? () => resolve(finalText.trim()) : () => reject(new Error("stt_timeout")));
    }, 45_000);
    onAbort?.(() => {
      rec.abort();
      settle(() => reject(new Error("stt_batal")));
    });
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
      }
    };
    rec.onerror = (ev) => {
      const err = ev?.error;
      settle(() =>
        reject(
          new Error(
            err === "not-allowed" || err === "service-not-allowed"
              ? "stt_mikrofon_ditolak"
              : err === "no-speech"
                ? "stt_tidak_mendengar_suara"
                : "stt_gagal"
          )
        )
      );
    };
    rec.onend = () => {
      settle(finalText.trim() ? () => resolve(finalText.trim()) : () => reject(new Error("stt_kosong")));
    };
    try {
      rec.start();
    } catch {
      settle(() => reject(new Error("stt_gagal")));
    }
  });
}

/**
 * Ubah blok tabel markdown menjadi kalimat lisan per baris:
 * | Pelanggan | Total | → "Pelanggan: Abadi, Total: Rp1.000."
 * Kolom "#" (nomor urut) dibuang — tidak berguna saat dibacakan.
 */
function tablesToSentences(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  const isSep = (c: string) => /^:?-{2,}:?$/.test(c.trim()) || c.trim() === "";
  let i = 0;
  while (i < lines.length) {
    if (/^\s*\|.*\|\s*$/.test(lines[i])) {
      const block: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        block.push(
          lines[i]
            .trim()
            .replace(/^\||\|$/g, "")
            .split("|")
            .map((c) => c.trim())
        );
        i++;
      }
      // baris pertama = header (bila bukan pemisah ---)
      const head = !isSep(block[0].join("")) ? block[0] : [];
      const rows = block.filter((r, ri) => ri > 0 && !r.every(isSep));
      const parts: string[] = [];
      for (const r of rows) {
        const segs: string[] = [];
        for (let ci = 0; ci < r.length; ci++) {
          const val = r[ci].replace(/\*\*/g, "");
          if (!val || head[ci]?.replace(/\*/g, "") === "#") continue;
          segs.push(head[ci] ? `${head[ci].replace(/\*/g, "")}: ${val}` : val);
        }
        if (segs.length) parts.push(segs.join(", "));
      }
      if (parts.length) out.push(parts.join(". "));
      continue;
    }
    out.push(lines[i]);
    i++;
  }
  return out.join("\n");
}

/**
 * Bersihkan teks sebelum dibacakan TTS — tabel jadi kalimat, buang tanda baca &
 * simbol/emoji agar suara clear (tidak membaca "bintang", "pagar", "strip" dsb).
 */
export function cleanSpeech(text: string): string {
  return text
    .replace(/^>\s?/gm, "")
    // tautan markdown → teks + kata "tautan", jangan sampai menempel jadi satu kata
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, "$1 tautan")
    .replace(/https?:\/\/\S+/g, " tautan")
    // bullet di awal baris ("- ", "• ", "* ") dibuang agar tidak dibacakan "strip"
    .replace(/^[\s]*[•▪▫◦·*-]\s+/gm, "")
    .replace(/[*_#`~^|\\<>\[\](){}]/g, "")
    .replace(
      /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{2B00}-\u{2BFF}]/gu,
      " "
    )
    .replace(/[•▪▫◦·]/g, " ")
    .replace(/[—–−]/g, " ")
    // baris baru → jeda kalimat (hindari kalimat berderet tanpa jeda)
    .replace(/\n+/g, ". ")
    .replace(/\.{2,}/g, ".")
    .replace(/,{2,}/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

let resumeTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Teks siap diucapkan — dipakai SEMUA engine TTS (Web Speech & Edge) supaya
 * tabel jadi kalimat lisan & simbol/markdown tidak ikut dibacakan.
 */
export function toSpokenText(text: string): string {
  return cleanSpeech(tablesToSentences(text));
}

function utterance(text: string): SpeechSynthesisUtterance {
  const u = new SpeechSynthesisUtterance(toSpokenText(text));
  u.lang = "id-ID";
  const idVoice = window.speechSynthesis?.getVoices().find((v) => v.lang?.toLowerCase().startsWith("id"));
  if (idVoice) u.voice = idVoice;
  return u;
}

function startResumeKeeper(u: SpeechSynthesisUtterance, done: () => void): void {
  const synth = window.speechSynthesis;
  if (!synth) return;
  const clear = () => {
    if (resumeTimer) {
      clearInterval(resumeTimer);
      resumeTimer = null;
    }
  };
  u.onend = clear;
  u.onerror = clear;
  u.onend = () => {
    clear();
    done();
  };
  u.onerror = () => {
    clear();
    done();
  };
  // Chrome menghentikan speechSynthesis utk teks panjang (~15 dtk) — resume berkala
  if (resumeTimer) clearInterval(resumeTimer);
  resumeTimer = setInterval(() => {
    if (synth.speaking && !synth.paused) synth.resume();
  }, 10_000);
}

export function speakWeb(text: string): void {
  const synth = window.speechSynthesis;
  if (!synth) return;
  synth.cancel();
  const u = utterance(text);
  startResumeKeeper(u, () => {});
  synth.speak(u);
}

/** speakWeb tapi menunggu selesai — dipakai mode voice supaya mic aktif lagi setelah AI selesai bicara. */
export function speakWebAsync(text: string): Promise<void> {
  const synth = window.speechSynthesis;
  if (!synth) return Promise.resolve();
  synth.cancel();
  return new Promise<void>((resolve) => {
    const u = utterance(text);
    startResumeKeeper(u, resolve);
    synth.speak(u);
  });
}

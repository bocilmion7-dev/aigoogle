import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * OCR lokal (tesseract CLI, bahasa Indonesia + Inggris).
 * Tersedia → teks hasil OCR dipakai lebih dulu (tanpa biaya AI);
 * gagal/tidak terpasang → string kosong, pemanggil lanjut ke vision.
 */
const MAX_TEXT = 12_000;

function run(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

/** apakah OCR lokal tersedia di server ini */
export async function ocrAvailable(): Promise<boolean> {
  try {
    await run("tesseract", ["--version"], 5_000);
    return true;
  } catch {
    return false;
  }
}

/** OCR gambar → teks ("" bila gagal) */
export async function ocrImage(buffer: Buffer, ext = "jpg"): Promise<string> {
  let dir: string | null = null;
  try {
    dir = await mkdtemp(join(tmpdir(), "aigoogle-ocr-"));
    const file = join(dir, `dokumen.${ext.replace(/[^a-z0-9]/gi, "") || "jpg"}`);
    await writeFile(file, buffer);
    const text = await run(
      "tesseract",
      [file, "stdout", "-l", "ind+eng", "--psm", "6", "--oem", "1"],
      60_000
    );
    return text.replace(/\u0000/g, "").trim().slice(0, MAX_TEXT);
  } catch {
    return "";
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => null);
  }
}

/** teks OCR cukup berarti (bukan bercak/noise) */
export function ocrUsable(text: string): boolean {
  const alnum = text.replace(/[^a-zA-Z0-9]/g, "").length;
  return alnum >= 25;
}

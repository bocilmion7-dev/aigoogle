import { withModelFailover } from "../ai/model-pool.js";
import { LlmHttpError } from "../ai/llm-error.js";

export const CATEGORIES = ["Faktur", "Kuitansi", "Nota", "Surat Jalan", "Lainnya"] as const;
export type Category = (typeof CATEGORIES)[number];

const RULES: Array<[Category, RegExp]> = [
  ["Faktur", /\bfaktur\b|\binvoice\b/i],
  ["Kuitansi", /\bkuitansi\b|\breceipt\b/i],
  ["Nota", /\bnota\b|\btunai\b|\bcash\b/i],
  ["Surat Jalan", /\bsurat[\s-]jalan\b|\bdelivery\b|\bdo\b/i],
];

export function classifyText(text: string): Category {
  for (const [cat, re] of RULES) if (re.test(text)) return cat;
  return "Lainnya";
}

export function categoryFolderName(cat: Category): string {
  return cat;
}

export function classifyFileName(name: string): Category {
  return classifyText(name);
}

const VISION_OK = /^(application\/pdf|image\/)/i;

/** Batasi waktu tunggu AI — provider yang lambat/mati tidak boleh menggantung proses rapikan. */
const AI_TIMEOUT_MS = 12_000;
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new LlmHttpError(504, "model AI timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/** Klasifikasi dokumen via model AI; preferredModel = setting modul "drive". Gagal → aturan lokal. */
export async function classifyFile(
  text: string,
  mimeType: string,
  fileName = "",
  mediaBase64?: string,
  preferredModel?: string
): Promise<Category> {
  const fallback = () => (fileName ? classifyFileName(fileName) : classifyText(text));
  if (!VISION_OK.test(mimeType)) return fallback();
  try {
    const prompt =
      `Klasifikasi dokumen ini ke salah satu: ${CATEGORIES.join(", ")}. Balas HANYA kata kategorinya.` +
      (fileName ? ` Nama file: ${fileName}` : "");
    const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = mediaBase64
      ? [{ inlineData: { mimeType, data: mediaBase64 } }, { text: prompt }]
      : [{ text: `${prompt}\n\n${text.slice(0, 1500)}` }];
    const raw = await withTimeout(
      withModelFailover(
        "generate",
        async (c) => {
          const { parts: out } = await c.client.generate({
            contents: [{ role: "user", parts }],
            model: c.model,
          });
          const t = out.find((p) => p.text)?.text ?? "";
          if (!t.trim()) throw new LlmHttpError(502, "model tidak mengembalikan teks");
          return t.trim();
        },
        preferredModel || undefined
      ),
      AI_TIMEOUT_MS
    );
    const hit = CATEGORIES.find((c) => c.toLowerCase() === raw.toLowerCase());
    return hit ?? fallback();
  } catch {
    return fallback();
  }
}

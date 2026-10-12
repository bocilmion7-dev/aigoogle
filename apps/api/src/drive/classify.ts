import { withModelFailover } from "../ai/model-pool.js";
import { GeminiHttpError } from "../ai/gemini-error.js";

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

export async function classifyWithGemini(
  text: string,
  mimeType: string,
  apiKey: string,
  fileName = "",
  mediaBase64?: string
): Promise<Category> {
  const fallback = () => (fileName ? classifyFileName(fileName) : classifyText(text));
  if (!apiKey || !VISION_OK.test(mimeType)) return fallback();
  try {
    const prompt =
      `Klasifikasi dokumen ini ke salah satu: ${CATEGORIES.join(", ")}. Balas HANYA kata kategorinya.` +
      (fileName ? ` Nama file: ${fileName}` : "");
    const parts: Array<Record<string, unknown>> = mediaBase64
      ? [{ inlineData: { mimeType, data: mediaBase64 } }, { text: prompt }]
      : [{ text: `${prompt}\n\n${text.slice(0, 1500)}` }];
    const j = await withModelFailover("generate", async (model) => {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts }],
          }),
        }
      );
      if (!res.ok) throw new GeminiHttpError(res.status, await res.text().catch(() => ""));
      return (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    });
    const raw = (j.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim();
    const hit = CATEGORIES.find((c) => c.toLowerCase() === raw.toLowerCase());
    return hit ?? fallback();
  } catch {
    return fallback();
  }
}

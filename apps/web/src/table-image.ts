/**
 * Ekspor tabel data chat menjadi GAMBAR PNG (tanpa dependensi eksternal).
 *
 * Warna/ukuran diambil dari elemen tabel yang SEDANG TAMPIL (computed style),
 * jadi hasil gambar persis seperti aslinya — termasuk tema terang/gelap, warna
 * tautan, header, dan border.
 *
 * Cara kerja: clone <table> → inline semua computed style yang relevan →
 * bungkus dengan latar permukaan modal → render lewat <foreignObject> di SVG →
 * gambar ke <canvas> (skala 2× agar tajam) → PNG blob.
 */

/** properti yang ikut disalin agar tampilan clone identik dengan aslinya */
const STYLE_PROPS = [
  "color",
  "background-color",
  "background-image",
  "border-top",
  "border-right",
  "border-bottom",
  "border-left",
  "border-collapse",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-transform",
  "text-decoration-line",
  "text-decoration-color",
  "vertical-align",
  "white-space",
  "word-break",
  "font-variant-numeric",
  "opacity",
] as const;

/** salin computed style dari node asli ke clone (rekursif, struktur sama) */
function inlineStyles(src: Element, dst: Element): void {
  const cs = getComputedStyle(src);
  const style = (dst as HTMLElement).style;
  for (const p of STYLE_PROPS) {
    const v = cs.getPropertyValue(p);
    if (v) style.setProperty(p, v);
  }
  const srcKids = Array.from(src.children);
  const dstKids = Array.from(dst.children);
  for (let i = 0; i < srcKids.length && i < dstKids.length; i++) {
    inlineStyles(srcKids[i]!, dstKids[i]!);
  }
}

/** latar belakang efektif (naik ke leluhur terdekat yang tidak transparan) */
function surfaceBackground(el: Element): string {
  let cur: Element | null = el;
  while (cur) {
    const bg = getComputedStyle(cur).backgroundColor;
    if (bg && bg !== "transparent" && !/rgba\(0, 0, 0, 0\)/.test(bg)) return bg;
    cur = cur.parentElement;
  }
  return "#ffffff";
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "sync";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("gagal memuat gambar tabel"));
    img.src = src;
  });
}

/** Ukur tinggi wrapper di luar layar (lebar sudah dipatok). */
function measure(wrap: HTMLElement): number {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none";
  host.appendChild(wrap);
  document.body.appendChild(host);
  const h = Math.ceil(wrap.getBoundingClientRect().height);
  host.remove();
  return h;
}

export async function tableToPngBlob(tableEl: HTMLElement): Promise<Blob> {
  const tableW = Math.max(240, Math.ceil(tableEl.getBoundingClientRect().width));
  const clone = tableEl.cloneNode(true) as HTMLElement;
  inlineStyles(tableEl, clone);
  // lebar dipatok agar hasil gambar tidak mengecil mengikuti wrapper
  clone.style.setProperty("width", `${tableW}px`);
  clone.style.setProperty("min-width", `${tableW}px`);

  const bg = surfaceBackground(tableEl);
  const pad = 20;
  const wrap = document.createElement("div");
  wrap.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  wrap.style.cssText =
    `box-sizing:border-box;display:inline-block;padding:${pad}px;background:${bg};` +
    `width:${tableW + pad * 2}px`;
  wrap.appendChild(clone);

  const width = tableW + pad * 2;
  const height = Math.max(80, measure(wrap));
  // batasi dimensi canvas (Safari/Chrome punya batas ~16k px)
  const scale = Math.min(2, Math.max(1, 16000 / Math.max(width, height)));
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<foreignObject width="${width}" height="${height}">${wrap.outerHTML}</foreignObject></svg>`;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const img = await loadImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas tidak tersedia");
  ctx.scale(scale, scale);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("gagal membuat PNG");
  return blob;
}

export type ShareResult = "shared" | "downloaded";

/**
 * Bagikan tabel sebagai gambar. `share` memakai Web Share API (sheet share HP →
 * WhatsApp dll); bila tak didukung / dibatalkan pengguna → fallback unduh.
 */
export async function shareTableImage(tableEl: HTMLElement, mode: "share" | "download"): Promise<ShareResult> {
  const blob = await tableToPngBlob(tableEl);
  const name = `tabel-ai-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`;
  const file = new File([blob], name, { type: "image/png" });
  if (mode === "share" && typeof navigator.share === "function" && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: "Tabel data" });
    return "shared";
  }
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
  return "downloaded";
}

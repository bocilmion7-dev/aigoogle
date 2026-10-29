import type { StorefrontMode } from "./storefront-api";

export interface StorefrontTemplateMeta {
  key: string;
  name: string;
  description: string;
  /** Template dengan depth/glass/elevation, bukan flat. */
  depth?: boolean;
}

export const STOREFRONT_TEMPLATES: Record<StorefrontMode, StorefrontTemplateMeta[]> = {
  product: [
    {
      key: "product-1",
      name: "Showcase",
      description: "Hero banner besar + sorotan produk unggulan + grid katalog 4 kolom.",
    },
    {
      key: "product-2",
      name: "Editorial Split",
      description: "Banner full-width, kartu produk horizontal, dan layout ala majalah.",
    },
    {
      key: "product-3",
      name: "Market Dense",
      description: "Header ringkas, banner strip, katalog padat 5 kolom untuk banyak SKU.",
    },
    {
      key: "product-4",
      name: "Aurora Glass",
      description: "Kartu kaca berlapis, gradasi lembut, dan bayangan dalam. Template non-flat.",
      depth: true,
    },
  ],
  service: [
    {
      key: "service-1",
      name: "Consultation",
      description: "Hero terbelah, daftar layanan horizontal, CTA konsultasi menonjol.",
    },
    {
      key: "service-2",
      name: "Studio Profile",
      description: "Banner profil, blok tentang studio, dan grid layanan dua kolom.",
    },
    {
      key: "service-3",
      name: "Minimal Index",
      description: "Tipografi editorial, daftar layanan bernomor, tanpa distraksi visual.",
    },
    {
      key: "service-4",
      name: "Halo Depth",
      description: "Panel kaca, gradasi lembut, dan kartu layanan mengambang. Non-flat.",
      depth: true,
    },
  ],
};

export interface StorefrontThemeMeta {
  key: string;
  name: string;
  colors: [string, string, string];
}

export const STOREFRONT_THEMES: StorefrontThemeMeta[] = [
  { key: "warm", name: "Warm", colors: ["#fffdf9", "#b91c1c", "#201812"] },
  { key: "forest", name: "Forest", colors: ["#f5f7f2", "#2f6b4f", "#17251d"] },
  { key: "ocean", name: "Ocean", colors: ["#f3f8fb", "#1d6f8f", "#102732"] },
  { key: "mono", name: "Mono", colors: ["#f6f6f4", "#181818", "#f6f6f4"] },
  { key: "berry", name: "Berry", colors: ["#fbf5f7", "#a12b5b", "#2b1420"] },
  { key: "sunset", name: "Sunset", colors: ["#fff8f0", "#c2571f", "#2a1710"] },
];

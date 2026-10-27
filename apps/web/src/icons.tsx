import type { ComponentType, ReactNode } from "react";

/**
 * Ikon garis (stroke) — sapuan 1.75, ujung bulat (round), tanpa emoji.
 * Semua ikon memakai currentColor agar mengikuti warna teks di sekitarnya.
 */
interface IconProps {
  size?: number;
}

function Base({ size = 20, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const IconHome: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    <path d="M3 9.5 12 2.5l9 7V20a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 20z" />
    <path d="M9 21.5V13h6v8.5" />
  </Base>
);

export const IconActivity: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
  </Base>
);

export const IconCompass: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="m15.5 8.5-2 5-5 2 2-5z" />
  </Base>
);

export const IconChat: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    <path d="M20.5 11.8a8.5 8.5 0 0 1-8.5 8.5 8.9 8.9 0 0 1-3.9-.9L3.5 21l1.6-4.6A8.5 8.5 0 1 1 20.5 11.8z" />
  </Base>
);

export const IconUsers: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    <path d="M15.5 20.5v-1.7a3.8 3.8 0 0 0-3.8-3.8H6.3a3.8 3.8 0 0 0-3.8 3.8v1.7" />
    <circle cx="9" cy="7.5" r="3.7" />
    <path d="M21.5 20.5v-1.7a3.8 3.8 0 0 0-2.9-3.7" />
    <path d="M15.8 4a3.7 3.7 0 0 1 0 7.1" />
  </Base>
);

export const IconScan: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    <path d="M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8" />
    <path d="M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8" />
    <path d="M21 16v2.5a2.5 2.5 0 0 1-2.5 2.5H16" />
    <path d="M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16" />
    <path d="M3.5 12h17" />
  </Base>
);

export const IconSettings: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    <path d="M20 7h-9" />
    <path d="M14 17H4" />
    <circle cx="17" cy="17" r="3" />
    <circle cx="7" cy="7" r="3" />
  </Base>
);

export const IconCamera: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    <path d="M4 8h2.5l1.5-2h8l1.5 2H20a1.5 1.5 0 0 1 1.5 1.5V19A1.5 1.5 0 0 1 20 20.5H4A1.5 1.5 0 0 1 2.5 19V9.5A1.5 1.5 0 0 1 4 8z" />
    <circle cx="12" cy="14" r="3.5" />
  </Base>
);

export const IconSearch: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.35-4.35" />
  </Base>
);

export const IconPlus: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </Base>
);

export const IconUpload: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    <path d="M21 15v4a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19v-4" />
    <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
    <path d="M12 4v12" />
  </Base>
);

export const IconCheck: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    <path d="m4.5 12.5 5 5 10-11" />
  </Base>
);

export const IconLogout: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
  </Base>
);

export const IconCpu: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    <rect x="7" y="7" width="10" height="10" rx="1.5" />
    <rect x="4" y="4" width="16" height="16" rx="2.5" />
    <path d="M9 1.5v2.5M15 1.5v2.5M9 20v2.5M15 20v2.5M1.5 9H4M1.5 15H4M20 9h2.5M20 15h2.5" />
  </Base>
);

export const IconSliders: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
    <path d="M1 14h6M9 8h6M17 16h6" />
  </Base>
);

/* ---------- ikon WhatsApp / pembayaran ---------- */

export const IconQr: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    <rect x="3.5" y="3.5" width="6" height="6" rx="1" />
    <rect x="14.5" y="3.5" width="6" height="6" rx="1" />
    <rect x="3.5" y="14.5" width="6" height="6" rx="1" />
    <path d="M14.5 14.5h2.5v2.5h-2.5zM20.5 14.5v6M14.5 20.5h3" />
  </Base>
);

export const IconLink: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    <path d="M10 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 1 0-5.7-5.7L11.5 6.3" />
    <path d="M14 10.5a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 1 0 5.7 5.7l1.3-1.3" />
  </Base>
);

export const IconRefresh: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    <path d="M20.5 11a8.5 8.5 0 1 0-2.1 7.1" />
    <path d="M20.5 4.5V11H14" />
  </Base>
);

/** Buku — untuk dokumentasi/panduan. */
export const IconBook: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    <path d="M12 6.5C10.6 5.3 8.6 4.7 6.4 4.7H3.6a.9.9 0 0 0-.9.9v11.6c0 .5.4.9.9.9h2.8c2.2 0 4.2.6 5.6 1.8" />
    <path d="M12 6.5c1.4-1.2 3.4-1.8 5.6-1.8h2.8c.5 0 .9.4.9.9v11.6c0 .5-.4.9-.9.9h-2.8c-2.2 0-4.2.6-5.6 1.8" />
    <path d="M12 6.5v14" />
  </Base>
);

/** Bintang terisi — untuk rating/testimoni. */
export const IconStar: ComponentType<IconProps> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M12 2.6l2.9 5.88 6.49.95-4.7 4.58 1.11 6.46L12 17.42 6.2 20.47l1.11-6.46-4.7-4.58 6.49-.95z"
      fill="currentColor"
    />
  </svg>
);

export const IconMore: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    <circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none" />
  </Base>
);

export const IconPower: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    <path d="M12 3v9" />
    <path d="M6.4 6.4a8 8 0 1 0 11.2 0" />
  </Base>
);

export const IconWallet: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    <path d="M4 6.5h13A2.5 2.5 0 0 1 19.5 9v8A2.5 2.5 0 0 1 17 19.5H5A2.5 2.5 0 0 1 2.5 17V7A2.5 2.5 0 0 1 5 4.5h11" />
    <path d="M15.5 12h4" />
    <circle cx="17.5" cy="12" r=".8" />
  </Base>
);

/** Ikon dompet terisi: blok merah solid dengan glyph dompet putih. */
export const IconWalletBlock: ComponentType<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
  >
    <rect x="1.5" y="1.5" width="21" height="21" rx="5.5" fill="#dc2626" />
    <path
      d="M6.2 9.4h9.6A1.6 1.6 0 0 1 17.4 11v3.8a1.6 1.6 0 0 1-1.6 1.6H6.8A1.6 1.6 0 0 1 5.2 14.8V8.6A1.6 1.6 0 0 1 6.8 7h8.6"
      fill="none"
      stroke="#fff"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="15" cy="12.5" r="1.1" fill="#fff" />
  </svg>
);

export const IconBell: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </Base>
);

export const IconClock: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Base>
);

export const IconPackage: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    <path d="M12 3 3.5 7.5V17L12 21.5 20.5 17V7.5z" />
    <path d="m3.5 7.5 8.5 4 8.5-4M12 11.5v10" />
  </Base>
);

export const IconSend: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    <path d="M22 2 11 13" />
    <path d="M22 2 15 22 11 13 2 9z" />
  </Base>
);

export const IconCoin: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v10" />
    <path d="M9.5 9.3c0-1 .9-1.8 2.5-1.8s2.5.8 2.5 1.8-.9 1.5-2.5 1.8-2.5.8-2.5 1.8.9 1.8 2.5 1.8 2.5-.8 2.5-1.8" />
  </Base>
);

export const IconTrash: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    <path d="M4 7h16M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2" />
    <path d="M6.5 7l1 12.5A1.5 1.5 0 0 0 9 21h6a1.5 1.5 0 0 0 1.5-1.5L17.5 7" />
    <path d="M10 11v6M14 11v6" />
  </Base>
);

export const IconPhone: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.2a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2z" />
  </Base>
);

/* ---------- ikon pohon file (Explore Manager) ---------- */

export const IconFolder: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    <path d="M3.5 7A1.5 1.5 0 0 1 5 5.5h3.6a1.5 1.5 0 0 1 1.2.6l1 1.4H19a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19.5H5a1.5 1.5 0 0 1-1.5-1.5z" />
  </Base>
);

export const IconArrowLeft: ComponentType<IconProps> = ({ size }) => (  <Base size={size}>
    <path d="M19 12H5" />
    <path d="m12 19-7-7 7-7" />
  </Base>
);

export const IconChevron: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    <path d="m9.5 6 6 6-6 6" />
  </Base>
);

const PAGE = (
  <>
    <path d="M14 3.5H7.5A1.5 1.5 0 0 0 6 5v14a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 19V7.5z" />
    <path d="M14 3.5V7.5H18" />
  </>
);

export const IconFile: ComponentType<IconProps> = ({ size }) => <Base size={size}>{PAGE}</Base>;

export const IconFilePdf: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    {PAGE}
    <path d="M8.5 12.5h7M8.5 15.5h4" />
    <circle cx="15" cy="15.5" r="1" />
  </Base>
);

export const IconFileImage: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    {PAGE}
    <circle cx="10" cy="11.5" r="1.2" />
    <path d="m7.5 17.5 3-3 2 2 2.5-2.5 2.5 3.5z" />
  </Base>
);

export const IconFileSheet: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    {PAGE}
    <path d="M8.5 11h7M8.5 14.5h7M11 11v6.5M14 11v6.5" />
  </Base>
);

export const IconFileText: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    {PAGE}
    <path d="M8.5 12.5h7" />
    <path d="M8.5 15.5h5" />
  </Base>
);

export const IconFileSlides: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    <rect x="3.5" y="4.5" width="17" height="12" rx="1.5" />
    <path d="M12 16.5v2.5M8.5 20.5h7" />
  </Base>
);

export const IconFileVideo: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    {PAGE}
    <path d="m10.5 11.5 4.5 2.5-4.5 2.5z" />
  </Base>
);

export const IconFileAudio: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    {PAGE}
    <path d="M11 16.5v-5l4-1v5" />
    <circle cx="9.8" cy="16.8" r="1.3" />
    <circle cx="13.8" cy="15.3" r="1.3" />
  </Base>
);

export const IconFileArchive: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    <rect x="4.5" y="4" width="15" height="16" rx="1.5" />
    <rect x="10.5" y="4" width="3" height="2.5" rx="0.5" />
    <path d="M12 9.5v2M12 13.5v2" />
    <path d="M10.5 17.5h3" />
  </Base>
);

export const IconFileCode: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    {PAGE}
    <path d="m9.5 11.5-2 2 2 2M14.5 11.5l2 2-2 2" />
  </Base>
);

/** Ikon per tipe file (mimeType Google Drive) — fallback ikon file generik. */
export function fileIconFor(mimeType: string): ComponentType<IconProps> {
  const m = mimeType.toLowerCase();
  if (m === "application/pdf") return IconFilePdf;
  if (m.startsWith("image/")) return IconFileImage;
  if (m.startsWith("video/")) return IconFileVideo;
  if (m.startsWith("audio/")) return IconFileAudio;
  if (
    m.includes("spreadsheet") ||
    m.includes("excel") ||
    m === "text/csv"
  )
    return IconFileSheet;
  if (m.includes("presentation") || m.includes("powerpoint")) return IconFileSlides;
  if (m.includes("word") || m === "application/vnd.google-apps.document" || m.startsWith("text/"))
    return IconFileText;
  if (m.includes("zip") || m.includes("rar") || m.includes("tar") || m.includes("compress") || m.includes("7z"))
    return IconFileArchive;
  if (m.includes("json") || m.includes("javascript") || m.includes("xml") || m.includes("python") || m.includes("shell"))
    return IconFileCode;
  return IconFile;
}

export const IconShare: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
  </Base>
);

export const IconDownload: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    <path d="M12 3v12" />
    <path d="M7 10l5 5 5-5" />
    <path d="M4 21h16" />
  </Base>
);

export const IconNews: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    <path d="M4 5h13a2 2 0 0 1 2 2v11a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2z" />
    <path d="M8 9h7M8 13h7M8 17h4" />
  </Base>
);

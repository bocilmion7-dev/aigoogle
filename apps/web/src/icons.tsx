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

/* ---------- ikon pohon file (Explore Manager) ---------- */

export const IconFolder: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    <path d="M3.5 7A1.5 1.5 0 0 1 5 5.5h3.6a1.5 1.5 0 0 1 1.2.6l1 1.4H19a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19.5H5a1.5 1.5 0 0 1-1.5-1.5z" />
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

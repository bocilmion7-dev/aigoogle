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

export const IconFileText: ComponentType<IconProps> = ({ size }) => (
  <Base size={size}>
    <path d="M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5z" />
    <path d="M14 3v4.5h4.5" />
    <path d="M8.5 13h7" />
    <path d="M8.5 16.5h5" />
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

declare interface SpeechRecognition {
  lang: string;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  start(): void;
}

declare module "360dialog-connect-button/dist/dialog-connect-button.esm.js" {
  import type { ComponentType } from "react";
  export const ConnectButton: ComponentType<{
    partnerId: string;
    label?: string;
    callback: (cb: { client: string; channels: string[]; revokedChannels?: string[] }) => void;
    requestedNumber?: string;
    version?: "v1" | "v2";
    useNewRedirect?: boolean;
  }>;
}

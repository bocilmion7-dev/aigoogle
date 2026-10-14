declare interface SpeechRecognitionAlternative {
  transcript: string;
  isFinal: boolean;
}

declare interface SpeechRecognitionResult extends Array<SpeechRecognitionAlternative> {
  isFinal: boolean;
}

declare interface SpeechRecognitionResultList extends Array<SpeechRecognitionResult> {
  [index: number]: SpeechRecognitionResult;
}

declare interface SpeechRecognitionEvent {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

declare interface SpeechRecognitionErrorEvent {
  error?: string;
  message?: string;
}

declare interface SpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onabort: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

declare module "360dialog-connect-button/dist/dialog-connect-button.esm.js" {
  import type { ComponentType } from "react";
  export const ConnectButton: ComponentType<{
    partnerId: string;
    label?: string;
    callback: (cb: { client: string; channels: string[]; revoked?: boolean }) => void;
    requestedNumber?: string;
    version?: "v1" | "v2";
    useNewRedirect?: boolean;
  }>;
}

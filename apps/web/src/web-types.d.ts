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


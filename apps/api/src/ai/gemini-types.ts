export interface GeminiFunctionCall {
  name: string;
  args: Record<string, unknown>;
  id?: string;
}
export interface GeminiPart {
  text?: string;
  functionCall?: GeminiFunctionCall;
  functionResponse?: { name: string; response: unknown; id?: string };
  inlineData?: { mimeType: string; data: string };
}
export interface ToolDecl {
  functionDeclarations: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
}
export interface GeminiContent {
  role?: "user" | "model";
  parts: GeminiPart[];
}
export type ModelAction = "generate" | "tts" | "stt";
export interface GenerateOpts {
  contents: GeminiContent[];
  tools?: ToolDecl[];
  system?: string;
  model?: string;
  /** ember failover: generate (default) | tts | stt */
  action?: ModelAction;
  responseModalities?: string[];
}

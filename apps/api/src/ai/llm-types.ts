export interface LLMFunctionCall {
  name: string;
  args: Record<string, unknown>;
  id?: string;
}
export interface LLMPart {
  text?: string;
  /** model thinking: penalaran internal — JANGAN ditampilkan ke pengguna */
  thought?: boolean;
  functionCall?: LLMFunctionCall;
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
export interface LLMContent {
  role?: "user" | "model";
  parts: LLMPart[];
}
export type ModelAction = "generate";
export interface GenerateOpts {
  contents: LLMContent[];
  tools?: ToolDecl[];
  system?: string;
  model?: string;
  responseModalities?: string[];
  /** batas waktu stream — bila fired, fetch/body read dibatalkan (cegah call menggantung). */
  signal?: AbortSignal;
}

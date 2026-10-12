export class GeminiHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "GeminiHttpError";
  }
}

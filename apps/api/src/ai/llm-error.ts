export class LlmHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "LlmHttpError";
  }
}

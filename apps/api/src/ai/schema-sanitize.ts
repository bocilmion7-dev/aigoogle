/** Endpoint OpenAI-compatible menolak field OpenAPI tambahan
 *  seperti `additionalProperties` — buang secara rekursif sebelum dikirim. */
export function sanitizeToolSchema<T>(schema: T): T {
  if (Array.isArray(schema)) return schema.map((x) => sanitizeToolSchema(x)) as unknown as T;
  if (schema && typeof schema === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
      if (k === "additionalProperties") continue;
      out[k] = sanitizeToolSchema(v);
    }
    return out as T;
  }
  return schema;
}

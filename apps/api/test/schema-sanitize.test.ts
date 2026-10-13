import { describe, expect, it } from "vitest";
import { sanitizeToolSchema } from "../src/ai/schema-sanitize.js";
import { ACCURATE_CATALOG } from "../src/providers/accounting/catalog.js";

describe("sanitizeToolSchema", () => {
  it("membuang additionalProperties secara rekursif (top-level, property, nested)", () => {
    const out = sanitizeToolSchema({
      type: "object",
      additionalProperties: true,
      properties: {
        filter: { type: "object", additionalProperties: true },
        arr: [{ type: "object", additionalProperties: true }],
      },
    });
    expect(JSON.stringify(out)).not.toContain("additionalProperties");
    expect(out).toMatchObject({
      type: "object",
      properties: { filter: { type: "object" }, arr: [{ type: "object" }] },
    });
  });

  it("skema seluruh katalog Accurate lolos tanpa additionalProperties", () => {
    for (const t of ACCURATE_CATALOG) {
      expect(JSON.stringify(sanitizeToolSchema(t.jsonSchema))).not.toContain("additionalProperties");
    }
  });
});

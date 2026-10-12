import type { ToolSpec } from "./types.js";
import { ACCURATE_MODULES, type ActionEntry } from "./accurate-paths.js";

const listProps = {
  fields: { type: "string", description: "Field yang ditampilkan, dipisah koma (contoh: id,name)" },
  keywords: { type: "string", description: "Kata kunci pencarian" },
  page: { type: "number", description: "Nomor halaman (default 1)" },
  pageSize: { type: "number", description: "Ukuran halaman (default 20)" },
  sort: { type: "string", description: 'Urutan "field|asc;field2|desc"' },
  filter: {
    type: "object",
    description: 'Filter per field: { "<field>": { "op": "EQUAL|CONTAIN|…", "value": … } }',
    additionalProperties: true,
  },
} as const;

const labelModul = (mod: string) => mod.replace(/[-/]/g, " ");

const spec = (mod: string, a: ActionEntry): ToolSpec => {
  const isRead = a.method === "GET";
  const verb =
    a.action === "list" ? "Daftar" : a.action === "detail" ? "Detail" : a.action.replace(/-/g, " ");
  return {
    name: a.tool,
    description: `${verb} ${labelModul(mod)}${isRead ? "" : ` (${a.method.toLowerCase()} ${a.action})`}`,
    jsonSchema: isRead
      ? a.action === "detail"
        ? { type: "object", properties: { id: { type: "string" } }, required: ["id"] }
        : { type: "object", properties: listProps }
      : a.action === "delete"
        ? { type: "object", properties: { id: { type: "string" } }, required: ["id"] }
        : { type: "object", properties: {}, additionalProperties: true },
    requiredPermission: a.permission,
    label: `${verb} ${labelModul(mod)}…`,
  };
};

export const ACCURATE_CATALOG: ToolSpec[] = Object.entries(ACCURATE_MODULES)
  .flatMap(([mod, acts]) => acts.map((a) => spec(mod, a)))
  .sort((x, y) => x.name.localeCompare(y.name));

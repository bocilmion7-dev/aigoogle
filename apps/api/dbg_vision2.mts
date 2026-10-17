import { RealNvidiaClient } from "./src/ai/nvidia.js";
import { env } from "./src/env.js";
import { readFileSync } from "node:fs";

const cli = new RealNvidiaClient(env.ROUTER_API_KEY, env.ROUTER_BASE_URL);
async function tryCall(label: string, contents: unknown) {
  try {
    const { parts } = await cli.generate({ contents: contents as never, model: "ocfree/mimo-v2.6-flash-free" });
    console.log(label, "OK:", JSON.stringify(parts).slice(0, 200));
  } catch (e) {
    console.log(label, "ERR:", (e instanceof Error ? e.message : String(e)).slice(0, 220));
  }
}

await tryCall("teks  :", [{ role: "user", parts: [{ text: "Balas HANYA JSON: {\"ok\":1}" }] }]);
const img = readFileSync("/tmp/opencode/nota.jpg");
await tryCall("gambar:", [{ role: "user", parts: [
  { inlineData: { mimeType: "image/jpeg", data: img.toString("base64") } },
  { text: "Balas HANYA JSON: {\"isi\":\"lihat singkat\"}" },
] }]);

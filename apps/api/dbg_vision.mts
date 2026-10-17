import { RealNvidiaClient } from "./src/ai/nvidia.js";
import { env } from "./src/env.js";
import { readFileSync } from "node:fs";

const img = readFileSync("/tmp/opencode/nota.jpg");
const contents = [{
  role: "user",
  parts: [
    { inlineData: { mimeType: "image/jpeg", data: img.toString("base64") } },
    { text: "Balas HANYA JSON: {\"ok\": true, \"isi\": \"apa yg kamu lihat singkat\"}" },
  ],
}];

console.log("== 9Router ==");
try {
  const c = new RealNvidiaClient(env.ROUTER_API_KEY, env.ROUTER_BASE_URL);
  const { parts } = await c.generate({ contents, model: "ocfree/mimo-v2.6-flash-free" });
  console.log("balasan:", JSON.stringify(parts).slice(0, 400));
} catch (e) { console.log("ERR:", e instanceof Error ? e.message.slice(0, 500) : e); }

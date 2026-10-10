import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    env: loadEnv("", resolve(process.cwd(), "../.."), ""),
  },
});

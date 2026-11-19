import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";

// Root is web/ no matter where vite is launched from (npm scripts run it from
// the repo root with --config web/vite.config.ts).
const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  plugins: [svelte({ configFile: fileURLToPath(new URL("svelte.config.js", import.meta.url)) })],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": "http://localhost:3090",
    },
  },
});

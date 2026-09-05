import { defineConfig } from "vite";
import { existsSync, readFileSync } from "node:fs";

// Build id from scripts/write-build-id.mjs (run by `npm run build`); "dev" otherwise.
const buildId = existsSync("build-id.json") ? JSON.parse(readFileSync("build-id.json", "utf8")).id : "dev";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});

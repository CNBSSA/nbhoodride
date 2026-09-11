import { defineConfig } from "vitest/config";
import path from "path";

// Minimal Vitest config — AH-064 seed.
//
// Why no jsdom: every test we care about right now is server-side logic
// (storage, migrations, webhooks, money math). UI tests will land when we
// start writing them; switch to environment: "jsdom" in that file's local
// config.
//
// Why no coverage thresholds yet: zero existing tests means any threshold
// would either be 0% (useless) or block the build instantly. Once a baseline
// is established (a few hundred lines covered), add e.g.
// coverage: { provider: "v8", lines: 60, statements: 60 } here.
// Client-side tests that need no DOM are named *.node.test.ts and run here;
// tests that touch window/sessionStorage (client/src/lib/pwaInstall.test.ts)
// wait for a jsdom environment.
export default defineConfig({
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "shared/**/*.test.ts", "client/src/**/*.node.test.ts", "scripts/**/*.test.mjs"],
    testTimeout: 15_000,
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
      "@": path.resolve(__dirname, "client/src"),
    },
  },
});

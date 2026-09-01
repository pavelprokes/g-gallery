import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // `scripts/` is included for the build-time helpers whose logic decides
    // whether something happens to the production database — those want a test
    // as much as anything under `src/` does.
    include: ["src/**/*.{test,spec}.{ts,tsx}", "scripts/**/*.{test,spec}.{ts,mts,mjs}"],
    globals: true,
  },
  resolve: {
    alias: {
      // The real package throws outside a React Server Component environment,
      // which would break unit tests of server-side modules.
      "server-only": fileURLToPath(new URL("./src/test/server-only-stub.ts", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});

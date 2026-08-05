import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // Default to a fast Node environment. Component tests can opt into jsdom
    // per-file with a `// @vitest-environment jsdom` comment once we add it.
    environment: "node",
    globals: true,
    // src/db/postgres.test.ts runs a real Postgres compiled to WASM. Its heap
    // is large enough that sharing a process with the rest of the suite aborts
    // V8 outright ("Fatal process out of memory: Zone"), and running it in
    // parallel with other files merely made that intermittent — three green
    // runs then a worker killed mid-test, which is the worst way for a suite
    // to behave.
    //
    // So: a process per file, one file at a time. It costs the whole suite a
    // few seconds and buys tests that run our real SQL against real Postgres
    // instead of a fake that would nod along to a misspelled column.
    pool: "forks",
    fileParallelism: false,
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "tests/**/*.{test,spec}.{ts,tsx}",
    ],
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.{test,spec}.{ts,tsx}", "src/app/**"],
    },
  },
});

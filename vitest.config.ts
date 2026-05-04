import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Crystallised /lib files use top-level `declare const df: {...}`
    // which Vite's TS transformer chokes on. Restrict tests to the
    // project's own tests/ tree so vitest never tries to import a
    // crystallised artefact.
    exclude: ["**/node_modules/**", "**/.snippet-cache/**", "**/.atlasfs/**"],
    testTimeout: 15_000,
  },
});

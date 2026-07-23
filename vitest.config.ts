import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Belt-and-suspenders alongside tsconfig.build.json excluding tests
    // from the build: even if dist/ contains a stale compiled build,
    // never let vitest pick up anything outside src/.
    include: ["src/**/*.test.ts"],
  },
});

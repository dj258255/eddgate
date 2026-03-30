import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/arch/**/*.test.ts"],
  },
});

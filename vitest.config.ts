import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  // tsconfig keeps JSX as "preserve" for Next; unit tests that render a component need the automatic runtime.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

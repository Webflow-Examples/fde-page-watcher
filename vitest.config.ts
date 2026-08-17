import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json's "@/*" path so route handlers (and anything
    // else importing via the "@/" alias) can be unit tested directly.
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    exclude: [...configDefaults.exclude, ".claude/**", ".delta/**"],
  },
});

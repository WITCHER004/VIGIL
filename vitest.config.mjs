import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      "server-only": path.resolve(__dirname, "./src/lib/__tests__/mock-server-only.ts"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});

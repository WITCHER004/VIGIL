// Prisma CLI configuration. A config file disables Prisma's implicit .env loading,
// so load it explicitly (no-op on Vercel, where env vars are injected).
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
});

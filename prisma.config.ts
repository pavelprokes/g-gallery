import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma 7: the CLI (migrate/introspect/studio) reads the DIRECT, non-pooled
// connection here — the Supabase session pooler (:5432). The runtime client
// gets the transaction pooler (:6543) via the PrismaPg adapter in src/lib/db.ts.
//
// DIRECT_URL is scoped runtime-only on Vercel (docs/VERCEL-ENV.md), so it's not
// present when `prisma generate` runs as part of `pnpm build` there. Read it
// directly (not via the `env()` helper) so a missing var doesn't crash config
// loading — `generate` never opens a connection, and the real `migrate deploy`
// against production always runs with DIRECT_URL exported locally, never on Vercel.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DIRECT_URL,
  },
  migrations: {
    seed: "npx tsx prisma/seed.ts",
  },
});

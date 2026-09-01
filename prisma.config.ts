import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma 7: the CLI (migrate/introspect/studio) reads the DIRECT, non-pooled
// connection here — the Supabase session pooler (:5432). The runtime client
// gets the transaction pooler (:6543) via the PrismaPg adapter in src/lib/db.ts.
//
// Read directly rather than through the `env()` helper so a missing variable
// cannot crash config loading: `generate` never opens a connection, and it runs
// in environments that legitimately have no database URL at all (CI, a preview
// build). `migrate deploy` — which does connect — is gated separately in
// `scripts/vercel-migrate.mjs` and fails loudly there if DIRECT_URL is absent,
// so nothing is silently skipped by this being tolerant.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DIRECT_URL,
  },
  migrations: {
    seed: "npx tsx prisma/seed.ts",
  },
});

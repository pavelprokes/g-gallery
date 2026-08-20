import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma 7: the CLI (migrate/introspect/studio) reads the DIRECT, non-pooled
// connection here — the Supabase session pooler (:5432). The runtime client
// gets the transaction pooler (:6543) via the PrismaPg adapter in src/lib/db.ts.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DIRECT_URL"),
  },
});

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// Runtime connections go through the Supavisor TRANSACTION pooler (:6543).
// Small pool + explicit timeouts: pg's default connect timeout is 0 (waits
// forever), which can hang a serverless invocation until maxDuration.
// Module-scope singleton is correct under Vercel Fluid Compute (shared instances).
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL ?? "postgres://localhost:5432/g_gallery",
  max: 3,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 5_000,
});

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

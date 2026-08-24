import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// Runtime connections go through the Supavisor TRANSACTION pooler (:6543).
// Small pool + explicit timeouts: pg's default connect timeout is 0 (waits
// forever), which can hang a serverless invocation until maxDuration.
function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // Without this, pg falls back to its own defaults (localhost:5432) and the
    // deployment reports "Can't reach database server at 127.0.0.1:5432" — a
    // connectivity error for an address nothing in this project ever uses
    // (local dev is :5433, production is :6543). The real cause is a
    // deployment environment that simply has no DATABASE_URL: Preview and
    // custom environments on Vercel do not inherit Production variables.
    // See docs/VERCEL-ENV.md §Environments.
    throw new Error(
      "DATABASE_URL is not set in this environment — see docs/VERCEL-ENV.md §Environments.",
    );
  }

  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    }),
  });
}

// Module-scope singleton is correct under Vercel Fluid Compute (shared
// instances); the global keeps dev's hot reload from opening a pool per edit.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

let client: PrismaClient | undefined;

function getClient(): PrismaClient {
  if (client) return client;
  client = globalForPrisma.prisma ?? createClient();
  if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = client;
  return client;
}

// Constructed on first query, not on import: `next build` evaluates every route
// module, and DATABASE_URL is runtime-only on Vercel, so building the client
// eagerly would turn a missing variable into a failed build instead of a clear
// error on the request that needs the database.
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const instance = getClient();
    const value = Reflect.get(instance, property, instance) as unknown;
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

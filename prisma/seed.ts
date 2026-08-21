/**
 * Seeds the rows the app expects to already exist.
 *
 * Right now that is only the singleton Keepalive row that the cron job
 * (/api/cron/keepalive) touches to stop the Supabase free-tier project from
 * pausing after 7 idle days (docs/PLAN.md §9). Run via `pnpm db:seed`;
 * `prisma migrate reset` runs it automatically through prisma.config.ts.
 */
// The seed can be run standalone (`pnpm db:seed`), outside the Prisma CLI that
// loads prisma.config.ts, so it loads .env itself.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

async function main() {
  const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DIRECT_URL (or DATABASE_URL) must be set to seed the database");
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    await prisma.keepalive.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
    });
    console.log("seed: keepalive row ready");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

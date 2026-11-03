// A production build or server run locally (`pnpm perf:build`, `perf:start`)
// loads `.env.production.local` and `.env.local` on top of `.env`, and in the
// main checkout those hold production's credentials (docs/VERCEL-ENV.md). Run
// it where `.env` is the only env file — a worktree — or not at all.
import fs from "node:fs";

const others = fs.readdirSync(".").filter((file) => /^\.env\..*(local|production)/.test(file));
if (others.length > 0) {
  console.error(`Refusing: ${others.join(", ")} would load production settings. Use a worktree.`);
  process.exit(1);
}

#!/usr/bin/env node
/**
 * Applies pending migrations during a Vercel **production** build, and nowhere
 * else (docs/VERCEL-ENV.md §Migrations).
 *
 * ## Why this is a script and not just `prisma migrate deploy &&` in the build
 *
 * The obvious version — putting the command straight in the build script — was
 * considered and rejected when this project was set up, for a good reason:
 * **preview deployments run the same build script**, and if they can see
 * `DIRECT_URL` then every pull request migrates the production database. That
 * objection is real and this script exists to answer it rather than to ignore
 * it: the guards below are what make automatic migration safe, not the
 * `migrate deploy` call itself.
 *
 * Three gates, in order:
 *
 * 1. **Not running on Vercel** → skip. A developer running `pnpm build` on
 *    their laptop, with a production `DIRECT_URL` exported for some other
 *    reason, must never silently migrate production.
 * 2. **Not a production deployment** → skip. `VERCEL_ENV` is `production` only
 *    for a deploy of the production branch; previews and the dev environment
 *    get `preview`/`development` and are turned away here even if the variable
 *    is visible to them. This is the gate that answers the objection above,
 *    and it does not depend on the dashboard being configured correctly.
 * 3. **`DIRECT_URL` missing on a production build** → **fail the build.**
 *
 * The third one is the load-bearing decision. Skipping quietly there would
 * reproduce exactly the failure this whole thing exists to prevent: the code
 * ships, its columns do not, and every page 500s with the cause three steps
 * upstream. A failed build is a deploy that never happens, which is the
 * strictly safer outcome.
 *
 * ## Ordering, and what happens when something breaks
 *
 * The build runs before the deployment is promoted, so migrations land before
 * the code that needs them — the "migrate first, merge second" rule this repo
 * already followed, now enforced rather than remembered.
 *
 * If `migrate deploy` fails the build fails and nothing is promoted. If it
 * succeeds and `next build` then fails, the database is ahead of the running
 * code — harmless while migrations stay **additive** (new tables, new nullable
 * columns, new columns with defaults), which is the same constraint that
 * already applied to migrating by hand. A migration that drops or narrows a
 * column still has to be split across two deploys.
 *
 * Concurrency is Prisma's problem and it handles it: `migrate deploy` takes a
 * Postgres advisory lock, so two production builds racing cannot interleave.
 * The lock has a fixed 10-second acquisition timeout, so the loser fails the
 * build rather than corrupting anything — visible, and safe.
 */

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/**
 * Pure decision, separated from the doing so it can be tested without a
 * database, a network, or a Vercel build.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ run: boolean; reason: string; fatal?: boolean; message: string }}
 */
export function migrationDecision(env) {
  if (!env.VERCEL) {
    return {
      run: false,
      reason: "not-vercel",
      message:
        "Not a Vercel build — skipping migrations. Run `prisma migrate deploy` yourself if that is what you meant.",
    };
  }

  if (env.VERCEL_ENV !== "production") {
    return {
      run: false,
      reason: "not-production",
      message: `VERCEL_ENV is "${env.VERCEL_ENV ?? "unset"}", not "production" — skipping migrations. Preview deployments never touch the production database.`,
    };
  }

  if (!env.DIRECT_URL) {
    return {
      run: false,
      reason: "missing-direct-url",
      fatal: true,
      message:
        "Production build with no DIRECT_URL. Refusing to deploy code whose migrations cannot be applied — that ships columns-less code and 500s every page.\n" +
        "Fix: in Vercel → Settings → Environment Variables, make DIRECT_URL readable by the Production *build* (a variable marked Sensitive is runtime-only). See docs/VERCEL-ENV.md §Migrations.",
    };
  }

  return {
    run: true,
    reason: "production",
    message: "Production build — applying pending migrations.",
  };
}

/** Not executed when this module is merely imported by a test. */
function main() {
  const decision = migrationDecision(process.env);
  console.log(`[migrate] ${decision.message}`);

  if (decision.fatal) process.exit(1);
  if (!decision.run) return;

  // `prisma` is a devDependency, which is fine: Vercel installs dev
  // dependencies to run the build (this project's own `postinstall: prisma
  // generate` already relies on that). Only the *runtime* bundle is pruned.
  const result = spawnSync("prisma", ["migrate", "deploy"], {
    stdio: "inherit",
    shell: true,
  });

  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Run only when invoked as a script, never when a test imports the decision
// above. Comparing resolved file URLs rather than basenames: a basename match
// would also fire for any unrelated file that happened to share a name.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

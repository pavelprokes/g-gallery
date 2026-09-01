import { describe, expect, it } from "vitest";
import { migrationDecision } from "./vercel-migrate.mjs";

/** A Vercel production build with everything it needs. */
const production = { VERCEL: "1", VERCEL_ENV: "production", DIRECT_URL: "postgres://…" };

describe("migrationDecision", () => {
  it("migrates on a Vercel production build", () => {
    const decision = migrationDecision(production);
    expect(decision.run).toBe(true);
    expect(decision.fatal).toBeFalsy();
  });

  it("never migrates from a developer's laptop", () => {
    // `pnpm build` locally, with a production DIRECT_URL exported for some
    // other reason, must not quietly migrate production.
    const decision = migrationDecision({ VERCEL_ENV: "production", DIRECT_URL: "postgres://…" });
    expect(decision.run).toBe(false);
    expect(decision.fatal).toBeFalsy();
    expect(decision.reason).toBe("not-vercel");
  });

  it("never migrates from a preview deployment", () => {
    // The objection that made this project reject automatic migrations in the
    // first place: previews run the same build script.
    for (const VERCEL_ENV of ["preview", "development", undefined]) {
      const decision = migrationDecision({ ...production, VERCEL_ENV });
      expect(decision.run, `VERCEL_ENV=${VERCEL_ENV}`).toBe(false);
      expect(decision.fatal, `VERCEL_ENV=${VERCEL_ENV}`).toBeFalsy();
      expect(decision.reason).toBe("not-production");
    }
  });

  it("skips a preview even when DIRECT_URL is visible to it", () => {
    // Two independent guards: the environment check does not depend on the
    // dashboard being scoped correctly.
    const decision = migrationDecision({
      VERCEL: "1",
      VERCEL_ENV: "preview",
      DIRECT_URL: "postgres://production-db",
    });
    expect(decision.run).toBe(false);
  });

  it("fails the build when a production deploy has no DIRECT_URL", () => {
    // The load-bearing case: skipping quietly here ships code whose columns do
    // not exist, which 500s every page with the cause three steps upstream.
    const decision = migrationDecision({ VERCEL: "1", VERCEL_ENV: "production" });
    expect(decision.run).toBe(false);
    expect(decision.fatal).toBe(true);
  });

  it("explains itself in every branch", () => {
    // These messages are the only thing a person sees in a build log.
    for (const env of [
      production,
      { VERCEL_ENV: "production" },
      { VERCEL: "1", VERCEL_ENV: "preview" },
      { VERCEL: "1", VERCEL_ENV: "production" },
    ]) {
      expect(migrationDecision(env).message.length).toBeGreaterThan(20);
    }
  });
});

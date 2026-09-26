import { afterEach, describe, expect, it, vi } from "vitest";

const REQUIRED = {
  DATABASE_URL: "postgres://x",
  DIRECT_URL: "postgres://x",
  R2_ACCOUNT_ID: "local",
  R2_ACCESS_KEY_ID: "id",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "bucket",
  R2_ENDPOINT: "http://localhost:9000",
  CRON_SECRET: "cron",
};

describe("serverEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("treats an optional key left as `KEY=` as unset, instead of failing", async () => {
    for (const [key, value] of Object.entries(REQUIRED)) vi.stubEnv(key, value);
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "");
    vi.stubEnv("SUPABASE_URL", "");
    const { serverEnv } = await import("./env");
    const env = serverEnv();
    expect(env.TOKEN_ENCRYPTION_KEY).toBeUndefined();
    expect(env.SUPABASE_URL).toBeUndefined();
  });

  it("does not let an empty key with a default fall back to it silently", async () => {
    for (const [key, value] of Object.entries(REQUIRED)) vi.stubEnv(key, value);
    vi.stubEnv("S3_REGION", "");
    const { serverEnv } = await import("./env");
    expect(() => serverEnv()).toThrow(/S3_REGION/);
  });

  it("still names a required key that is empty", async () => {
    for (const [key, value] of Object.entries(REQUIRED)) vi.stubEnv(key, value);
    vi.stubEnv("CRON_SECRET", "");
    const { serverEnv } = await import("./env");
    expect(() => serverEnv()).toThrow(/CRON_SECRET/);
  });
});

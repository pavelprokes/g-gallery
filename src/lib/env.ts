import "server-only";
import { z } from "zod";

// Lazy validation: env is checked on first use, not at module load, so that
// `next build` (and CI, which has no real credentials) never fails on a route
// that merely imports this module.
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1),
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
  R2_ENDPOINT: z.url(),
  // "auto" for R2; the local MinIO stand-in signs against a real region name.
  S3_REGION: z.string().min(1).default("auto"),
  CRON_SECRET: z.string().min(1),
  SUPABASE_URL: z.url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  // Background "download all" ZIP build (docs/TODO.md §7) — a free-tier
  // Cloudflare Worker + Queue, separate from the paid live-streaming one.
  // All optional: unset just means the cron route no-ops instead of failing.
  ZIP_BUILDER_WORKER_URL: z.url().optional(),
  ZIP_BUILD_SIGNING_SECRET: z.string().min(1).optional(),
  ZIP_BUILD_CALLBACK_SECRET: z.string().min(1).optional(),
  // Lets the admin show and copy a share/event link again after creation
  // (src/lib/token-cipher.ts). Optional: without it links are still created
  // and still work, they just cannot be displayed a second time. Read directly
  // from process.env there rather than through this schema, so a deployment
  // missing every other variable still degrades instead of throwing.
  TOKEN_ENCRYPTION_KEY: z.string().min(1).optional(),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid or missing environment variables: ${missing}`);
  }

  cached = parsed.data;
  return cached;
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { serverEnv } from "@/lib/env";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * The background ZIP-builder Worker's only way to reach the app (docs/TODO.md
 * §7) — it holds no session and talks to no database itself, same principle
 * as the live-streaming Worker. Called once per build, success or failure,
 * from its Cron Trigger finalize step.
 */
const bodySchema = z.object({
  galleryId: z.string().min(1),
  /** Fences against a superseded build (e.g. a photo was added mid-build)
   * finishing late and being reported as current. */
  uploadId: z.string().min(1),
  status: z.enum(["ready", "failed"]),
  objectKey: z.string().min(1).optional(),
  sizeBytes: z.number().int().positive().optional(),
});

export async function POST(request: Request) {
  const env = serverEnv();
  if (!env.ZIP_BUILD_CALLBACK_SECRET) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${env.ZIP_BUILD_CALLBACK_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { galleryId, uploadId, status, objectKey, sizeBytes } = parsed.data;

  // updateMany, not update: a gallery whose zipUploadId no longer matches
  // this build (invalidated mid-flight, or a stale-build reset already fired)
  // simply isn't touched — the callback is a no-op, not an error, since the
  // Worker has no way to know that happened before it calls back.
  const { count } = await prisma.gallery.updateMany({
    where: { id: galleryId, zipUploadId: uploadId },
    data:
      status === "ready"
        ? {
            zipStatus: "READY",
            zipObjectKey: objectKey,
            zipSizeBytes: sizeBytes,
            zipBuiltAt: new Date(),
            // A success clears the slate: the next failure starts its backoff
            // from the beginning rather than inheriting an old streak.
            zipAttempts: 0,
          }
        : // FAILED is no longer where a gallery goes to die — the cron retries
          // it on a backoff, and this counter is what bounds that
          // (src/lib/zip-build-policy.ts).
          { zipStatus: "FAILED", zipAttempts: { increment: 1 } },
  });

  return NextResponse.json({ ok: true, applied: count > 0 });
}

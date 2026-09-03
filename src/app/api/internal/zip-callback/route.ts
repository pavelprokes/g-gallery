import { NextResponse } from "next/server";
import { z } from "zod";
import { serverEnv } from "@/lib/env";
import { prisma } from "@/lib/db";
import { deleteObject } from "@/lib/r2";

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
  /** The fence. A build whose id the gallery no longer names was superseded
   * while it ran — an admin added or removed a photo — and must finish into
   * nothing rather than be recorded as current. */
  buildId: z.string().regex(/^[0-9a-f]{32}$/),
  /** Informational: which R2 multipart upload produced this. */
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
  const { galleryId, buildId, status, objectKey, sizeBytes } = parsed.data;

  // Which object the gallery is serving right now, so a successful build can
  // retire it. Read before the write, because the write is what replaces it.
  const before = await prisma.gallery.findUnique({
    where: { id: galleryId },
    select: { zipObjectKey: true },
  });

  // updateMany, not update: a gallery whose zipBuildId no longer matches this
  // build was superseded while it ran, and simply isn't touched — the callback
  // is a no-op, not an error, since the Worker has no way to know that happened
  // before it called back.
  const { count } = await prisma.gallery.updateMany({
    where: { id: galleryId, zipBuildId: buildId },
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

  // Each build writes its own object, so the one this replaced is now
  // unreferenced. Deleted here rather than left to the weekly sweep, which
  // spares anything under a live gallery prefix and would let every superseded
  // archive accumulate at ~7 GB apiece. After the row is repointed, so a
  // failure here leaks an object instead of breaking a download.
  const retired = before?.zipObjectKey;
  if (count > 0 && status === "ready" && retired && retired !== objectKey) {
    await deleteObject(retired).catch(() => {});
  }

  // `applied: false` tells the Worker its build was superseded, which is its
  // cue to delete the archive it just wrote — nothing will ever point at it.
  return NextResponse.json({ ok: true, applied: count > 0 });
}

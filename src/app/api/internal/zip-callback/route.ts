import { after, NextResponse } from "next/server";
import { z } from "zod";
import { serverEnv } from "@/lib/env";
import { prisma } from "@/lib/db";
import { deleteObject } from "@/lib/r2";
import { kickoffPendingZipBuild } from "@/lib/zip-build";

export const dynamic = "force-dynamic";
// The chained handoff below fans out one queue message per part, so this needs
// the same budget the cron route has.
export const maxDuration = 60;

/**
 * The background ZIP-builder Worker's only way to reach the app (docs/TODO.md
 * §7) — it holds no session and talks to no database itself, same principle
 * as the live-streaming Worker. Called once per build, success or failure,
 * from its Cron Trigger finalize step.
 */
const bodySchema = z.object({
  galleryId: z.string().min(1),
  /**
   * The fence. A build whose id the gallery no longer names was superseded
   * while it ran — an admin added or removed a photo — and must finish into
   * nothing rather than be recorded as current.
   *
   * **Optional, and it has to stay that way.** The app deploys itself on every
   * push; the builder Worker is deployed by hand. Requiring this field made the
   * two versions a matched pair, so the first deploy of the app rejected every
   * callback from the Worker still running yesterday's code — builds finished,
   * `400 invalid_body` came back, nothing was ever recorded, and the Worker
   * retried the same callback every two minutes forever. Two things that ship
   * separately must not have to ship together.
   */
  buildId: z
    .string()
    .regex(/^[0-9a-f]{32}$/)
    .optional(),
  /** Which R2 multipart upload produced this — and the fence for a Worker that
   * predates `buildId`. Safe as one now: `markGalleryPhotosChanged` clears this
   * column too, which is exactly what it never used to do. */
  uploadId: z.string().min(1),
  status: z.enum(["ready", "failed"]),
  objectKey: z.string().min(1).optional(),
  /** Bytes. Routinely in the billions — see `Gallery.zipSizeBytes`, which has
   * to be a BigInt to hold it. `z.number()` is fine on the wire: 8 GB is far
   * below `Number.MAX_SAFE_INTEGER`. */
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
  const { galleryId, buildId, uploadId, status, objectKey, sizeBytes } = parsed.data;

  // Which object the gallery is serving right now, so a successful build can
  // retire it. Read before the write, because the write is what replaces it.
  const before = await prisma.gallery.findUnique({
    where: { id: galleryId },
    select: { zipObjectKey: true },
  });

  // Whichever identity this Worker knows how to send. Both are cleared the
  // moment a gallery's photos change, so either one is a real fence; `buildId`
  // is the better of the two because it is also unique per build.
  const fence = buildId ? { zipBuildId: buildId } : { zipUploadId: uploadId };

  // updateMany, not update: a gallery whose build this no longer is was
  // superseded while it ran, and simply isn't touched — the callback is a
  // no-op, not an error, since the Worker has no way to know that happened
  // before it called back.
  const { count } = await prisma.gallery.updateMany({
    where: { id: galleryId, ...fence },
    data:
      status === "ready"
        ? {
            zipStatus: "READY",
            zipObjectKey: objectKey,
            zipSizeBytes: sizeBytes === undefined ? undefined : BigInt(sizeBytes),
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

  // One build runs at a time (docs/TODO.md §7a), and until now the only thing
  // that started one was a cron tick every 15 minutes. So a finished build left
  // the builder idle for up to a quarter of an hour before the next gallery
  // began — three galleries waiting meant half an hour of doing nothing at all.
  // Serial was never meant to mean slow.
  //
  // `after` so the Worker is not held waiting on a handoff that fans out a
  // thousand queue messages, and a try/catch because a failed chain must never
  // turn a successful callback into an error the Worker retries forever. The
  // cron stays as the safety net: if this never runs, nothing is lost but time.
  after(async () => {
    try {
      await kickoffPendingZipBuild();
    } catch (error) {
      console.error("chained kickoff failed; the cron will pick it up", error);
    }
  });

  // `applied: false` tells the Worker its build was superseded, which is its
  // cue to delete the archive it just wrote — nothing will ever point at it.
  return NextResponse.json({ ok: true, applied: count > 0 });
}

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { PhotoStatus } from "@/generated/prisma/enums";
import { presignPut, presignedPutHeaders } from "@/lib/r2";
import { requireAdmin } from "@/lib/auth-guard";
import { classifyContentType } from "@/lib/upload-content-types";
import {
  GUEST_MAX_FILE_BYTES,
  GUEST_RATE_LIMIT_WINDOW_MS,
  checkGuestQuota,
  checkGuestRateLimit,
} from "@/lib/guest-quota";
import { denialStatus, resolveGuestUpload } from "@/lib/guest-upload-access";
import { THUMB_CONTENT_TYPES, thumbKeyFor } from "@/lib/thumbnail";

// A Route Handler, not a Server Action: the uploader presigns files
// just-in-time in parallel batches, and Server Actions are queued
// sequentially (docs/PLAN.md §3).
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const MAX_BATCH = 20;
const MAX_FILE_BYTES = 100 * 1024 * 1024;

const fileSchema = z.object({
  fileName: z.string().min(1).max(512),
  // Deliberately permissive here and validated against the accepted list
  // below: a guest picking a HEIC off an iPhone deserves a refusal that says
  // so, which a schema-level regex can only express as "invalid_body".
  contentType: z.string().min(1).max(128),
  sizeBytes: z.number().int().positive().max(MAX_FILE_BYTES),
  // Resuming an interrupted upload: re-presign this existing PENDING row
  // instead of creating another one (see /api/uploads/pending).
  resumePhotoId: z.string().min(1).max(64).optional(),
});

const filesSchema = z.array(fileSchema).min(1).max(MAX_BATCH);

// Two callers, one pipeline (docs/GUEST-GALLERIES.md §6). The owner branch is
// authorised by a session, the guest branch by a share token carrying
// `allowUpload`; from the presign call onwards the two are identical, and in
// both cases the bytes go browser -> R2 without touching Vercel (invariant 1).
const bodySchema = z.union([
  z.object({ galleryId: z.string().min(1), files: filesSchema }),
  z.object({
    shareToken: z.string().min(1).max(128),
    /** First-party localStorage UUID; absent when the viewer opted out. */
    anonKey: z.string().min(1).max(64).nullish(),
    files: filesSchema,
  }),
]);

interface UploadTarget {
  galleryId: string;
  storagePrefix: string;
  /** GUEST rows carry attribution and count against the guest quotas. */
  viewerId: string | null;
  isGuest: boolean;
  maxFileBytes: number;
}

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { files } = parsed.data;

  // Content types are checked before anything is written, so a batch with one
  // HEIC in it fails as a whole with a reason the client can render, rather
  // than half-creating rows.
  for (const file of files) {
    const verdict = classifyContentType(file.contentType);
    if (!verdict.ok) {
      return NextResponse.json(
        { error: "unsupported_type", reason: verdict.reason, fileName: file.fileName },
        { status: 415 },
      );
    }
  }

  let target: UploadTarget;

  if ("galleryId" in parsed.data) {
    let session;
    try {
      session = await requireAdmin();
    } catch {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const gallery = await prisma.gallery.findFirst({
      where: { id: parsed.data.galleryId, ownerId: session.user.id },
      select: { id: true, storagePrefix: true },
    });
    if (!gallery) return NextResponse.json({ error: "gallery_not_found" }, { status: 404 });

    target = {
      galleryId: gallery.id,
      storagePrefix: gallery.storagePrefix,
      viewerId: null,
      isGuest: false,
      maxFileBytes: MAX_FILE_BYTES,
    };
  } else {
    const access = await resolveGuestUpload(parsed.data.shareToken, parsed.data.anonKey ?? null);
    if (!access.ok) {
      return NextResponse.json(
        { error: "upload_denied", reason: access.reason },
        { status: denialStatus(access.reason) },
      );
    }

    target = {
      galleryId: access.context.galleryId,
      storagePrefix: access.context.storagePrefix,
      viewerId: access.context.viewerId,
      isGuest: true,
      maxFileBytes: GUEST_MAX_FILE_BYTES,
    };

    const oversized = files.find((file) => file.sizeBytes > target.maxFileBytes);
    if (oversized) {
      return NextResponse.json(
        {
          error: "file_too_large",
          fileName: oversized.fileName,
          maxBytes: target.maxFileBytes,
        },
        { status: 413 },
      );
    }

    // PENDING rows count too: presigning is what creates the row, so counting
    // only CONFIRMED uploads would leave an unbounded presign path open.
    const counted: PhotoStatus[] = ["PENDING", "CONFIRMED"];
    const rateWindowStart = new Date(Date.now() - GUEST_RATE_LIMIT_WINDOW_MS);
    const [galleryUsed, viewerUsed, recentCount] = await Promise.all([
      prisma.photo.count({
        where: { galleryId: target.galleryId, source: "GUEST", status: { in: counted } },
      }),
      target.viewerId
        ? prisma.photo.count({
            where: { uploadedByViewerId: target.viewerId, status: { in: counted } },
          })
        : Promise.resolve(0),
      // Unattributed (opted-out) viewers cannot be rate-limited individually —
      // the per-gallery file cap is still what bounds them.
      target.viewerId
        ? prisma.photo.count({
            where: { uploadedByViewerId: target.viewerId, createdAt: { gte: rateWindowStart } },
          })
        : Promise.resolve(0),
    ]);

    if (target.viewerId && !checkGuestRateLimit({ recentCount, requested: files.length })) {
      return NextResponse.json(
        { error: "rate_limited", retryAfterSeconds: GUEST_RATE_LIMIT_WINDOW_MS / 1000 },
        { status: 429 },
      );
    }

    // Resumed files re-use rows that are already counted, so charging the
    // quota for them again would make a retry fail where the first try passed.
    const fresh = files.filter((file) => !file.resumePhotoId).length;
    const quota = checkGuestQuota({ galleryUsed, viewerUsed, requested: fresh });
    if (!quota.ok) {
      return NextResponse.json(
        { error: "quota_exceeded", reason: quota.reason, remaining: quota.remaining },
        { status: 409 },
      );
    }
  }

  // One query for every row being resumed, so a batch of 8 does not fan out
  // into 8 lookups. Only PENDING rows in this gallery are eligible: a
  // CONFIRMED row must never have its bytes overwritten by a re-upload. A
  // guest may only resume their own rows, so a leaked photo id from someone
  // else's upload cannot be used to overwrite it.
  const resumeIds = files.map((f) => f.resumePhotoId).filter((id): id is string => Boolean(id));
  const resumable = new Map(
    resumeIds.length === 0
      ? []
      : (
          await prisma.photo.findMany({
            where: {
              id: { in: resumeIds },
              galleryId: target.galleryId,
              status: "PENDING",
              ...(target.isGuest
                ? { source: "GUEST" as const, uploadedByViewerId: target.viewerId }
                : {}),
            },
            select: { id: true, objectKey: true },
          })
        ).map((photo) => [photo.id, photo.objectKey] as const),
  );

  const uploads = await Promise.all(
    files.map(async (file) => {
      const resumedKey = file.resumePhotoId ? resumable.get(file.resumePhotoId) : undefined;
      if (file.resumePhotoId && resumedKey) {
        // The object key is reused verbatim, so a partial PUT is simply
        // overwritten rather than leaving a second copy behind.
        return {
          photoId: file.resumePhotoId,
          objectKey: resumedKey,
          url: await presignPut(resumedKey, file.contentType),
          headers: presignedPutHeaders(file.contentType),
          ...(await thumbTarget(resumedKey)),
        };
      }

      // The key is derived from a fresh random id, not from the row id, so the
      // row can be inserted with its final objectKey in a single statement.
      // Inserting a placeholder key and patching it afterwards raced on the
      // unique index — every file in a batch collided on the same placeholder.
      const verdict = classifyContentType(file.contentType);
      const extension = verdict.ok ? verdict.extension : ".jpg";
      const objectKey = `${target.storagePrefix}/${randomUUID()}${extension}`;

      // Rows are created PENDING and only become visible once the client
      // checks the ETag back in — this is what makes orphan reconciliation
      // possible (docs/PLAN.md §5).
      const photo = await prisma.photo.create({
        data: {
          galleryId: target.galleryId,
          objectKey,
          fileName: file.fileName,
          mimeType: file.contentType,
          sizeBytes: file.sizeBytes,
          source: target.isGuest ? "GUEST" : "OWNER",
          uploadedByViewerId: target.viewerId,
        },
        select: { id: true },
      });

      return {
        photoId: photo.id,
        objectKey,
        url: await presignPut(objectKey, file.contentType),
        headers: presignedPutHeaders(file.contentType),
        ...(await thumbTarget(objectKey)),
      };
    }),
  );

  return NextResponse.json({ uploads });
}

/**
 * A second signed PUT for the grid thumbnail the browser may produce
 * (docs/GUEST-GALLERIES.md §9). Always offered, never required: the key is
 * derived here rather than accepted from the client — a client-named key is a
 * client-chosen write location inside the gallery's prefix — and a client that
 * cannot make a thumbnail simply never uses it.
 */
async function thumbTarget(objectKey: string) {
  // Both formats are signed up front, in the response the client already
  // waited for. A signed PUT is bound to one content type, so offering only
  // WebP would silently mean no thumbnail at all on a browser that cannot
  // encode it; two signatures cost nothing and remove that hole.
  const [webp, jpeg] = await Promise.all([
    presignPut(thumbKeyFor(objectKey, "webp"), THUMB_CONTENT_TYPES.webp),
    presignPut(thumbKeyFor(objectKey, "jpeg"), THUMB_CONTENT_TYPES.jpeg),
  ]);

  return {
    thumbTargets: {
      webp: { url: webp, headers: presignedPutHeaders(THUMB_CONTENT_TYPES.webp) },
      jpeg: { url: jpeg, headers: presignedPutHeaders(THUMB_CONTENT_TYPES.jpeg) },
    },
  };
}

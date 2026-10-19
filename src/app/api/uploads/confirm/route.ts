import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-guard";
import { denialStatus, resolveGuestUpload } from "@/lib/guest-upload-access";
import { Prisma } from "@/generated/prisma/client";
import { deleteObject, headObject } from "@/lib/r2";
import { trackServerEvent } from "@/lib/umami";
import { thumbKeyFor } from "@/lib/thumbnail";
import { markGalleryPhotosChanged } from "@/lib/zip-build";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

const commonSchema = {
  photoId: z.string().min(1),
  etag: z.string().min(1).max(256),
  /** "#rrggbb" average colour for the tile placeholder; optional by design. */
  placeholder: z
    .string()
    .regex(/^#[0-9a-f]{6}$/)
    .nullish(),
  /** Lowercase hex CRC32 computed client-side — feeds the future ZIP writer. */
  crc32: z.string().regex(/^[0-9a-f]{8}$/),
  sizeBytes: z.number().int().positive(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  /** Which grid thumbnail the browser managed to upload, if any. */
  thumb: z.enum(["webp", "jpeg"]).nullish(),
  /** Capture time (EXIF, or the file's mtime) — drives the gallery timeline. */
  takenAt: z.iso.datetime().nullish(),
  /** Lightroom marks from the file's XMP — hints for the highlights only. */
  xmpRating: z.number().int().min(-1).max(5).nullish(),
  xmpLabel: z.string().trim().min(1).max(32).nullish(),
  xmpHighlight: z.boolean().nullish(),
  /** A video's length, read in the browser (docs/VIDEO.md). Ignored on photos. */
  durationMs: z
    .number()
    .int()
    .positive()
    .max(24 * 60 * 60 * 1000)
    .nullish(),
};

/**
 * Client-supplied capture times are advisory: a camera with a dead clock says
 * 1970, a mis-set one says 2085. Outside a sane window the confirm timestamp
 * is the honest fallback — same as a photo with no EXIF at all.
 */
function saneTakenAt(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.getTime() < Date.UTC(1990, 0, 1)) return null;
  if (parsed.getTime() > Date.now() + 24 * 60 * 60 * 1000) return null;
  return parsed;
}

// Same two callers as the presign route. The share token is re-verified here
// rather than trusted from the presign step: confirm is what makes a row
// visible, so it is its own authorisation decision (docs/GUEST-GALLERIES.md §6).
// The guest variant is listed FIRST on purpose. Zod objects ignore unknown
// keys, so the owner variant — which has no required discriminating field —
// would happily match a guest body and route it into the session branch,
// answering every guest upload with 401.
const bodySchema = z.union([
  z.object({
    ...commonSchema,
    shareToken: z.string().min(1).max(128),
    anonKey: z.string().min(1).max(64).nullish(),
  }),
  z.object(commonSchema),
]);

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const {
    photoId,
    etag,
    crc32,
    sizeBytes,
    width,
    height,
    placeholder,
    thumb,
    takenAt,
    xmpRating,
    xmpLabel,
    xmpHighlight,
    durationMs,
  } = parsed.data;

  let photo: {
    id: string;
    galleryId: string;
    objectKey: string;
    videoObjectKey: string | null;
    replacesPhotoId?: string | null;
    status?: string;
  } | null;

  if ("shareToken" in parsed.data) {
    const access = await resolveGuestUpload(parsed.data.shareToken, parsed.data.anonKey ?? null);
    if (!access.ok) {
      return NextResponse.json(
        { error: "upload_denied", reason: access.reason },
        { status: denialStatus(access.reason) },
      );
    }

    // A guest may only confirm a PENDING guest row in this gallery, and only
    // one attributed to them (or unattributed, which is what an opted-out
    // guest's own upload looks like). Photo ids are unguessable and only ever
    // returned to the uploader, but the check is cheap and confirm is the step
    // that makes a row visible to everyone.
    photo = await prisma.photo.findFirst({
      where: {
        id: photoId,
        galleryId: access.context.galleryId,
        source: "GUEST",
        status: "PENDING",
        uploadedByViewerId: access.context.viewerId,
      },
      select: { id: true, galleryId: true, objectKey: true, videoObjectKey: true },
    });
  } else {
    let session;
    try {
      session = await requireAdmin();
    } catch {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    photo = await prisma.photo.findFirst({
      where: { id: photoId, gallery: { ownerId: session.user.id } },
      select: {
        id: true,
        galleryId: true,
        objectKey: true,
        videoObjectKey: true,
        replacesPhotoId: true,
        status: true,
      },
    });
  }

  if (!photo) return NextResponse.json({ error: "photo_not_found" }, { status: 404 });
  // A replacement already confirmed: its row is a tombstone now (below), and a
  // retried confirm whose first answer was lost must hear success, not 404.
  if (photo.status === "FAILED" && photo.replacesPhotoId) {
    return NextResponse.json({ ok: true, replaced: photo.replacesPhotoId });
  }

  // Ground truth against what the client claims: a client-declared sizeBytes
  // is otherwise trusted outright, and this is the one anonymous write path
  // into storage (docs/GUEST-GALLERIES.md §15). A stalled or truncated PUT
  // leaves an object smaller than what was promised, which is why this is
  // retried on the client rather than treated as a permanent rejection.
  //
  // On a video the declared size is the MP4's, and the poster must be there
  // too: it is what the grid, the cover and the link preview show, so a row
  // without one would be a tile with nothing in it (docs/VIDEO.md).
  const [stored, poster] = await Promise.all([
    headObject(photo.videoObjectKey ?? photo.objectKey),
    photo.videoObjectKey ? headObject(photo.objectKey) : null,
  ]);
  if (!stored || stored.sizeBytes !== sizeBytes) {
    return NextResponse.json(
      { error: "size_mismatch", expected: sizeBytes, actual: stored?.sizeBytes ?? null },
      { status: 409 },
    );
  }
  if (photo.videoObjectKey && !poster) {
    // Retryable, and distinct from `size_mismatch`: the client sends the
    // poster again, not the (possibly multi-GB) MP4 that did arrive.
    return NextResponse.json({ error: "poster_missing" }, { status: 409 });
  }

  if (photo.replacesPhotoId) {
    const replaced = await replacePhotoBytes(photo, photo.replacesPhotoId, {
      etag: etag.replaceAll('"', ""),
      crc32,
      sizeBytes,
      // Undefined keeps what the delivered photo had: a browser that could
      // not measure or read the new file must not wipe what is known.
      width,
      height,
      placeholder: placeholder ?? undefined,
      thumbObjectKey: thumb ? thumbKeyFor(photo.objectKey, thumb) : null,
      xmpRating: xmpRating ?? undefined,
      xmpLabel: xmpLabel ?? undefined,
      xmpHighlight: xmpHighlight ?? undefined,
    });
    if (replaced === "conflict") {
      // Another replacement of the same photo landed in between. Retryable:
      // the next try reads the photo's new key and replaces that one.
      return NextResponse.json({ error: "replace_conflict" }, { status: 409 });
    }
    if (replaced === "replaced") {
      await markGalleryPhotosChanged(photo.galleryId);
      return NextResponse.json({ ok: true, replaced: photo.replacesPhotoId });
    }
  }

  // Always set on confirm, so a CONFIRMED photo never sorts on a NULL.
  const capturedAt = saneTakenAt(takenAt) ?? new Date();
  await prisma.photo.update({
    where: { id: photo.id },
    data: {
      status: "CONFIRMED",
      etag: etag.replaceAll('"', ""),
      crc32,
      sizeBytes,
      width,
      height,
      placeholder: placeholder ?? undefined,
      takenAt: capturedAt,
      // A provisional place in the woven order (docs/PHOTO-ORDER.md), for the
      // same reason: the refresh below refines it, but a CONFIRMED photo must
      // never sit on a NULL there either — the keyset cursor cannot reach one.
      wovenAt: capturedAt,
      // Derived from the key we issued: the client only says which format it
      // managed, never where to write it.
      thumbObjectKey: thumb ? thumbKeyFor(photo.objectKey, thumb) : null,
      xmpRating: xmpRating ?? null,
      xmpLabel: xmpLabel ?? null,
      xmpHighlight: xmpHighlight ?? false,
      durationMs: photo.videoObjectKey ? (durationMs ?? null) : null,
    },
  });

  // A new photo means any pre-built "download all" archive (docs/TODO.md §7)
  // no longer matches the gallery's contents, and restarts the clock the cron
  // waits out before rebuilding.
  await markGalleryPhotosChanged(photo.galleryId);

  // Guest uploads only: the photographer's own uploads are not visitor behaviour.
  if ("shareToken" in parsed.data) trackServerEvent({ name: "guest-photo-upload", request });

  return NextResponse.json({ ok: true });
}

/**
 * A corrected export (docs/REPLACE-PHOTOS.md): the confirmed bytes move onto
 * the photo they replace, which keeps its id — favourites, print marks, face
 * names, chapters, cover — and its name and capture time, so its place in
 * every order. "missing" when that photo is gone or no longer the
 * photographer's delivered still; the upload then confirms as an ordinary new
 * photo rather than losing the file.
 *
 * The upload's row stays behind as a FAILED tombstone, its key released, so
 * a retried confirm still finds it and answers success.
 */
async function replacePhotoBytes(
  upload: { id: string; galleryId: string; objectKey: string },
  targetId: string,
  bytes: Pick<
    Prisma.PhotoUpdateInput,
    | "etag"
    | "crc32"
    | "sizeBytes"
    | "width"
    | "height"
    | "placeholder"
    | "thumbObjectKey"
    | "xmpRating"
    | "xmpLabel"
    | "xmpHighlight"
  >,
): Promise<"replaced" | "missing" | "conflict"> {
  const [target, pending] = await Promise.all([
    prisma.photo.findFirst({
      where: {
        id: targetId,
        galleryId: upload.galleryId,
        status: "CONFIRMED",
        source: "OWNER",
        videoObjectKey: null,
      },
      select: { id: true, objectKey: true, thumbObjectKey: true },
    }),
    prisma.photo.findUnique({ where: { id: upload.id }, select: { mimeType: true } }),
  ]);
  if (!target || !pending) return "missing";

  const swapped = await prisma
    .$transaction(async (tx) => {
      // The upload's row lets go of its key first: `objectKey` is unique.
      await tx.photo.update({
        where: { id: upload.id },
        data: { status: "FAILED", objectKey: `${upload.objectKey}#replaced`, thumbObjectKey: null },
      });
      // Only if the photo still has the key read above — a second replacement
      // racing this one would otherwise orphan the first one's new object.
      const { count } = await tx.photo.updateMany({
        where: { id: target.id, objectKey: target.objectKey },
        data: {
          ...bytes,
          objectKey: upload.objectKey,
          mimeType: pending.mimeType,
          // Read from the old pixels: a retouch or a new crop makes them stale.
          // The admin detects again on demand (docs/SOCIAL-VIDEO.md §4).
          faces: Prisma.DbNull,
          checkKeptAt: null,
        },
      });
      if (count !== 1) throw new ReplaceConflict();
      // The corrected file is the answer to the couple's corrections on it
      // (docs/CORRECTIONS.md): they read "Opraveno ✓" from now on.
      await tx.photoComment.updateMany({
        where: { photoId: target.id, resolvedAt: null },
        data: { resolvedAt: new Date() },
      });
      return true;
    })
    .catch((error: unknown) => {
      if (error instanceof ReplaceConflict) return false;
      throw error;
    });
  if (!swapped) return "conflict";

  // Every object key is new — R2 serves them `immutable` — so the old ones
  // are deleted, not overwritten. A failure only leaves debris for the sweep.
  await Promise.allSettled(
    [target.objectKey, target.thumbObjectKey]
      .filter((key): key is string => key !== null)
      .map((key) => deleteObject(key)),
  );
  return "replaced";
}

class ReplaceConflict extends Error {}

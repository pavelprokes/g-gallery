import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-guard";
import { denialStatus, resolveGuestUpload } from "@/lib/guest-upload-access";

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
};

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

  const { photoId, etag, crc32, sizeBytes, width, height, placeholder } = parsed.data;

  let photo: { id: string; galleryId: string } | null;

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
      select: { id: true, galleryId: true },
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
      select: { id: true, galleryId: true },
    });
  }

  if (!photo) return NextResponse.json({ error: "photo_not_found" }, { status: 404 });

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
    },
  });

  // A new photo means any pre-built "download all" archive (docs/TODO.md §7)
  // no longer matches the gallery's contents. NONE stays NONE (nobody has
  // asked for a zip yet); anything else drops back to PENDING so the cron
  // rebuilds it. A build already in flight is left running — the callback
  // fences on zipUploadId, so a build that finishes after this update is
  // simply ignored as stale rather than served as current.
  await prisma.gallery.updateMany({
    where: { id: photo.galleryId, zipStatus: { in: ["READY", "BUILDING", "FAILED"] } },
    data: { zipStatus: "PENDING" },
  });

  return NextResponse.json({ ok: true });
}

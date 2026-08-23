import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

const bodySchema = z.object({
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
});

export async function POST(request: Request) {
  let session;
  try {
    session = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { photoId, etag, crc32, sizeBytes, width, height, placeholder } = parsed.data;

  const photo = await prisma.photo.findFirst({
    where: { id: photoId, gallery: { ownerId: session.user.id } },
    select: { id: true, galleryId: true },
  });
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

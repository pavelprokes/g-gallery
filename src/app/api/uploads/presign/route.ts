import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { presignPut, presignedPutHeaders } from "@/lib/r2";
import { requireAdmin } from "@/lib/auth-guard";

// A Route Handler, not a Server Action: the uploader presigns files
// just-in-time in parallel batches, and Server Actions are queued
// sequentially (docs/PLAN.md §3).
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const MAX_BATCH = 20;
const MAX_FILE_BYTES = 100 * 1024 * 1024;

const bodySchema = z.object({
  galleryId: z.string().min(1),
  files: z
    .array(
      z.object({
        fileName: z.string().min(1).max(512),
        contentType: z.string().regex(/^image\/(jpeg|png|webp|avif)$/),
        sizeBytes: z.number().int().positive().max(MAX_FILE_BYTES),
      }),
    )
    .min(1)
    .max(MAX_BATCH),
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

  const { galleryId, files } = parsed.data;

  const gallery = await prisma.gallery.findFirst({
    where: { id: galleryId, ownerId: session.user.id },
    select: { id: true, storagePrefix: true },
  });
  if (!gallery) return NextResponse.json({ error: "gallery_not_found" }, { status: 404 });

  const uploads = await Promise.all(
    files.map(async (file) => {
      const extension = file.fileName.split(".").pop()?.toLowerCase() ?? "jpg";
      // Rows are created PENDING and only become visible once the client
      // checks the ETag back in — this is what makes orphan reconciliation
      // possible (docs/PLAN.md §5).
      const photo = await prisma.photo.create({
        data: {
          galleryId: gallery.id,
          objectKey: "", // set below, once the cuid is known
          fileName: file.fileName,
          mimeType: file.contentType,
          sizeBytes: file.sizeBytes,
        },
        select: { id: true },
      });

      const objectKey = `${gallery.storagePrefix}/${photo.id}.${extension}`;
      await prisma.photo.update({ where: { id: photo.id }, data: { objectKey } });

      return {
        photoId: photo.id,
        objectKey,
        url: await presignPut(objectKey, file.contentType),
        headers: presignedPutHeaders(file.contentType),
      };
    }),
  );

  return NextResponse.json({ uploads });
}

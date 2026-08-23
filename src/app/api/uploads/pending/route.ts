import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-guard";
import { denialStatus, resolveGuestUpload } from "@/lib/guest-upload-access";

// Uploads that never confirmed — the browser was closed, the tab crashed, the
// network dropped. The rows survive; the File objects do not, so the client
// can only offer to re-pick the same files (docs/PLAN.md §5).
export const dynamic = "force-dynamic";

const querySchema = z.union([
  // Guest first, for the same reason as the confirm route's body schema.
  z.object({
    shareToken: z.string().min(1).max(128),
    anonKey: z.string().min(1).max(64).optional(),
  }),
  z.object({ galleryId: z.string().min(1) }),
]);

export async function GET(request: Request) {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  }

  if ("shareToken" in parsed.data) {
    const access = await resolveGuestUpload(parsed.data.shareToken, parsed.data.anonKey ?? null);
    if (!access.ok) {
      return NextResponse.json(
        { error: "upload_denied", reason: access.reason },
        { status: denialStatus(access.reason) },
      );
    }

    // Only this guest's own leftovers: resume exists so someone can finish
    // what they started, not so they can adopt a stranger's half-upload.
    const pending = await prisma.photo.findMany({
      where: {
        galleryId: access.context.galleryId,
        status: "PENDING",
        source: "GUEST",
        uploadedByViewerId: access.context.viewerId,
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, fileName: true, sizeBytes: true },
    });

    return NextResponse.json({ pending });
  }

  let session;
  try {
    session = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Ownership is enforced through the gallery, not the photo rows.
  const gallery = await prisma.gallery.findFirst({
    where: { id: parsed.data.galleryId, ownerId: session.user.id },
    select: { id: true },
  });
  if (!gallery) return NextResponse.json({ error: "gallery_not_found" }, { status: 404 });

  const pending = await prisma.photo.findMany({
    // The owner's resume list is their own uploads: a guest's abandoned row is
    // not something the photographer can re-pick the files for, and offering
    // it would only invite them to overwrite it with a different photo.
    where: { galleryId: gallery.id, status: "PENDING", source: "OWNER" },
    orderBy: { createdAt: "asc" },
    select: { id: true, fileName: true, sizeBytes: true },
  });

  return NextResponse.json({ pending });
}

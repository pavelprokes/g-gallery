import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-guard";

// Uploads that never confirmed — the browser was closed, the tab crashed, the
// network dropped. The rows survive; the File objects do not, so the client
// can only offer to re-pick the same files (docs/PLAN.md §5).
export const dynamic = "force-dynamic";

const querySchema = z.object({ galleryId: z.string().min(1) });

export async function GET(request: Request) {
  let session;
  try {
    session = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  }

  // Ownership is enforced through the gallery, not the photo rows.
  const gallery = await prisma.gallery.findFirst({
    where: { id: parsed.data.galleryId, ownerId: session.user.id },
    select: { id: true },
  });
  if (!gallery) return NextResponse.json({ error: "gallery_not_found" }, { status: 404 });

  const pending = await prisma.photo.findMany({
    where: { galleryId: gallery.id, status: "PENDING" },
    orderBy: { createdAt: "asc" },
    select: { id: true, fileName: true, sizeBytes: true },
  });

  return NextResponse.json({ pending });
}

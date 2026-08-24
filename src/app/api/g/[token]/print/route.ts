import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { resolveShareLink } from "@/lib/share-access";
import { setPrintQuantity } from "@/lib/print-selections";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const bodySchema = z.object({
  anonKey: z.uuid(),
  photoId: z.string().min(1),
  quantity: z.number().int().min(0).max(99),
  /** Optional: the "Kdo se dívá?" prompt — Google Photos' join moment. */
  displayName: z.string().trim().min(1).max(60).optional(),
});

/** The current viewer's own print selections, so the UI can render badges on load. */
export async function GET(request: Request, ctx: RouteContext<"/api/g/[token]/print">) {
  const { token } = await ctx.params;

  const access = await resolveShareLink(token);
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: 403 });

  const anonKey = new URL(request.url).searchParams.get("anonKey");
  if (!anonKey || !z.uuid().safeParse(anonKey).success) {
    return NextResponse.json({ quantities: {} });
  }

  const viewer = await prisma.viewer.findUnique({
    where: { galleryId_anonKey: { galleryId: access.shareLink.galleryId, anonKey } },
    select: { printSelections: { select: { photoId: true, quantity: true } } },
  });

  const quantities = Object.fromEntries(
    (viewer?.printSelections ?? []).map((row) => [row.photoId, row.quantity]),
  );
  return NextResponse.json({ quantities });
}

export async function POST(request: Request, ctx: RouteContext<"/api/g/[token]/print">) {
  const { token } = await ctx.params;

  const access = await resolveShareLink(token);
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: 403 });
  if (!access.shareLink.allowPrintSelection) {
    return NextResponse.json({ error: "PRINT_SELECTION_DISABLED" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const { anonKey, photoId, quantity, displayName } = parsed.data;

  // The photo must belong to this gallery — otherwise a share link could be
  // used to mark photos in someone else's gallery.
  const photo = await prisma.photo.findFirst({
    where: { id: photoId, galleryId: access.shareLink.galleryId, status: "CONFIRMED" },
    select: { id: true },
  });
  if (!photo) return NextResponse.json({ error: "photo_not_found" }, { status: 404 });

  const now = new Date();
  const viewer = await prisma.viewer.upsert({
    where: { galleryId_anonKey: { galleryId: access.shareLink.galleryId, anonKey } },
    create: {
      galleryId: access.shareLink.galleryId,
      shareLinkId: access.shareLink.id,
      anonKey,
      displayName,
      lastSeenAt: now,
    },
    update: { lastSeenAt: now, ...(displayName ? { displayName } : {}) },
    select: { id: true, optedOut: true, displayName: true },
  });

  if (viewer.optedOut) return NextResponse.json({ error: "OPTED_OUT" }, { status: 403 });

  const resultQuantity = await setPrintQuantity(photo.id, viewer.id, quantity);

  if (resultQuantity > 0) {
    await prisma.activityEvent.create({
      data: {
        galleryId: access.shareLink.galleryId,
        photoId: photo.id,
        viewerId: viewer.id,
        type: "PRINT_SELECT",
      },
    });
  }

  return NextResponse.json({ ok: true, quantity: resultQuantity, displayName: viewer.displayName });
}

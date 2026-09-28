import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { resolveShareLink } from "@/lib/share-access";
import { PHOTOS_PAGE_SIZE, decodeCursor, encodeCursor } from "@/lib/photo-cursor";
import { ORDER_KEY_SELECT, afterPosition, orderKeyOf, photoOrderBy } from "@/lib/photo-order";
import { UPLOADER_SELECT, uploaderNameOf } from "@/lib/photo-attribution";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const querySchema = z.object({
  cursor: z.string().optional(),
});

/**
 * Keyset (cursor) pagination over a gallery's confirmed photos, in the
 * gallery's order (src/lib/photo-order.ts) — oldest shot first, or the
 * photographer's file numbering. The same ordering the first server-rendered
 * page already uses (`src/lib/shared-gallery.ts`), so switching pages never
 * reshuffles what the viewer has already seen. `id` is the tiebreaker: EXIF
 * time is second-resolution, so a burst shares a key.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/g/[token]/photos">) {
  const { token } = await ctx.params;

  const access = await resolveShareLink(token);
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: 403 });

  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "invalid_query" }, { status: 400 });

  const order = access.shareLink.photoOrder;
  const cursor = parsed.data.cursor ? decodeCursor(parsed.data.cursor, order) : null;
  if (parsed.data.cursor && !cursor) {
    return NextResponse.json({ error: "invalid_cursor" }, { status: 400 });
  }

  // The gallery's total rides along with the first page. The page's own
  // server-rendered count is fixed at load, so after a guest adds or takes
  // back a photo the header and the lightbox read "3 / 2" until a reload.
  // Every refetch of the grid starts from this page, so the count is only as
  // stale as the photos themselves.
  const [photos, total] = await Promise.all([
    prisma.photo.findMany({
      where: {
        galleryId: access.shareLink.galleryId,
        status: "CONFIRMED",
        ...(cursor ? afterPosition(order, cursor) : {}),
      },
      orderBy: photoOrderBy(order),
      take: PHOTOS_PAGE_SIZE + 1,
      select: {
        id: true,
        objectKey: true,
        thumbObjectKey: true,
        fileName: true,
        width: true,
        height: true,
        placeholder: true,
        ...ORDER_KEY_SELECT,
        _count: { select: { favorites: true } },
        ...UPLOADER_SELECT,
      },
    }),
    cursor
      ? undefined
      : prisma.photo.count({
          where: { galleryId: access.shareLink.galleryId, status: "CONFIRMED" },
        }),
  ]);

  const hasMore = photos.length > PHOTOS_PAGE_SIZE;
  const page = hasMore ? photos.slice(0, PHOTOS_PAGE_SIZE) : photos;
  const last = page.at(-1);

  return NextResponse.json({
    items: page.map((photo) => ({
      id: photo.id,
      objectKey: photo.objectKey,
      thumbObjectKey: photo.thumbObjectKey,
      fileName: photo.fileName,
      width: photo.width,
      height: photo.height,
      placeholder: photo.placeholder,
      favoriteCount: photo._count.favorites,
      uploaderName: uploaderNameOf(photo),
      orderKey: orderKeyOf(order, photo),
    })),
    ...(total !== undefined ? { total } : {}),
    nextCursor:
      hasMore && last ? encodeCursor({ order, key: orderKeyOf(order, last), id: last.id }) : null,
  });
}

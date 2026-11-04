import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { VIDEO_SELECT, videoOf } from "@/lib/video";
import { resolveShareLink } from "@/lib/share-access";
import { PAGES_AHEAD_MAX, PHOTOS_PAGE_SIZE, decodeCursor, toPages } from "@/lib/photo-cursor";
import {
  ORDER_KEY_SELECT,
  PHOTO_ORDERS,
  afterPosition,
  beforePosition,
  isValidOrderKey,
  orderKeyOf,
  photoOrderBy,
} from "@/lib/photo-order";
import { UPLOADER_SELECT, uploaderNameOf } from "@/lib/photo-attribution";
import { PROJECTION_FACES_SELECT, projectionAim } from "@/lib/projection-camera";
import { blurOnLastTwoPages } from "@/lib/thumbhash";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const querySchema = z
  .object({
    cursor: z.string().optional(),
    // A place in the gallery's order — a chapter's start, a highlight — to
    // bring every page up to in one response (docs/GALLERY-LOADING.md).
    // As long as an order key may be (isValidOrderKey checks it below).
    throughKey: z.string().max(4096).optional(),
    throughId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .optional(),
  })
  .refine((query) => (query.throughKey === undefined) === (query.throughId === undefined));

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
    // A well-formed cursor from the other order: the photographer switched
    // the order while this page was open. The client reloads rather than
    // splice two orders together (docs/PHOTO-ORDER.md).
    const minted = PHOTO_ORDERS.some(
      (other) => other !== order && decodeCursor(parsed.data.cursor!, other),
    );
    return minted
      ? NextResponse.json({ error: "order_changed" }, { status: 409 })
      : NextResponse.json({ error: "invalid_cursor" }, { status: 400 });
  }

  const through =
    parsed.data.throughKey !== undefined && parsed.data.throughId !== undefined
      ? { key: parsed.data.throughKey, id: parsed.data.throughId }
      : null;
  if (through && !isValidOrderKey(order, through.key)) {
    return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  }
  const after = cursor ? afterPosition(order, cursor) : {};
  // Every page up to the one that holds `through` — the pages the client
  // would otherwise ask for one round trip at a time, cut the same way.
  // ponytail: a jump past PAGES_AHEAD_MAX pages takes another request.
  const before = through
    ? await prisma.photo.count({
        where: {
          galleryId: access.shareLink.galleryId,
          status: "CONFIRMED",
          AND: [after, beforePosition(order, through)],
        },
      })
    : 0;
  const take =
    Math.min(Math.floor(before / PHOTOS_PAGE_SIZE) + 1, PAGES_AHEAD_MAX) * PHOTOS_PAGE_SIZE;

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
        ...after,
      },
      orderBy: photoOrderBy(order),
      take: take + 1,
      select: {
        id: true,
        objectKey: true,
        thumbObjectKey: true,
        ...VIDEO_SELECT,
        fileName: true,
        width: true,
        height: true,
        placeholder: true,
        thumbhash: true,
        ...ORDER_KEY_SELECT,
        _count: { select: { favorites: true } },
        ...UPLOADER_SELECT,
        ...PROJECTION_FACES_SELECT,
      },
    }),
    cursor
      ? undefined
      : prisma.photo.count({
          where: { galleryId: access.shareLink.galleryId, status: "CONFIRMED" },
        }),
  ]);

  const hasMore = photos.length > take;
  const rows = hasMore ? photos.slice(0, take) : photos;
  // Cut by the same function as the pages a photo's link brings with the page
  // (src/lib/shared-gallery.ts), so a refetch lands on the same boundaries.
  const pages = blurOnLastTwoPages(
    toPages(
      order,
      rows.map((photo) => ({
        id: photo.id,
        objectKey: photo.objectKey,
        thumbObjectKey: photo.thumbObjectKey,
        video: videoOf(photo),
        fileName: photo.fileName,
        width: photo.width,
        height: photo.height,
        placeholder: photo.placeholder,
        thumbhash: photo.thumbhash,
        favoriteCount: photo._count.favorites,
        uploaderName: uploaderNameOf(photo),
        orderKey: orderKeyOf(order, photo),
        // For the projection's camera (src/lib/projection-camera.ts).
        ...projectionAim(photo.faces, photo.faceTags),
      })),
      hasMore,
    ),
  );

  return NextResponse.json({
    // Which order `orderKey` is in — a page open across a switch notices here.
    order,
    ...(through ? { pages } : { items: pages[0]!.items, nextCursor: pages[0]!.nextCursor }),
    ...(total !== undefined ? { total } : {}),
  });
}

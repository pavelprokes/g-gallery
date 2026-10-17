import { MEDIA_SELECT, displayKeyOf, galleryVideoOf, type GalleryVideo } from "@/lib/media";
import { UPLOADER_SELECT, uploaderNameOf } from "@/lib/photo-attribution";
import { ORDER_KEY_SELECT, orderKeyOf, type PhotoOrder } from "@/lib/photo-order";

/**
 * One grid item as the viewer receives it — a photo, or a video drawn as its
 * poster (docs/VIDEO.md §2). Shared by the gallery page's first page and the
 * cursor-paginated route, so the two can never shape an item differently.
 */
export interface GalleryItemData {
  id: string;
  /** What every image surface draws: the photo, or a video's poster. */
  objectKey: string;
  thumbObjectKey: string | null;
  fileName: string;
  width: number | null;
  height: number | null;
  placeholder: string | null;
  favoriteCount: number;
  uploaderName: string | null;
  orderKey: string;
  /** Set only for a video; the player's one way to the MP4. */
  video: GalleryVideo | null;
}

/** Spread into a Prisma `photo` select. */
export const GALLERY_ITEM_SELECT = {
  id: true,
  thumbObjectKey: true,
  fileName: true,
  width: true,
  height: true,
  placeholder: true,
  ...MEDIA_SELECT,
  ...ORDER_KEY_SELECT,
  _count: { select: { favorites: true } },
  ...UPLOADER_SELECT,
} as const;

type ItemRow = Parameters<typeof displayKeyOf>[0] &
  Parameters<typeof galleryVideoOf>[0] &
  Parameters<typeof orderKeyOf>[1] &
  Parameters<typeof uploaderNameOf>[0] & {
    id: string;
    thumbObjectKey: string | null;
    fileName: string;
    width: number | null;
    height: number | null;
    placeholder: string | null;
    _count: { favorites: number };
  };

export function galleryItemOf(order: PhotoOrder, row: ItemRow): GalleryItemData {
  return {
    id: row.id,
    objectKey: displayKeyOf(row),
    thumbObjectKey: row.thumbObjectKey,
    fileName: row.fileName,
    width: row.width,
    height: row.height,
    placeholder: row.placeholder,
    favoriteCount: row._count.favorites,
    uploaderName: uploaderNameOf(row),
    orderKey: orderKeyOf(order, row),
    video: galleryVideoOf(row),
  };
}

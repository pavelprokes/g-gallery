// What a place on the website shows, worked out from its gallery. Plain data and no database, so
// the page and its tests share it. The website applies the same rules (its lib/photoPlaces.ts).

export interface WebPlace {
  key: string;
  label: string;
  where: string;
  /** What each photo does, in the gallery's order. */
  positions: string[];
  landscape: boolean;
  /** The cover photo takes the first position (the homepage hero). */
  coverFirst?: boolean;
}

export interface PlacePhoto {
  id: string;
  objectKey: string;
  thumbObjectKey: string | null;
  placeholder: string | null;
  fileName: string;
  width: number | null;
  height: number | null;
}

export interface PlaceGallery {
  id: string;
  title: string;
  status: string;
  coverPhotoId: string | null;
  photoCount: number;
  photos: PlacePhoto[];
}

export type PlaceState = "empty" | "draft" | "no_photos" | "live";

export interface PlaceTile {
  position: string;
  photo: PlacePhoto | null;
  /** A portrait where only landscape works: the website keeps its old photo here. */
  rejected: boolean;
}

export interface PlaceView {
  state: PlaceState;
  tiles: PlaceTile[];
  /** Positions with no usable photo: the website shows its old photo there. */
  missing: number;
  /** Photos in the gallery no position uses. */
  unused: number;
}

const isCover = (gallery: PlaceGallery, photo: PlacePhoto) =>
  gallery.coverPhotoId ? photo.id === gallery.coverPhotoId : /hero/i.test(photo.fileName);

const inPositionOrder = (place: WebPlace, gallery: PlaceGallery) =>
  place.coverFirst
    ? [
        ...gallery.photos.filter((photo) => isCover(gallery, photo)),
        ...gallery.photos.filter((photo) => !isCover(gallery, photo)),
      ]
    : gallery.photos;

export function describePlace(place: WebPlace, gallery: PlaceGallery | null): PlaceView {
  const ordered = gallery ? inPositionOrder(place, gallery) : [];
  const tiles = place.positions.map((position, index) => {
    const photo = ordered[index] ?? null;
    const portrait = !!photo && (photo.width ?? 0) <= (photo.height ?? 0);
    return { position, photo, rejected: place.landscape && portrait };
  });

  return {
    state: !gallery
      ? "empty"
      : gallery.status !== "PUBLISHED"
        ? "draft"
        : gallery.photoCount === 0
          ? "no_photos"
          : "live",
    tiles,
    missing: tiles.filter((tile) => !tile.photo || tile.rejected).length,
    unused: Math.max(0, (gallery?.photoCount ?? 0) - place.positions.length),
  };
}

export interface CoupleGallery {
  id: string;
  /** The wedding it belongs to: its galleries count as one couple. */
  eventId: string | null;
  /** The wedding's day, or the gallery's own. */
  day: Date;
  ownPhotos: number;
  /** One of its photos is already in a web gallery, copied (by file identity). */
  onWebsite: boolean;
}

/** Fewer own photos than this is not a wedding to show off. */
export const MIN_PHOTOS_TO_SUGGEST = 20;

/**
 * Who is not on the website yet, newest first: one gallery per couple, the fullest. A couple with
 * any of its galleries' photos on the website is covered. There is no link from a web gallery to
 * its source, because photos are copied (docs/WEB-GALLERIES.md), so the copied files are the signal.
 */
export function couplesToSuggest<T extends CoupleGallery>(galleries: readonly T[]): T[] {
  const coveredWeddings = new Set(
    galleries.filter((gallery) => gallery.onWebsite).flatMap((gallery) => gallery.eventId ?? []),
  );
  const fullest = new Map<string, T>();
  for (const gallery of galleries) {
    if (gallery.onWebsite || gallery.ownPhotos < MIN_PHOTOS_TO_SUGGEST) continue;
    if (gallery.eventId && coveredWeddings.has(gallery.eventId)) continue;
    const couple = gallery.eventId ?? gallery.id;
    const best = fullest.get(couple);
    if (!best || gallery.ownPhotos > best.ownPhotos) fullest.set(couple, gallery);
  }
  return [...fullest.values()].sort((a, b) => b.day.getTime() - a.day.getTime());
}

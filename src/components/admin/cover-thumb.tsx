import Image from "next/image";

/**
 * The photo that tells one row from another.
 *
 * A photographer's list of weddings is fourteen rows of two first names and a
 * date; the picture is how you find the right one without reading. Same cover
 * rule as the wedding page (`src/lib/event-access.ts`): the newest confirmed
 * photo, which for a gallery still being filled is also the most recent thing
 * the owner did to it.
 *
 * Prefers the phone-made thumbnail (`thumbObjectKey`) — on Cloudflare that is
 * served straight from the bucket, so a list of twenty rows costs zero billable
 * transformations (docs/GUEST-GALLERIES.md §9). Without one it falls back to
 * the 384px variant the grid already generates for the same photo, so it is
 * still not a new billable width.
 */

export interface AdminCover {
  objectKey: string;
  thumbObjectKey: string | null;
  /** Average colour, "#rrggbb" — fills the tile before any bytes arrive. */
  placeholder: string | null;
}

export function CoverThumb({ cover }: { cover: AdminCover | null }) {
  return (
    <div
      className="border-admin-border bg-admin-surface-muted relative size-16 shrink-0 overflow-hidden rounded-lg border"
      style={cover?.placeholder ? { backgroundColor: cover.placeholder } : undefined}
    >
      {cover ? (
        <Image
          // Decorative: the row's title is right next to it and says the same thing.
          alt=""
          src={cover.thumbObjectKey ?? cover.objectKey}
          fill
          sizes="64px"
          className="object-cover"
        />
      ) : (
        <svg
          viewBox="0 0 24 24"
          aria-hidden
          className="text-admin-placeholder absolute inset-0 m-auto size-6"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <circle cx="8.5" cy="10" r="1.5" />
          <path d="m4 17 5-5 4 4 3-2 4 3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}

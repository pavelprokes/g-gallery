import type { Crumb } from "@/components/ui/breadcrumbs";

/**
 * Breadcrumb trails for the admin portal. Pure functions rather than a layout
 * lookup: the `/admin` layout sits above every dynamic segment and never sees
 * an `[id]`, while each page already has the titles it needs from its own
 * query. Re-querying in a layout would double the round trip to learn what the
 * page below already knows.
 */

const OVERVIEW: Crumb = { label: "Přehled", href: "/admin" };

type EventRef = { id: string; title: string };
type GalleryRef = { id: string; title: string; event: EventRef | null };

/** Přehled / Aktivita */
export function updatesCrumbs(): Crumb[] {
  return [OVERVIEW, { label: "Aktivita" }];
}

/** Přehled / {wedding} */
export function eventCrumbs(event: EventRef): Crumb[] {
  return [OVERVIEW, { label: event.title }];
}

/**
 * Přehled / [{wedding}] / {gallery}
 *
 * A gallery hanging off a wedding routes through it; a standalone gallery skips
 * that step rather than inventing a parent it does not have.
 */
export function galleryCrumbs(gallery: GalleryRef): Crumb[] {
  return [
    OVERVIEW,
    ...(gallery.event
      ? [{ label: gallery.event.title, href: `/admin/e/${gallery.event.id}` }]
      : []),
    { label: gallery.title },
  ];
}

/** The parent's trail with the current page appended, its last crumb turned back into a link. */
function withLeaf(parent: Crumb[], parentHref: string, leaf: string): Crumb[] {
  const trail = [...parent];
  const last = trail[trail.length - 1];
  if (last) trail[trail.length - 1] = { ...last, href: parentHref };
  return [...trail, { label: leaf }];
}

/** Přehled / {wedding} / Cedulka k tisku */
export function eventSignCrumbs(event: EventRef): Crumb[] {
  return withLeaf(eventCrumbs(event), `/admin/e/${event.id}`, "Cedulka k tisku");
}

/** Přehled / [{wedding}] / {gallery} / Cedulka k tisku */
export function gallerySignCrumbs(gallery: GalleryRef): Crumb[] {
  return withLeaf(galleryCrumbs(gallery), `/admin/g/${gallery.id}`, "Cedulka k tisku");
}

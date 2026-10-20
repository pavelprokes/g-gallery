/**
 * The admin gallery grid's filters and sort, kept in the URL so a view can be
 * bookmarked, shared and stepped back through (docs/ADMIN-FILTERS.md). Pure:
 * the page computes each photo's facts, this decides what shows and in what
 * order.
 */

/** Each one narrows the grid; several together must all hold. */
export const ADMIN_FILTERS = [
  "print",
  "favorites",
  "reactions",
  "viewed",
  "highlights",
  "video-draft",
  "tagged",
  "untagged",
  "guests",
  "videos",
] as const;
export type AdminFilter = (typeof ADMIN_FILTERS)[number];

export const ADMIN_SORTS = ["loved", "views", "viewers", "order", "name"] as const;
export type AdminSort = (typeof ADMIN_SORTS)[number];

export interface AdminView {
  filters: AdminFilter[];
  /** Only photos with this person named on them (docs/SOCIAL-VIDEO.md §4). */
  person: string | null;
  /** Only this chapter's photos (docs/CHAPTERS.md). */
  chapter: string | null;
  /** A part of the file name — a camera number like `PPR55013` is enough. */
  q: string;
  sort: AdminSort;
}

export const DEFAULT_VIEW: AdminView = {
  filters: [],
  person: null,
  chapter: null,
  q: "",
  sort: "loved",
};

type Params = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const ID = /^[a-z0-9]{1,64}$/i;

/**
 * Reads a view from the search params. Anything unknown is dropped rather than
 * refused: a hand-edited or outdated URL still opens the gallery. The links
 * from before filters existed (`?print=1`, `?timeline=1`) keep working.
 */
export function parseAdminView(params: Params): AdminView {
  const listed = (first(params.f) ?? "").split(",");
  if (first(params.print) === "1") listed.push("print");
  const filters = ADMIN_FILTERS.filter((filter) => listed.includes(filter));
  const sortParam = first(params.sort) ?? (first(params.timeline) === "1" ? "order" : "");
  const person = first(params.person) ?? "";
  const chapter = first(params.chapter) ?? "";
  return {
    filters,
    person: ID.test(person) ? person : null,
    chapter: ID.test(chapter) ? chapter : null,
    q: (first(params.q) ?? "").trim().slice(0, 100),
    sort: (ADMIN_SORTS as readonly string[]).includes(sortParam)
      ? (sortParam as AdminSort)
      : "loved",
  };
}

/**
 * The query string for a view — defaults left out, so the plain gallery is
 * "" (append it to the path: a bare `?` href is not followed by every engine).
 */
export function adminViewQuery(view: AdminView): string {
  const params = new URLSearchParams();
  if (view.filters.length > 0) params.set("f", view.filters.join(","));
  if (view.person) params.set("person", view.person);
  if (view.chapter) params.set("chapter", view.chapter);
  if (view.q) params.set("q", view.q);
  if (view.sort !== "loved") params.set("sort", view.sort);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** A photo cannot be both tagged and untagged: picking one drops the other. */
const OPPOSITE: Partial<Record<AdminFilter, AdminFilter>> = {
  tagged: "untagged",
  untagged: "tagged",
};

/** The view with one filter switched, in the canonical order. */
export function toggleAdminFilter(view: AdminView, filter: AdminFilter): AdminView {
  const on = !view.filters.includes(filter);
  const opposite = OPPOSITE[filter];
  return {
    ...view,
    filters: ADMIN_FILTERS.filter((f) =>
      f === filter ? on : f === opposite && on ? false : view.filters.includes(f),
    ),
  };
}

/** Whether the view narrows the grid at all. */
export function isFiltered(view: AdminView): boolean {
  return view.filters.length > 0 || view.person !== null || view.chapter !== null || view.q !== "";
}

/** What the page knows about one photo, for filtering and sorting. */
export interface PhotoFacts {
  id: string;
  fileName: string;
  /** The gallery's file-name key (docs/PHOTO-ORDER.md) — "Podle názvu" sorts by it, as guests see. */
  fileOrderKey: string;
  favorites: number;
  reactions: number;
  print: number;
  views: number;
  viewers: number;
  highlight: boolean;
  inVideoDraft: boolean;
  people: readonly string[];
  guest: boolean;
  video: boolean;
  chapter: string | null;
}

const HOLDS: Record<AdminFilter, (photo: PhotoFacts) => boolean> = {
  print: (photo) => photo.print > 0,
  favorites: (photo) => photo.favorites > 0,
  reactions: (photo) => photo.reactions > 0,
  viewed: (photo) => photo.views > 0,
  highlights: (photo) => photo.highlight,
  "video-draft": (photo) => photo.inVideoDraft,
  tagged: (photo) => photo.people.length > 0,
  untagged: (photo) => photo.people.length === 0,
  guests: (photo) => photo.guest,
  videos: (photo) => photo.video,
};

/** Whether a photo shows under the view. */
export function matchesAdminView(view: AdminView, photo: PhotoFacts): boolean {
  if (!view.filters.every((filter) => HOLDS[filter](photo))) return false;
  if (view.person && !photo.people.includes(view.person)) return false;
  if (view.chapter && photo.chapter !== view.chapter) return false;
  if (view.q && !photo.fileName.toLowerCase().includes(view.q.toLowerCase())) return false;
  return true;
}

/** How many photos each filter would leave, on top of the rest of the view. */
export function filterCounts(
  view: AdminView,
  photos: readonly PhotoFacts[],
): Record<AdminFilter, number> {
  const base = { ...view, filters: [] };
  const rest = photos.filter((photo) => matchesAdminView(base, photo));
  return Object.fromEntries(
    ADMIN_FILTERS.map((filter) => [
      filter,
      // Switching to an opposite drops the active one, so it is counted without it.
      rest.filter(
        (photo) =>
          view.filters.every((f) => f === OPPOSITE[filter] || HOLDS[f](photo)) &&
          HOLDS[filter](photo),
      ).length,
    ]),
  ) as Record<AdminFilter, number>;
}

/**
 * Orders photos for a sort other than "order", which the page lays out by
 * chapter itself. Ties keep the order they came in — the gallery's own.
 */
export function sortAdminPhotos<T extends PhotoFacts>(sort: AdminSort, photos: readonly T[]): T[] {
  const by: Record<Exclude<AdminSort, "order">, (a: T, b: T) => number> = {
    loved: (a, b) => b.favorites - a.favorites,
    views: (a, b) => b.views - a.views,
    viewers: (a, b) => b.viewers - a.viewers,
    // Plain string order of the [0-9a-z] key, exactly as the database sorts it.
    name: (a, b) =>
      a.fileOrderKey < b.fileOrderKey ? -1 : a.fileOrderKey > b.fileOrderKey ? 1 : 0,
  };
  return sort === "order" ? [...photos] : photos.toSorted(by[sort]);
}

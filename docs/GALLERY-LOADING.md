# Gallery loading on a slow phone

Adopted 2026-11-02 on Pavel's ask ("když někdo přijde na pomalém internetu…"). Authority for the
order a guest's gallery asks for its images and its photo metadata: which image is fetched first,
what waits, how pages of photos are pulled, and what every existing link must keep doing while any
of that changes. Read it before touching image `loading`/`fetchPriority`, the photos query in
`src/components/gallery-view.tsx`, or the way a `?foto=` / `#chapter` link is opened.

## What was measured (baseline, 2026-11-02)

Production, Alice a Martin (547 photos, 9 chapters). Chromium on an emulated phone — Slow 4G
(DevTools preset: 562.5 ms, 1.44 Mbps) and a 4× slower CPU — median of three runs.
`node scripts/perf-gallery.mjs <gallery url>` reproduces it.

| Opening                        | Today                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------- |
| the gallery                    | first tile on screen 8.2 s, LCP 9.5 s; 15 images (7 on screen) / 1.0 MB      |
| `#cutting-the-cake`            | jump at 10.2 s after 6 sequential `/photos`; 40 images / 3 MB                |
| `?foto=` #343                  | lightbox 10.2 s, thumbnail 13.5 s, **photo 20 s**; 45 images requested first |
| `?foto=` #9 (first page)       | lightbox 3.5 s, **photo 10.8 s**; 20 images requested first                  |
| `?foto=` #343, desktop, no cap | photo 1.6 s (Chromium) – 2.9 s (WebKit); 79 images requested first           |

Where the 20 s go: ~3.5 s waiting for hydration, +6.7 s pulling pages one after another until the
photo is in the grid, +~10 s sharing the connection with the grid behind the dialog (the 349 kB
photo alone is ~2.5 s). And every first image went out at **Low** priority — see below.

## Rules (built)

- **Fetch priority, not `priority`.** Since Next 16 `priority` is a deprecated alias of `preload`:
  it adds a `<link rel=preload>` and nothing else (`get-img-props.js`), which Chrome fetches at Low,
  level with every lazy tile. Next's own docs advise against `preload` where the LCP image depends
  on the viewport — which is every gallery. So:
  - the image the page opens on gets `loading="eager"` + `fetchPriority="high"`: the featured
    film's poster when there is one; else the first three highlights; else the grid's first row of
    photos;
  - the highlights' first three stay eager under a film, without the high priority;
  - the grid's first row is lazy whenever a film or the highlights sit above it — on a phone it
    starts below the fold;
  - the lightbox's photo and the thumbnail under it are eager + high: they are what the viewer is
    waiting for, ahead of the tiles behind the dialog and the neighbours being warmed.
- **No second fetch of page one.** The photos query is seeded with the server's first page and has
  `refetchOnMount: false`; with the default `staleTime: 0` the seed counted as stale on arrival and
  every visit asked for page one again right after hydrating. Uploads and deletions invalidate the
  query explicitly, so they still refresh it, and the refetch on regaining focus stays — it is how a
  gallery left open picks up photos added since.
- **One next page at a time.** Every "next page" goes through one `fetchNextPage` that joins a call
  of ours already in flight. With TanStack's default (`cancelRefetch: true`) the second of two loops
  firing in one commit — a photo link carrying a chapter anchor — aborted the first one's request
  and asked again: every page went out twice. The default still applies to a _background_ refetch,
  on purpose: it is cancelled in favour of the next page, so scrolling, the favourites filter and the
  lightbox's next button never wait for every loaded page to be fetched again, as
  `cancelRefetch: false` on every call would make them.
- **A photo's link: the photo first.** For `?foto={id}` naming a confirmed photo of the gallery
  (`linkedPhotoParam` reads it exactly as `photoParam` does in the browser — the first of a
  repeated parameter):
  - the page carries every page of photos up to that photo, cut by `toPages` into the
    very 60-photo pages, with the very cursors, that pulling them one by one would produce. One big
    page would not do: an infinite query refetches as many pages as it holds from the first page's
    param on, so a 343-photo first page would come back as 60 and move an open lightbox onto another
    photo. At most 10 pages (600 photos, ~120 kB compressed in the HTML): a photo past that, or one
    the count misplaced, is linked as before — the client pulls the pages, with no placeholder and
    nothing held, because both only make sense while the photo is a frame away;
  - the server draws a placeholder layer — the lightbox's black frame, the photo's colour, and the
    images the lightbox is about to ask for (the full size at its `sizes="100vw"`, and the grid
    thumbnail when its URL does not depend on the width) — so they download, at high priority,
    while the page's script does. It is inert and goes once the lightbox has opened;
  - every other image — grid, highlights, film — waits until that lightbox is closed (or the photo
    turns out to be gone), so nothing shares the connection with the one photo being waited for;
  - the browser still opens the link with its own logic, unchanged: the same history entries, the
    same instant scroll under the dialog, the same Back. That is what keeps the contract below.
- **Neighbours after the photo.** The lightbox warms its neighbours (next, previous, one further
  ahead) once the photo on screen has loaded — before, a slow connection was split four ways while
  the viewer waited for the one. A film has nothing to wait for and warms them at once, and a full
  size that fails to load counts as done.

- **A jump's pages in one request.** A chapter link, a chapter chip and a highlight need the photo
  metadata up to their target (row positions depend on every photo above). `throughKey`/`throughId`
  on `/api/g/[token]/photos` returns every page from the cursor up to the one holding that position
  (at most 10), cut by `toPages` like any other; the client appends them with the cursors they
  would have been fetched with. A failure falls back to one ordinary page and the jump's loop asks
  again. A chapter link on Slow 4G used to wait for five pages one after another (~6 s).

- **A chapter's link holds the rows it is about to leave.** With the jump down to one request, the
  grid moved to the chapter while the photos of the rows it first laid out (the top of the gallery)
  were still downloading — an image keeps downloading after its row unmounts — and the chapter's own
  tiles shared the link with them: on Slow 4G the first chapter tile appeared at 18 s. When the
  address names a chapter on arrival (and no photo), the grid's tiles show their colour only until
  the jump has landed; the top of the gallery is never fetched. Read in the state initializer: the
  grid is not server-rendered, so its first render has no rows either way. A 15 s failsafe shows
  what the grid has if the jump cannot finish.
- **Slow mode.** On a slow connection the lightbox asks for the 1080 px variant instead of 1920/2560
  and warms only the neighbour the viewer is heading to (`src/lib/slow-connection.ts`). Slow means:
  Save-Data, or Chromium's own effective type of 3G or worse; where there is no such API (Safari,
  Firefox — most guests are on an iPhone) the median time of the first grid-sized images (the
  thumbnails, never a lightbox photo) from the photo hosts over 1.5 s.
  - `sizes` is `1080 / devicePixelRatio` px: exactly 1080 device pixels, which every selection rule
    lands on 1080 for — a width already in the variant list, so no new billed transformation. It
    saves where the screen alone asks for more (a 3× iPhone: 1920; a retina desktop: 2560); a 2.6×
    Pixel already gets 1080 at `100vw` by Chromium's geometric-mean rule.
  - One rule (`lightboxSizesFor`) for the photo on screen and the neighbour's preload, or the
    preload warms a variant the image does not use. The screen's width for the linked photo (the
    page's placeholder already fetched it at that), while corrections are on, and when zoomed in.
  - Read once per opening (an event, so the photo's first render has it) and kept while the
    lightbox stays open, so a photo on screen never changes width under the viewer. An opening
    always heads forward, whatever the last session's direction was.

**Not changed: the grid's `overscan` (4 rows).** Lowering it to 2 was tried; small galleries then
stop being fully mounted on a phone, which five e2e specs (and the promo/selection flows they
cover) rely on. Revisit only with a measurement that shows the extra rows costing on-screen time
now that the on-screen images are fetched first.

## Link compatibility — the contract

Every shape of guest link that exists today keeps doing exactly what it does today. Measured on
production before any loading change (Chromium desktop, WebKit iPhone 14, Firefox), and it is the
oracle every step below is checked against (`e2e/photo-links.spec.ts`, `e2e/gallery-view.spec.ts`,
`e2e/chapters.spec.ts` — the photo-link spec passes on the code from before the change, except for
its two tests of what is new):

| Link                                                      | Behaviour to keep                                                                       |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `/g/{t}`, `/g/{t}/{slug}`, stale slug, extra segments     | the gallery; the slug never matters                                                     |
| trailing slash                                            | redirected to the address without it                                                    |
| `#chapter`                                                | instant jump to that chapter, hash kept                                                 |
| `#unknown`, `#100%`                                       | start of the gallery, hash removed                                                      |
| `?foto={id}`                                              | lightbox on that photo; Back → the gallery with the photo's tile on screen, `foto` gone |
| `?foto={id}#chapter` (same or another chapter)            | lightbox on the **photo**; Back lands on the photo's tile, not the chapter              |
| `?foto={id}#unknown`                                      | lightbox on the photo; the dead anchor does not survive                                 |
| `?foto={id}&foto={other}`                                 | the first one opens; the address keeps a single `foto`                                  |
| `?fbclid=…&foto={id}` (any other parameter)               | opens; the other parameters stay in the address, also after Back                        |
| `?foto={unknown or deleted id}`                           | nothing opens, `foto` removed                                                           |
| `?foto=` empty or malformed (`a.b`)                       | nothing opens, the address is left as it is                                             |
| `/s/{t}/{slug}/{key}` with any of the above               | the same as the gallery's own `/g/` link                                                |
| `/s/{t}/{stale-slug}/{key}?foto=`                         | opens (the wedding's slug is cosmetic too)                                              |
| `/s/{t}/{slug}?foto=` on a wedding with several galleries | the wedding page; the parameter is ignored                                              |
| `/s/{t}/{slug}/{unknown key}?foto=`                       | "this part is gone" with the way back                                                   |
| reload on an open photo                                   | the same photo opens again; one Back closes it                                          |

One deliberate change: `/s/{t}?foto=` (no slug) redirected to the canonical address and **dropped**
the query, so on a one-gallery wedding the photo did not open. That was a bug, not a contract — the
redirect carries the query now.

## Later, only if measurements call for it

A 768 px phone thumbnail (−40 % per tile; 512 px
would blur portraits on a 3× iPhone), ThumbHash placeholders, leaner page payloads (`faces`/`focus`
are ~38 % of each item and only the projection uses them).

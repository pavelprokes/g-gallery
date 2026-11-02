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
  query explicitly, so they still refresh it.
- **Joined page fetches.** Every "next page" goes through one `fetchNextPage` with
  `cancelRefetch: false`. TanStack's default aborts a page in flight and asks again; a photo link
  carrying a chapter anchor ran two pulling loops in one commit and requested every page twice.

**Not changed: the grid's `overscan` (4 rows).** Lowering it to 2 was tried; small galleries then
stop being fully mounted on a phone, which five e2e specs (and the promo/selection flows they
cover) rely on. Revisit only with a measurement that shows the extra rows costing on-screen time
now that the on-screen images are fetched first.

## Link compatibility — the contract

Every shape of guest link that exists today keeps doing exactly what it does today. Measured on
production before any loading change (Chromium desktop, WebKit iPhone 14, Firefox), and it is the
oracle every step below is checked against (`e2e/gallery-view.spec.ts`, `e2e/chapters.spec.ts`):

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

One deliberate exception: `/s/{t}?foto=` (no slug) redirects to the canonical address and **drops**
the parameter today, so on a one-gallery wedding the photo does not open. That is a bug, not a
contract — the redirect should carry the query (planned with the photo-link work below).

## Next steps (planned, in this order)

1. **Photo link: the photo first.** The page server-renders the pages of metadata up to the linked
   photo (chunked into the same 60-photo pages, with the same cursors, that pulling them one by one
   would have produced — a single big page would come back as 60 on the next refetch and shift an
   open lightbox onto another photo). It also renders a static, non-interactive layer showing that
   photo's thumbnail and full image (the very URLs the lightbox will ask for), and holds every
   other image — grid, highlights, film — until the lightbox is closed. The client-side opening,
   history and scroll logic stays exactly as it is, so the contract above holds by construction.
2. **Chapter link and highlight jump: one request.** `throughKey`/`throughId` on
   `/api/g/[token]/photos` returns every page up to that position at once (docs/CHAPTERS.md names
   this as the upgrade); a failure falls back to today's page-by-page pull.
3. **Slow mode.** On a detected slow connection the lightbox asks for 1080w instead of 1920/2560
   (an existing width — no new billed transformation) and warms one neighbour instead of three.

Later, only if measurements still call for it: a 768 px phone thumbnail (−40 % per tile; 512 px
would blur portraits on a 3× iPhone), ThumbHash placeholders, leaner page payloads (`faces`/`focus`
are ~38 % of each item and only the projection uses them).

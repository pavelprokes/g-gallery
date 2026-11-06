# Gallery loading on a slow phone

Adopted 2026-11-02 on Pavel's ask ("když někdo přijde na pomalém internetu…"). Authority for the
order a guest's gallery asks for its images and its photo metadata: which image is fetched first,
what waits, how pages of photos are pulled, and what every existing link must keep doing while any
of that changes. Read it before touching image `loading`/`fetchPriority`, the photos query in
`src/components/gallery-view.tsx`, or the way a `?foto=` / `#chapter` link is opened.

## What was measured (baseline, 2026-11-02)

Production, Alice a Martin (547 photos, 9 chapters). Chromium on an emulated phone — Slow 4G
(DevTools preset: 562.5 ms, 1.44 Mbps) and a 4× slower CPU — median of three runs.
That was DevTools throttling, Chromium only; runs since 2026-11-03 use `pnpm perf:gallery`
(docs/DEVICE-TESTING.md) — a packet-level link for every engine, whose numbers are not comparable
with these.

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
- **Clicks are never ignored; loading waits for a pause.** Browsing a click a second or faster —
  looking for one photo, or trying to break it — every click moves the counter and the photo on
  screen at once; nothing is throttled. What waits is the expensive part: a hurrying viewer (one who
  moved on before the photo they left had loaded) gets a photo's full size only once they have
  stayed on it for 1.5 s (`LIGHTBOX_PAUSE_MS`) — a click a second is hurrying, and is shown
  thumbnails (at a pause of exactly 1 s, a click every second landed just after each pause and
  started every full size anyway). No pause for a photo whose full size has already drawn (back to
  the one just left) or while zoomed in (the viewer is asking for detail). An ordinary step (the
  photo left had loaded) shows the next full size at once, usually from the warmed cache. A full
  size the viewer left before it arrived is dropped: unless the element drew it, the element moves
  straight on to the new photo's thumbnail, and Chromium and Firefox cancel a load no element wants
  (WebKit lets it finish). Only to a real thumbnail: a photo without one has the same `src` for its
  tile and its full size (only `sizes` differs), and next/image reports a load only when `src`
  changes — its full size would draw unreported, under its tile. The "still loading" spinner counts
  its 1.2 s from the full size's request, not from the click. A load is credited to the photo whose
  pixels the element actually drew (next/image reports after decoding, by which time a fast click
  may have moved the element on).
- **The right photo on screen at every step.** The lightbox keeps the previous photo's pixels until
  the next one can be drawn (never a black gap). Once the next photo's thumbnail has drawn it goes on
  top, on black, so the old photo cannot show around a different shape (portrait after landscape);
  the full size replaces it. The thumbnails of the next two photos in the viewer's direction and the
  previous one are preloaded at once (a few dozen kB each, only those served straight from the bucket,
  whose URL does not depend on the width), so that thumbnail is there at the next click. The photo
  layer is its own stacking context (`isolate`): the raised thumbnail never covers the arrows or bars.
- **One neighbour, after the photo on screen.** The next photo's full size in the viewer's
  direction is warmed once the photo on screen has loaded (or failed — a film has nothing to wait
  for) and stayed 250 ms (`LIGHTBOX_WARM_MS`): never alongside the photo being waited for, never
  while the viewer is clicking through (their photos have not loaded), and never more than one. The previous photo has usually been seen and is in the cache. Warming three
  (next, previous, one further ahead) kept a 4G link busy for seconds with 1–1.7 MB retina files,
  and the thumbnails a hurrying viewer clicked to arrived up to 3 s late: measured 2026-11-03 with
  `pnpm perf:gallery` (docs/DEVICE-TESTING.md), a packet-level 4G link, a click every 400 ms —
  Safari 12 of 15 steps and Chrome on a retina Mac 9 of 15 showed the photo before the one on the
  counter, Chrome 9 of 15 even at a click a second. (The first fix, measured with DevTools'
  per-request throttling in Chromium alone, had shown 0 of 40: that throttling never lets queued
  bytes delay a later request, and WebKit could not be throttled at all.) Thumbnail preloads ask
  for high priority, where browser and server honour it. After,
  on a local build of the same gallery (`pnpm mirror:gallery`), steps where the counter's photo was
  not on top by the next click: a click every 400 ms on 4G 0–6 of 30 (17–23 before); a click a
  second 0 of 30 on 4G and 0 of 20 on Slow 4G (12 of 20 before); a photo every 3 s unchanged, its
  full size on screen ~70 ms after the click.
- **The next page before the end.** When the photo on screen is among the last five loaded, the
  lightbox fetches the next page of photos, so "next" never holds in place waiting for it — but not
  again after a failed page (a revoked link would otherwise be asked forever).
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
  address names a chapter on arrival (and no photo), the grid's tiles show their colour only while
  that arrival jump is pending; it ends when the jump does — landed, dropped, or the pages failing
  to arrive. The chapter is read from the address in a state initializer that is never rendered
  (the grid is not server-rendered, so its first render has no rows either way). Ceiling: a featured
  film or the highlights above the grid are server-rendered and their images are already requested
  by the HTML, which cannot know the hash.
- **Slow mode.** On a slow connection the lightbox asks for the 1080 px variant instead of 1920/2560
  (`src/lib/slow-connection.ts`). Slow means:
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

- **The grid's screen first.** The tiles in the rows on screen (the virtualizer's own range, without
  its overscan) hold a gate shut until they have drawn (`src/lib/screen-gate.ts`); the tiles in the
  overscan rows fetch theirs only once nothing on screen is still loading. A screen of a phone is
  6–8 tiles, of a desktop 15–20; the overscan doubled that, and on a slow link every image arrived
  late together instead of the screen first — native `loading="lazy"` fetches anything within
  1250–2500 px of the viewport, the overscan included, at once. A tile that has drawn keeps its
  image; one off screen that has not lets its download go when the gate shuts for the next row
  coming on screen (keeping those running was measured: scrolling a screen in Firefox on Slow 4G
  took 7.4 s instead of 2.4 s); a new `src` (a fresh grant, a replaced photo) waits its turn like
  any other. A tile whose image fails for good — its fallback too, or at once when there is no
  browser-made thumbnail and the fallback is the same image — counts as drawn, and none holds the
  rest back for longer than 15 s from asking for its image (`SCREEN_WAIT_MS`, a stalled request).
  Measured on a local build of Alice a Martin (`pnpm mirror:gallery`), Slow 4G, median of three:
  the first screen complete on Chrome at Windows' 125 % 14.3 → 8.1 s, a 1366×768 laptop 10.2 →
  7.8 s, Firefox 13.1 → 9.1 s, a Pixel 7 (CPU 4×) 7.3 → 6.0 s; images off screen requested before
  the screen's last one arrived 8–22 → 0–2. WebKit (iPhone, Safari) unchanged at 5.7 s and 9.2 s:
  it already held lazy images back. On 3G the screen alone fills the link (~21 s either way); the
  first tile unchanged everywhere (~3 s on Slow 4G).
- **The screen from the top, a row at a time.** Pavel, 2026-11-06: can the photos load from the top
  down? A row on screen fetches once every row above it on screen has drawn. Priority cannot do
  this: Chrome raises every lazy image in the viewport to High, so all but the first row's eager
  ones go out at one `u=1, i` and the CDN (HTTP/2, no HTTP/3 offered) picks their order. On a
  packet-level link it sends them nearly one after another, in no order of ours: the screen filled in
  at random. **DevTools shows something else:** its throttling splits the bandwidth among requests,
  so there every tile fills at once, which no guest sees. Rules:
  - the turn moves down only once nothing up to it is left, and never back. A row coming on screen
    above it (scrolling up) is within it and goes at once, and a download on its way stays while its
    tile is on screen: an overscan row scrolled into view keeps what has arrived. So a jump up while
    a lower screen is still loading goes at once for that screen, as before;
  - the overscan is not ordered: nobody sees its order, and ordering it would only delay it;
  - a row, not a tile. One tile at a time, on the live link at 3G with the requests held back in the
    browser, took 31.7 → 38.7 s on a desktop's screen, a round trip per tile.

  Measured with main against this, local builds of Alice a Martin, A-B-B-A, two runs per build (3G /
  Slow 4G). Of the pairs of tiles in different rows, those drawn the wrong way round: 2–50 % / 11–59
  % → 0. The first row: a phone 20.4–21.2 → 15.0–15.7 s / 5.3 → 4.0–4.5 s, Firefox 24.0 → 21.1 s / 6.8
  → 5.4 s, Chrome 22.3 → 22.1 s / 5.8 → 5.7 s. The whole screen: +0.6–1.1 s of 21–37 s / +0.4–0.6 s
  of 5–9 s, a round trip per row with the link idle. The average tile within ±6 %. Scrolling a screen
  on Slow 4G: Chrome 6.3 → 6.3 s, Firefox 4.5 → 4.6 s, iPhone 2.3 → 2.3 s, a Moto G4 2.3 → 2.5 s. A
  photo's link unchanged. The first tile to draw comes later (phone: 3G ~10 → ~13 s, Slow 4G ~0.5 s):
  it used to be whichever file was smallest, and here the first row held the two largest of the
  screen (134 and 198 kB), which used to arrive last.

**Not changed: the grid's `overscan` (4 rows).** Lowering it to 2 was tried; small galleries then
stop being fully mounted on a phone, which five e2e specs (and the promo/selection flows they
cover) rely on. Revisit only with a measurement that shows the extra rows costing on-screen time
now that the on-screen images are fetched first.

- **The photo blurred before it arrives.** Every frame that is the photo's own shape — a grid
  tile, a highlight, the frame the server draws for a photo's link, and the lightbox until it has
  drawn anything at all — shows the photo blurred over its average colour instead of the colour
  alone (`src/lib/thumbhash.ts`). The blur is a ThumbHash: ~21 bytes, 28 characters of base64 in
  `Photo.thumbhash`, computed in the uploading browser next to the dimensions (one decode of the
  file) and validated on confirm; the browser renders it to a ~32 px PNG in well under a
  millisecond (measured 0.17 ms on a Mac), cached per hash. It adds ~2 kB to a 60-photo page — ~40
  ms on a 3G-speed link, against ~1.2 s for one real thumbnail — and nothing arrives sooner; it
  fills the 13–15 s (3G) or 3.5–4 s (Slow 4G) a phone otherwise showed flat tiles, and every fast
  scroll. Rules:
  - stretched to the frame, never letterboxed by its own shape: the hash keeps the aspect ratio
    only approximately, and the frame already has the exact one. So not on the featured film's
    card, which letterboxes a portrait clip in a box capped at 70 % of the screen; it keeps the
    colour;
  - what the server draws into the HTML — the highlights, a photo link's frame — gets the blur as a
    data URL made on the server (`src/lib/thumbhash-server.ts`), deflated: ~860 characters, ~0.7
    kB gzipped, where the browser's own uncompressed one is ~4.2 kB (~2.1 kB gzipped) and six
    highlights would have added ~13 kB to the HTML read first. Each goes out twice, in the tile's
    `style` and in the client component's RSC props, as anything a component renders does: measured
    on six, the second copies are 6.1 kB raw, 3.2 kB gzipped (further apart than gzip's 32 kB window)
    and 37 bytes with the Brotli Vercel serves. The grid is drawn in the browser and decodes the
    28-character hash there;
  - several pages in one response — a photo's link (up to 10 pages in the HTML) or a jump's
    `throughKey` — carry it on the last two pages only (`blurOnLastTwoPages`): the last is where the
    viewer lands, and the rows above a target at the top of that page come from the one before. On
    600 photos all of them would be ~20 kB read before the one photo being waited for. Scrolled back
    to, the others show the colour until a refetch, as nothing pulls them again. A link whose photo
    turns out not to be in those pages keeps the blur on every page: the viewer stays on the first;
  - the lightbox shows it only before its first pixels (an SVG letterboxing it at the photo's exact
    shape). A step still holds the previous photo until the next one's thumbnail can be drawn —
    blurring on every step is a change of that rule, to be measured before it is made;
  - the colour under it is now the hash's own average. The 1×1 resize it came from before sampled
    near the middle of the photo in Chromium (a castle came out green from the ivy by its door; on
    Alice a Martin 46 of 60 colours were closer to the centre than to the average). The upload now
    halves the decoded bitmap step by step to ≤100 px with bilinear sampling, each step an exact 2×2
    average — checked in Chromium, WebKit and Firefox on a 4033 × 3025 checker of single pixels,
    which came out grey in all three;
  - photos from before: `pnpm backfill:thumbhash` (`--dry-run` only counts, and downloads nothing)
    fills the hash and the corrected colour from the thumbnail in the bucket (512 px on a guest's
    photo, 1024 px on the photographer's; no transformation billed), or from the grid's smallest
    variant for a photo without one or whose thumbnail object is gone. It writes to the database
    `DIRECT_URL` names — Pavel runs it — only if the row still holds the key it read, and exits 1 if
    any photo failed, each with its reason. A replaced photo (docs/REPLACE-PHOTOS.md) or a new video
    poster gets a new hash or none, never the old picture's.

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
would blur portraits on a 3× iPhone) — its backfill can share a run with `backfill:thumbhash`;
leaner page payloads (`faces`/`focus` are ~38 % of each item and only the projection uses them).

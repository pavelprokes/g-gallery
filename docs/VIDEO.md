# Video — the photographer's films in a gallery

Adopted 2026-10-17. Authority for anything that stores, shows, plays or hands out a video. Guest
video stays out of scope (`docs/GUEST-GALLERIES.md` §14): a guest's MP4 is refused exactly as
before.

## Why it is this small

Expected volume: about three galleries a year, one or two short films each (a teaser, the first
dance). That decides everything below: **no transcoding service**. The photographer exports a
web-ready MP4, it is stored byte for byte in R2, and the browser's own `<video>` plays it straight
from the bucket. Checked against Cloudflare's docs on 2026-10-17:

| Option                                | Why not                                                                                                         |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Cloudflare Stream                     | $5/month minimum for ~6 films a year, a second media pipeline, and no EU-only storage (R2 is `jurisdiction=eu`) |
| Media Transformations for playback    | input ≤ 100 MB / 10 min, **output ≤ 60 s** — cannot serve a 3-minute film                                       |
| Transcoding on Vercel or in a Worker  | breaks invariant 1, or is new infrastructure for six files a year                                               |
| **MP4 straight from R2** (what we do) | R2 honours `Range`; egress is free; one presigned PUT takes up to 5 GiB; cost rounds to $0                      |

## The input format

Shown to the photographer at the upload spot in the admin (`src/components/uploader.tsx`):

- **MP4, H.264 video, AAC audio.** The one combination every browser plays. MOV and HEVC are
  refused by name — an iPhone's default HEVC plays in Safari but often not in Chrome or Firefox on
  Windows. Checked on the file's `stsd` box, not by whether the uploading browser decodes it.
- **The limit is resolution, not size** (Pavel, 2026-10-17): at most **4K — 4096 px on the long
  edge**, portrait or landscape, so UHD 3840 and cinema 4096 both pass (`VIDEO_MAX_LONG_EDGE_PX`).
  Read from the `avc1` sample entry before anything is signed, and again from the decoded frame.
  1080p at 8–10 Mbit/s (~200 MB for 3 minutes) is recommended — it starts faster on a phone in a
  venue; 4K at 35–45 Mbit/s is ~900 MB for 3 minutes and is fine.
- File size is not a policy. The only ceiling is technical: **2 GiB** (`VIDEO_MAX_BYTES`), because
  `Photo.sizeBytes` is a Postgres `int4` — about 6 minutes of 4K at 45 Mbit/s, 30 of 1080p.
  Widening it to BigInt would lift this to R2's 4.995 GiB single-PUT limit. Past Cloudflare's 512 MB
  cache limit a film still plays — served from R2 range by range, egress-free — it is just not
  held at the edge.
- **No location metadata** (invariant 2). A photo's GPS is stripped in place; a video is refused
  instead (`src/lib/mp4-inspect.ts` matches `©xyz` and any ISO 6709 value in `moov`). An editor's
  export never has one; a phone clip does, and re-exporting is the honest fix.
- Resolve: Deliver → MP4, H.264, 8–10 000 kb/s, "Network Optimization" on where offered (puts
  `moov` first so playback starts sooner; not required — R2 serves the tail by Range).

Nothing converts the file afterwards: guests stream and download exactly what was uploaded.

## The data model: the poster is `objectKey`

A video is a `Photo` row, because it must open in the lightbox, take arrow keys, favourites,
chapters, the file-name order and the ZIP — everything that indexes the `photos` array. The opposite
choice to promo cards (`docs/PROMO-CARDS.md`) for the opposite reason: those must _not_ do any of it.

The trick is which key means what:

| Column                                       | On a video                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| `objectKey`                                  | the **poster frame**, a JPEG `<uuid>.jpg` drawn by the uploading browser |
| `videoObjectKey`                             | the MP4, `<uuid>.mp4` — same stem, derived on the server (`videoKeyFor`) |
| `thumbObjectKey`                             | the grid thumbnail, made from the poster, `<uuid>.thumb.webp` as always  |
| `durationMs`                                 | read in the browser at upload                                            |
| `fileName`, `sizeBytes`, `crc32`, `mimeType` | **the MP4's** — what a download delivers                                 |

So every surface that only knows `objectKey` shows the poster and needed no change: the grid
image, the cover, the link preview, the wedding page, offline. **Forgetting about video somewhere
degrades to a still image, never to a broken one.** The orphan sweep (`src/lib/reconcile.ts`) spares
the MP4 because its stem belongs to a live row — no change there either (pinned by a test).

## What does know about video

Everything reads from `src/lib/video.ts`.

| Concern                                         | Where                                                                       |
| ----------------------------------------------- | --------------------------------------------------------------------------- |
| Owner-only acceptance of `video/mp4`            | `classifyContentType(…, { allowVideo })`, `src/lib/upload-content-types.ts` |
| Header checks (location, codec), before presign | `videoProblem`, `src/lib/video-prepare.ts`, called from `runUploads`        |
| Poster, duration, CRC32                         | `prepareVideoUpload` (main thread — needs a `<video>` element)              |
| Signing the MP4 + a **required** poster PUT     | `bytesTarget`, `src/app/api/uploads/presign/route.ts`                       |
| Size checked on the MP4, poster must exist      | `src/app/api/uploads/confirm/route.ts`                                      |
| Tile badge, lightbox player                     | `PhotoTile`, `LightboxVideo` in `src/components/gallery-view.tsx`           |
| ZIP entry is the MP4                            | `downloadKeyOf` in `api/g/[token]/zip` and `src/lib/zip-build.ts`           |
| Deleting the MP4 with its row                   | `deletePhotos` (`src/app/admin/actions.ts`), `deleteGalleryWithObjects`     |
| Left out: highlights, print marks, slideshow    | `loadHighlights` + the admin pick, `api/g/[token]/print`, `projectable`     |
| Admin badge                                     | `src/app/admin/g/[id]/page.tsx`                                             |

Retention tiering needed nothing: it flags rows, and R2's own rule moves objects by prefix.

## The player

The browser's native `<video controls playsInline preload="none" poster>` — no player library.

- **Why native:** it is the only player that is right on every platform by default — iOS's own
  fullscreen and AirPlay, Android's controls, keyboard and screen-reader support, picture in
  picture — at 0 kB. A library (video.js, Plyr) earns its weight with HLS/DASH, captions,
  analytics or branded chrome; a progressive MP4 needs none of that.
- `preload="none"`: no bytes until the guest presses play; the poster stands in.
- **Nothing autoplays.** Swiping onto a film must not start it with sound, and Safari refuses
  autoplay with sound anyway. Desktop Chrome and Firefox draw no play button over a paused video,
  so the lightbox adds one big button until the first play.
- **Keyed by photo id**, unlike `LightboxPhoto`: leaving a film must stop it, and unmounting is the
  one way that is certain everywhere.
- No zoom/pan gestures (`touch-none` would swallow the scrubber); a passive horizontal swipe that
  never starts on the bottom 64 px. The box stops short of the top and bottom bars so the native
  controls are never under them.
- A focused `<video>` keeps Space and the arrows (play, seek); Escape still closes.

The MP4's URL is `NEXT_PUBLIC_MEDIA_BASE_URL` (local MinIO) or else the image host, which in
production _is_ the bucket's custom domain (`videoSrc`).

## Featured film

One film per gallery can lead it: a large poster card with a play button, "Svatební film" and the
length, above the highlights (`Gallery.featuredVideoId`, added 2026-10-18). The photographer sets it
from the admin grid with "Nastavit jako hlavní film" under a video tile (`setFeaturedVideo`); pressing
it again clears it.

- Only a CONFIRMED row with a `videoObjectKey` of the same gallery can be set, and `featuredFilmOf`
  re-checks that on every page load, so a stale pointer draws no card. `SetNull` on delete, like the
  cover.
- The card opens the player directly — a deliberate exception to the highlights' "jump into the
  grid" rule (`docs/HIGHLIGHTS.md`): a film is watched, not looked for. When the film's page is
  loaded it opens in the lightbox at its own place, with next/previous and the heart; otherwise the
  same `LightboxVideo` plays in a standalone dialog rather than fetching every page before it.
- The film keeps its own place in the grid too.

## Ordering

A delivered gallery is ordered by file name (`docs/PHOTO-ORDER.md`), so a film is placed by naming
it: `svatba_0412_tanec.mp4` sits right after `svatba_0412_*.jpg`. In capture-time order the
container's `mvhd` creation time is used, else the file's mtime — usually the render time for an
edited export, which is why the admin hint talks about names.

## Known gaps and what to watch

- **Safari and Cloudflare's cache.** Cloudflare documents MP4s turning black on iOS/macOS Safari
  when range responses are served from cache with weak ETags; its fix is a Cache Rule for `*.mp4`
  (respect strong ETags, else bypass cache). Not reproduced with R2 yet — **play the first real
  video on a real iPhone after deploying**, and add the rule if it misbehaves.
- **Signed image URLs.** If `NEXT_PUBLIC_SIGNED_IMAGES_URL` is ever turned on, the MP4 is still a
  plain bucket URL (like the pre-built ZIP). Signing it means a `/vid/` route in `worker/` passing
  `Range` through.
- **Big uploads are one PUT.** A failure restarts the file. The MP4's presigned URL lives six
  hours (`VIDEO_PUT_EXPIRY_SECONDS`, photos keep 15 minutes), so a multi-GB film on a slow uplink
  finishes under one signature. If multi-GB films become normal, multipart upload goes here.
- Out until asked for: guest video, a separate master next to the web file, choosing the poster
  frame (it is taken at 25 % of the length).
- E2E (`e2e/video.spec.ts`) plays only in WebKit: Playwright's Chromium has no H.264 decoder. The
  location refusal runs on both.

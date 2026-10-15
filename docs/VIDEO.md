# Video — the photographer's films and clips in a gallery

Adopted 2026-10-15. Authority for video in a gallery (`Photo.kind = VIDEO`, `Gallery.featuredVideoId`)
and for the looping hero video on the landing page. Read before touching the upload routes'
content-type split, anything that turns an item's `objectKey` into an image, or the "download all"
archive's contents.

## Why, and why this small

Every competitor delivers video and couples expect the film next to the photos. Pavel delivers
**one or two videos a year** (2026-10-15), so the scope is the smallest thing that does that well, not
a video platform. The team review that led here (five personas, 2026-10-15) compared serving the
file from R2, Cloudflare Stream, Media Transformations, AWS (S3 + MediaConvert + CloudFront),
Bunny/Mux, YouTube unlisted, Google Drive and Vimeo; the findings are kept in §8 so nobody has to
redo them.

## 1. Decisions (Pavel, 2026-10-15)

| Question                  | Decision                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------- |
| Who uploads video         | **The photographer only**, from the admin. A guest upload of `video/*` is still refused (415, `video`). |
| What is uploaded          | **A web-ready H.264 MP4** — the export every editor has a preset for. No separate master.               |
| Size                      | **Under 2 GiB** per file (`Photo.sizeBytes` is `Int`). A 5-minute 1080p film is 0.3–1 GB.               |
| Where it is stored        | R2, next to the photos, same `storagePrefix`. No transcoding service, no second cloud.                  |
| Access control            | Same as photos: unguessable key, optional signed grant (docs/PLAN.md §4.1). No per-request Worker gate. |
| What the client downloads | The same file that plays — it _is_ the deliverable.                                                     |
| Hero video on the web     | A short muted loop on the landing page (this repo) and on the main site (docs/HANDOFF-MAIN-SITE.md).    |

## 2. Data model

- `Photo.kind` — `PHOTO` (default) or `VIDEO`. Additive; every existing row is a photo.
- `Photo.durationMs` — read in the browser at upload; null for photos.
- `Photo.posterObjectKey` — a still frame, `<uuid>.poster.jpg`, stored beside the video. **Derived
  from `objectKey` on the server, never client-supplied** (same rule as `thumbObjectKey`).
- `Photo.thumbObjectKey` — for a video, the browser-made grid thumbnail _of the poster_.
- `Gallery.featuredVideoId` — the film shown as the large card above the highlights. `SetNull` on
  delete. Only a CONFIRMED `VIDEO` row of the same gallery may be set.

### The image an item shows is `displayKey`, not `objectKey`

Everything that renders an item as an image — grid tile, lightbox preview, highlights, admin
thumbnails, offline precache — receives the **poster** for a video, through the same `objectKey`
field it always read. The substitution happens once, where rows leave the database for the client
(`src/lib/media.ts` → `displayKeyOf`), so the image pipeline (loader, transforms, signed grants)
needs no video branch and **a video key can never reach Image Transformations**. The video's own
key travels separately as `video.key`, and only the player and the download use it.

Server-side image consumers that pick "a photo" by themselves — the gallery cover, the share
preview (OG), the wedding page's cover tiles, the highlight fill, print — filter to `kind = PHOTO`.
A film is never anyone's cover by accident (it is usually uploaded last, i.e. the newest item).

## 3. Upload

Owner only, same pipeline as photos (browser → R2 presigned PUT, invariant 2), with a video branch
in the browser (`src/lib/video-prepare.ts`):

1. **Accepted:** `video/mp4` from the owner. Any other `video/*` from the owner is refused with
   reason `video_format` ("export it as H.264 MP4"); from a guest, with `video` as before.
2. **Playable here, or not uploaded.** The file is loaded into an off-screen `<video>`; if the
   browser cannot decode it (HEVC in Chrome, 10-bit 4:2:2, ProRes in an `.mp4`), there is no poster
   and the upload stops with a sentence saying why. The check is the poster: a browser that can draw
   a frame can play the file. This is also why there is no separate "playability" flag in the schema.
3. **Poster:** a frame at 10 % of the duration (films open on black), capped at 1920 px on the long
   edge, JPEG. The grid thumbnail is made from the poster by the existing `makeThumbnail`.
4. **Metadata:** `durationMs` and display dimensions from the `<video>` element (the browser has
   already applied the rotation matrix, so a vertical phone clip packs as vertical). Capture time from
   the MP4 `mvhd` creation time, else the file's mtime. QuickTime writes that time in UTC; some
   cameras write local time into it — a known ceiling, the same class as a camera with its clock off.
5. **Location is removed** before the PUT, as for photos: ISO 6709 coordinates in the `moov` box
   (`©xyz`, `com.apple.quicktime.location.ISO6709`) are overwritten in place with zeros of the same
   length, so no box size changes. Only the `moov` box is read, never the whole file.
6. **CRC32** over the exact bytes stored, streamed (`crc32HexOfBlob`) — the ZIP writer needs it.
7. **Presigned PUT expiry is 3 hours for a video** (15 minutes for photos): 2 GB on a 10 Mbit/s
   uplink is ~27 minutes, and whether R2 checks expiry only when the request starts is unverified.

## 4. Showing it

- **Tile:** the poster through the image loader, a ▶ + duration chip (`bg-black/60`, contrast on a
  white poster), label "Přehrát video …, 1 minuta 42 sekund". Never a `<video>` element in the grid
  — the grid must not download video bytes, the same spirit as the instant-scroll rule
  (docs/CHAPTERS.md).
- **Lightbox:** a `<video playsinline preload="metadata" controls>` with the poster. Native controls
  sit in their own layer with pointer events stopped, so scrubbing is never a swipe; swiping and
  swipe-down still work on the area around them. No pinch or double-tap zoom on a video. Moving to
  another item pauses it. Space/K play-pause on a video (S keeps selecting); arrows still move.
- **Can't play here** (`error` event, or no `loadeddata` within 10 s): the poster stays, with
  "Tohle video váš prohlížeč neumí přehrát" and a download button with the size. Never a black box.
- **Featured film:** one per gallery, a large card above the highlights strip; tapping it opens the
  player directly. A deliberate exception to the highlights' "jump into the grid" rule
  (docs/HIGHLIGHTS.md). The film also keeps its place in the grid.
- **Order:** a video is an item like a photo — capture time or file name (docs/PHOTO-ORDER.md), and
  chapters contain it like any other item.

## 5. Where video is left out

| Surface                                       | Behaviour                                                            |
| --------------------------------------------- | -------------------------------------------------------------------- |
| Pre-built "download all" ZIP                  | Excluded. A film is its own download, with its size on the button.   |
| "Download all" on demand (`/zip` with no ids) | Excluded, same reason.                                               |
| Explicit selection / single item              | Included — the viewer chose it. A single item is streamed as itself. |
| Highlights (automatic fill and pins)          | Excluded. The featured film is the video's place at the top.         |
| Slideshow                                     | Skipped (unattended projector, sound at the venue).                  |
| Offline mode                                  | The poster is cached like any photo; the video bytes never are.      |
| Covers, OG preview                            | `kind = PHOTO` only.                                                 |
| Print selection                               | Not offered on a video.                                              |
| Guest uploads                                 | Refused, as before.                                                  |

## 6. The hero loop

A 10–20 s, muted, looping clip in place of the landing page's phone mockup, and the same file on the
main site.

- **Export:** H.264 MP4, 720p (or the mockup's own size), 2–4 Mbit/s, no audio track, `faststart`,
  under ~5 MB. Plus a poster JPEG/WebP of the first frame.
- **Markup:** `<video autoplay muted loop playsinline preload="metadata" poster=…>` — muted +
  `playsinline` is what lets it autoplay on iOS and Chrome. The poster is the LCP element, the
  video never is.
- **Not played** under `prefers-reduced-motion: reduce` or Save-Data — the poster is shown instead.
  iOS Low Power Mode refuses autoplay on its own; the poster covers that too.
- **Configured, not committed:** `NEXT_PUBLIC_LANDING_HERO_VIDEO` and `…_POSTER` (URLs). Unset, the
  page renders exactly as before.

## 7. Deferred — and what reopens each

| Deferred                                    | Reopen when                                                                  |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| Multipart upload, files ≥ 2 GiB, masters    | A delivery needs a file over 2 GB, or couples ask for the camera master.     |
| Transcoding (AWS MediaConvert, §8)          | Photographers regularly upload clips the browser cannot play.                |
| Per-request Worker gate for video           | Revocation must cut a video off immediately (it applies to photos equally).  |
| Captions (`.vtt`, WCAG 1.2.2)               | Speeches or ceremony recordings are delivered, not only a music-backed film. |
| Guest video                                 | Guests ask for it at a real wedding (docs/GUEST-GALLERIES.md §14).           |
| Hover preview, PiP, chapter marks in a film | Never asked for so far.                                                      |

## 8. What the 2026-10-15 review found (so it need not be redone)

Prices verified the same day; AWS from the official Price List API (eu-central-1), Cloudflare from
its docs repo.

- **R2:** $0.015/GB-month, egress $0. At 1–2 videos a year the whole feature fits in the 10 GB free
  tier. Cloudflare's CDN does not cache objects over 512 MB on Free/Pro — irrelevant while egress is
  free. Video served from R2 through the CDN is allowed by the 2023 ToS update.
- **Cloudflare Stream:** $5 per 1 000 minutes stored + $1 per 1 000 delivered; no byte-exact
  original; no Regional Services. Ruled out on cost and EU.
- **Cloudflare Media Transformations:** input ≤ 100 MB and ≤ 10 min, H.264 MP4 only. Cannot make a
  poster of a film.
- **AWS:** S3 Standard $0.0245/GB, Glacier Instant Retrieval $0.005/GB (+$0.03/GB read, 90-day
  minimum); CloudFront EU $0.085/GB, or the flat-rate Pro plan ($15/month, 50 TB, 10 M requests,
  throttled rather than billed beyond it); MediaConvert Basic $0.0085 per normalised minute, HD H.264
  ≤ 30 fps ratio 2 → **$0.017 per output minute**. MediaConvert reads HTTP inputs only when they are
  public and carry **no query string** (so not an R2 presigned URL), and writes to S3 only. CloudFront
  signed URLs cannot be revoked before they expire. If transcoding is ever needed: R2 storage +
  MediaConvert reading the public R2 URL + a cron polling `GetJob` + a Worker copying the output back.
- **YouTube unlisted / Google Drive / Vimeo:** all three break server-side expiry and revocation
  (invariant 5). YouTube: Content ID mutes or blocks wedding music even on unlisted videos, ads,
  end-screen suggestions, cookie consent for the embed, no download. Drive: playback capped at 1080p,
  "too many views" lockouts up to 24 h. Vimeo: the most professional of the three, but paid plans and
  US storage.
- **Browser support:** HEVC is Safari-native, partial and hardware-dependent in Chrome and Firefox —
  which is why the upload insists on H.264.

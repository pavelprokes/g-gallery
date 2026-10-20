# Slideshow maker — a free video from anyone's photos

Built 2026-10-20 at Pavel's request: a public page that turns a visitor's own photos into a short
video for social media, marketed with the wedding photography. Czech first (`/video-z-fotek`); the
other six languages follow once the Czech page is settled.

## 1. Decision: everything in the visitor's browser

Pavel's brief asked for "as much as possible on the client" and floated a separate R2 bucket and a
captcha before each upload. Chosen on 2026-10-20 (Pavel): **nothing is uploaded at all**.

- The pipeline already runs in a browser — the admin's social video (docs/SOCIAL-VIDEO.md): the face
  worker, the camera, `drawFrame`, the WebCodecs encoder. A server would add nothing to the result.
- An anonymous public upload bucket is a liability, not a feature: strangers' faces (GDPR), a free
  host for illegal content, storage and egress cost, and a lifecycle to get right.
- With no upload there is nothing server-side to protect, so **no captcha** — it would only stand
  between a person and the tool. If a server step is ever added, it needs Turnstile (verified
  server-side) and its own bucket, never the galleries' one (CLAUDE.md invariants 1–2).
- The page says it plainly: the photos never leave the device. That is also its best selling point.

## 2. The pipeline

1. **Intake** (`src/lib/slideshow/intake.ts`): `fileProblem` (type, bytes), decode with
   `createImageBitmap(..., { imageOrientation: "from-image" })`, `sizeProblem` (pixels), shrink to
   2880 px on the long side (what `sourceWidth` asks of a 3:2 photo for either format) and a 360 px
   thumbnail, both re-encoded as JPEG — which drops every EXIF tag, GPS included. Capture time is read
   from the original's EXIF first (`readTakenAtFromJpeg`). Two files at a time.
2. **Check**: the face worker (`createFaceFinder`) photo by photo. The faces aim the camera
   (`shotsFor`) and mark photos where someone has their eyes shut (`checkPhoto(...).closed`). A
   worker that cannot start leaves the photos usable, unmarked, with the camera on its faceless aim.
3. **Turned the other way** (Pavel, 2026-10-20): a landscape photo in a 9:16 video, or a portrait
   one in 16:9 (`isAcross`, more than 10 % off square), is shown whole — a `fit` shot — over a
   tiny copy of itself stretched to fill the frame and darkened (`SlideImages.blurredOf`,
   `FrameSlide.blurred`), instead of having the video's shape cut out of it. `shotsFor(...,
{ fitAcross: true })`; the admin's studio and gift keep cutting, as before.
4. **Preview**: `drawFrame` at 40 % in a `requestAnimationFrame` loop; `SlideImages` keeps only the
   slides on screen decoded, fetching the prepared blobs by object URL.
5. **File**: `encodeVideo` — H.264 where the browser has it, VP9 in MP4 otherwise, with a note that
   VP9 may not play on an iPhone. No sound (music belongs in the social app, licensed there).

The component is `src/components/slideshow/slideshow-maker.tsx`; nothing in it imports from the
gallery or the database.

## 3. Limits (`src/lib/slideshow/limits.ts`)

| Bound              | Value                | Why                                                                |
| ------------------ | -------------------- | ------------------------------------------------------------------ |
| Photos             | 3–60                 | a video needs a few; 60 keeps a phone's memory and the length sane |
| File               | 20 kB – 40 MB        | below is a thumbnail, above is not a photo from a camera           |
| Shorter side       | ≥ 1000 px            | a 1080 px frame from less is a visible upscale                     |
| Pixels / long side | ≤ 62 MP, ≤ 12 000 px | a 61 MP full frame passes; more costs a phone ~250 MB to decode    |
| Types              | JPEG, PNG, WebP      | what every browser that can encode also decodes (no HEIC)          |

They protect the visitor's device, not a server — every check is client-side.

## 4. Length and pace (`src/lib/slideshow/pacing.ts`)

Every photo is always in the video. The length is therefore how fast they pass: `lengthOptions`
offers the steps (10 s … 3 min) the chosen pace reaches with this many photos, never an empty list.
Two paces, both `Pacing` values for `buildTimeline`:

- **Klidné** — the studio's own (`NORMAL_PACING`): 1.8–4 s a slide, 0.45 s fades.
- **Dynamické** — 0.9–1.8 s a slide, 0.2 s fades, a shorter first slide, and 0.15 more zoom so a
  short slide still visibly moves.

## 5. Public copy

The rule from docs/SOCIAL-VIDEO.md §4 holds here too: the page never says that faces are found, how
or why — the camera "slowly moves in and out". The tool marks a photo "Zkontroluj" with "someone may
have blinked" as its hint; that is the only place the eye check surfaces (Pavel to confirm).

## 6. SEO and GEO

Indexable, in the sitemap, canonical `/video-z-fotek`, `FAQPage` + `WebApplication` JSON-LD from the
same copy the page shows (`slideshowJsonLd`), and a section in `public/llms.txt`. New languages are
added to `SLIDESHOW_PATHS` (`src/lib/slideshow-path.ts`); the sitemap follows it.

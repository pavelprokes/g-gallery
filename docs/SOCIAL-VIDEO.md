# Social videos — short silent clips made from a gallery

Proposed and built 2026-10-18 (§10 records how). The authority for the feature: read before
touching face data on `Photo`, the admin "Video" page, or anything that renders frames in the
browser. Sources are listed at the end; the numbers in §4–§6 come from a spike run
on 2026-10-17 (§7).

## What and why

Pavel wants to turn a gallery into a 15–30 s **silent** video, **without captions**, in two
formats: **9:16** (Reels, Stories, TikTok) and **16:9** (YouTube, the website). Two uses:

- his own marketing,
- a gift for the couple ("this was your day"), placed in their gallery.

He picks the photos or accepts a suggestion. The style he likes best: a slow zoom that knows where
the faces are — it lands on two heads side by side even when they sit off-centre, and falls back to
the centre when a photo has no face. Later styles: photos dropping in white polaroid frames, an
album turning its pages.

**No product found does face-aware framing** (§9). Pic-Time, ShootProof, SmartSlides and Lightroom
all zoom on the centre or at random and leave the picking to the photographer. ShootProof (August 2026) lets the clip be downloaded without music so it can be added in Instagram — the same workflow
as here.

## 1. Decisions (Pavel, 2026-10-18)

| Question               | Decision                                                                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where frames are drawn | **In the browser** on the photographer's machine — canvas → WebCodecs → MP4 (§4). No server.                                                                |
| First style            | **Face-aware Ken Burns** (§5). Polaroid and album page later (§8).                                                                                          |
| Formats                | 1080×1920 (9:16) and 1920×1080 (16:9), 30 fps, 15 or 30 s.                                                                                                  |
| Sound, captions        | **None.** Music is added in the social app if wanted.                                                                                                       |
| Who uses it            | The owner, from the admin. Guests and couples never render.                                                                                                 |
| Output                 | Download, and "Add to gallery" as a video item (`docs/VIDEO.md`) — the couple's gift.                                                                       |
| Offered to couples     | **In every package, both formats** — 9:16 and 16:9 (Pavel, 2026-10-19). Marketing copy in the help page, `public/llms.txt` and `docs/HANDOFF-MAIN-SITE.md`. |

## 2. The flow

1. Admin → gallery → **Video pro sítě** (`/admin/g/[id]/video`). Choose 9:16 or 16:9, 15 or 30 s.
2. The page proposes 6 (15 s) or 12 (30 s) photos (§3). The photographer reorders them — dragging
   (a finger by the ⠿ handle, so the page still scrolls) or the arrow keys
   (`src/components/admin/sortable-list.tsx`) — removes, or adds any photo of the gallery. The
   selection is a draft per gallery in `localStorage`, so a reload keeps it; nothing is stored on
   the server until a video is added to the gallery.
3. Faces are detected for the picked photos that have none stored yet (§4), and saved. For the
   rest of the gallery — so the suggestion sees faces on every photo — the photographer clicks
   **Najít tváře** on the same page (§4, "The whole gallery"); nothing searches on its own.
4. A live preview plays, driven by `requestAnimationFrame` through **the same frame function** the
   encoder uses, so the preview is the output.
5. **Render** encodes frame by frame (§6) and offers the MP4 to download. **Add to gallery** uploads
   it through the existing owner video path (`runUploads`, browser → presigned PUT to R2,
   `docs/VIDEO.md`), poster and loop included. Only an H.264 render can be added — the gallery
   takes no other codec; a browser that encodes only VP9 (Firefox, Playwright's Chromium) offers
   the download and says why the button is missing.

The tab must stay open while it renders. That is the trade for a feature with no server.

## 3. The suggestion

A starting point, never a verdict — the same spirit as the highlights (`docs/HIGHLIGHTS.md`).

- Reuse `pickHighlights`' signals: pins, XMP stars above the gallery's usual, colour labels, the
  spread across parts of the day, burst de-duplication. N = 6–7 or 12–13 instead of 6.
- **Fit to the format:** for 9:16 prefer portrait photos, or landscape ones whose subject box fits a
  0.5625-wide crop (§5). For 16:9 the reverse. A landscape photo **known to show no face** is held
  back from 9:16: cut blind, it showed an empty church with the bride sliced off its edge (§7).
- **The couple, where named** (§4, "Who is who"): +2, and the fit is judged on the shot framed on
  them.
- **Blink penalty:** Face Landmarker's `eyeBlinkLeft/Right` above 0.5 on any face — **in a photo of
  three or more**. In a couple's photo closed eyes are as often the moment itself (a kiss, a hug).
- **A short pick is topped up** from the rest of the day to twice the count before the fit chooses:
  photos seconds apart are one burst to the highlights, and the fit must still have a choice.
- **Rhythm:** no three face-less slides in a row; alternate people and details.
- **Ends:** the first and last slides are the strongest (pinned or highest score).

## 4. Face data

### Detection

[YuNet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) from OpenCV Zoo,
`face_detection_yunet_2026may.onnx` (**MIT**, 230 kB), run by
[onnxruntime-web](https://onnxruntime.ai/docs/tutorials/web/) 1.30.0 (MIT, Microsoft) **in a Web
Worker in the admin** — never at upload, and never at guest upload (the WASM is ~14 MB, too much
for wedding-day mobile data). A picked photo is searched in the copy already fetched for the render
(`sourceWidth`, §5): no second download, no second billed transformation. Everything is served from our own origin,
so the admin makes no request to a third party: the model is committed in `public/vendor/yunet/`,
onnxruntime's WASM is a hashed static asset of the build (the package asks for it by
`new URL(…, import.meta.url)`, which Turbopack emits). Single-threaded — threads need a
cross-origin-isolated page, which the admin is not.

The page hands the worker a photo's compressed bytes (`detect.ts`); the worker (`face-worker.ts`)
decodes and searches it (`face-finder.ts`, OffscreenCanvas, no DOM), one photo at a time. Turbopack
bundles it from `new Worker(new URL("./face-worker.ts", import.meta.url))` and starts it as a
**classic** worker — its bootstrap loads chunks with `importScripts` — so MediaPipe below uses its
classic build too; the module build fails there on `import.meta`. The pure half (tensor, decoding,
the second look) is `yunet.ts`:

- **one pass over the whole photo**, long edge scaled to **2048** (padded to a multiple of 32) —
  YuNet has anchors at strides 8/16/32, so a face of ~10 px is found without tiles. 2048 rather
  than the ~3000 px source: on the wedding in §7 it found a face on the same photos, lost a few
  small faces in groups and the bride of one dancing couple, dropped the false hit on the rings'
  basket, and took half the time;
- candidates at **score ≥ 0.6**, merged by non-max suppression at IoU 0.3;
- **a second look** at each one: its surroundings, 3× the box's longer side, scaled to 320 px and
  run again; the box stays only if the model finds the same face there (IoU > 0.4) at **≥ 0.6**.
  On a real wedding (§7) this removed every false hit of the single pass — rings in a basket,
  hands on a steering wheel, a painting over an altar — and no real face;
- at most **128 faces** a photo, the best-scored (a whole wedding on the steps was 79).

About **1 s a photo** in Chromium on 4 vCPU without a GPU (single-threaded WASM): the whole pass
~0.5–1 s, the second look ~20 ms a face, the landmarker ~0.1 s. A laptop is faster; onnxruntime's
WebGPU backend is the next step if a 400-photo gallery takes too long (§9.5).

### The whole gallery

**Najít tváře** on the video page (Pavel, 2026-10-18: on a click only, never on its own) searches
every photo without current faces — a gallery uploaded before this existed, or after a `model`
bump (§Storage). `src/lib/social-video/face-scan.ts`:

- fetches each photo at the size a 9:16 render would (`sourceWidth`, the default format), so a
  later render finds the transform cached; four photos ahead of the one being searched, never
  the whole gallery in memory;
- saves every **20** photos through `saveFaces`, so a scan stopped halfway — **Pozastavit**, the tab
  closed — keeps what it found, and the next click searches only the rest;
- skips a photo that does not load or fails (counted, tried again next time).

The worker keeps the page usable meanwhile (measured: no main-thread task over 200 ms during a
scan). The 29 photos of §7 took ~30 s here; 400 photos are ~7 minutes on this machine.

**Why YuNet** (compared 2026-10-18 on the wedding in §7): MediaPipe's BlazeFace short-range, used
until then, is tuned for selfies and finds nothing under ~12 % of the photo's height; even with
2×2 … 5×5 tiles it found faces on 19 of 29 photos, ~1.5 s each, with false hits on a doorway and
the rings. Its full-range model exists only as a .tflite the Tasks API does not ship. The other
candidates: `vladmandic/face-api` archived (2025-02), `face-api.js` unmaintained since 2020,
`vladmandic/human` wraps BlazeFace too, SCRFD / InsightFace weights non-commercial, YOLO-face
GPL/AGPL, RetinaFace weights of unclear licence, UltraFace weaker and without eye points.

MediaPipe's `FaceLandmarker` (Apache-2.0, with blendshapes) gives the blink score only — YuNet has
no eye openness. It runs **on each head YuNet found**, cut out 1.8× the face box and drawn at
256 px, not on the whole photo: on the whole photo it found a blink for 3 of 168 faces on the
wedding in §7, on the heads for 88. `blink` is the eyeBlink of the _more open_ eye, so it is high
only when both are shut — a laugh squints one eye past 0.5 as often as not. Its WASM is copied from
the pinned package on install (`scripts/copy-mediapipe.mjs`, served immutable under its version),
its model committed in `public/vendor/mediapipe/models/`.

### The photo check

**Kontrola fotek** (`/admin/g/[id]/check`, Pavel, 2026-10-18) lists the photos where someone has
their eyes shut or where the eyes of a main face are soft, for the photographer to look at before
the couple does. It only flags: whether shut eyes are a blink or a kiss, whether a soft face is a
missed focus or the depth of field, is the photographer's call — **Ponechat** keeps the photo and
takes it off the list (`Photo.checkKeptAt`, reset whenever the photo's faces are written anew —
new faces, new flags), **Smazat z galerie** is the gallery's own delete. The
search is the same click-to-start scan as the video page's (§4, "The whole gallery").

The measuring runs in the face worker, the deciding in `src/lib/photo-check.ts`:

- **Which faces.** At the framing score (0.7), from a quarter of the largest face's area, the 24
  largest — a guest far behind the couple is not the photo's subject, and a group of 80 is not culled
  eye by eye.
- **Shut eyes**: only in a **posed group** — at least 4 faces the landmarker read, at least 3 in 4
  of them with open eyes (`blink` < 0.3) — on a face with `blink` ≥ 0.5 that is not laughing
  (`smile` < 0.6). Everywhere else shut eyes were a moment, not a miss: over the whole wedding of
  §7 (547 photos, see below) the 59 faces at ≥ 0.5 were a bride reading her speech, kisses, laughs,
  looks down at the rings. Face Landmarker cannot tell a look down from a blink — its eyeLookDown
  was as high on the shut eyes as on the lowered ones, so it is not stored.
- **Soft eyes**: the region around both eyes (2× their distance wide, 0.9× tall), sampled
  nearest-pixel to 64 × 29, scored as the Laplacian's energy over the region's contrast
  (`eyeSharpness`). Below **0.07** is soft. Judged only on main faces (from half the largest face's
  area — a soft second row is the depth of field), facing the camera (eyes at least 0.3 of the face's
  width apart — in a profile the region falls on an ear and reads soft however sharp the photo), read
  by the landmarker (which rules out most paintings and the backs of heads), with eyes at least 24 px
  apart in the searched copy, bright enough to judge and inside the frame.

**Calibrated on the whole wedding** (Jáchym & Sophie, all 547 photos of the delivered gallery,
fetched at 2560 px, run locally, 6.9 min): the first rules (shut eyes anywhere, soft below 0.12, any
face) listed 122 photos — mostly looks down and sharp profiles. With the rules above it lists 21:
13 soft (a child and a priest out of focus, guests in motion on the dance floor, a lace sleeve the
detector took for a face) and 8 posed groups with someone's eyes shut. The crops behind every
threshold were checked by eye.

### Who is who

**Kdo je kdo** (`/admin/g/[id]/people`, Pavel, 2026-10-18): the photographer names faces by hand —
"Nevěsta", "Ženich", anyone else — and marks who is one of the couple. **Typed, never recognised**:
nothing is computed from a face to match it across photos; a face nobody clicked has no name.
Pavel chose this over automatic recognition, which would be biometric data (GDPR Art. 9) and need
every guest's explicit consent.

- **The data.** `GalleryPerson` (name, `couple`) per gallery; `FaceTag` (photo, person, box) per
  named face. The tag keeps **its own copy of the box**, so it outlives the detection it was made
  on: a new `FACES_MODEL` finds the same face a few pixels off, and the overlap (IoU ≥ 0.5,
  `src/lib/social-video/face-tags.ts`) finds the tag again. Someone is on a photo once — naming them
  on another face moves the tag — and a face holds one name. Deleting a person, a photo or the
  gallery deletes its tags.
- **The page.** Pick someone, then click their faces — the faces the camera frames by
  (`framedFaces`), photo by photo in the gallery's order, left to right. "Neoznačené" lists what is
  left; a face just named stays in place until the filter changes, so the list does not close up
  under the pointer. Any stored detection serves (`storedFaces`) — naming does not wait for a new
  scan.
- **A series, offered.** After a face is named, the shots either side of it in the gallery's order
  are walked while each was taken within 30 s of the last, has the same shape, and has an unnamed
  framed face where the previous one stood (IoU ≥ 0.5, `seriesMatches`). Those faces are outlined
  and offered in one bar — **Označit i tam** names them all (`tagFaces`), nothing is named without
  the click. Place and time only: a person who moved is not followed. On the delivered wedding of §7
  (2248 faces, a culled set — few bursts survive culling) 301 faces had a neighbour to offer, about
  420 clicks saved, a fifth.
- **What uses it.** Only the couple flag, so far: the suggestion adds **+2** to a photo showing a
  named member of the couple (§3) — as much as the right shape for the format — and the camera
  (`focusFaces`) frames **just the couple** where they are named among the framed faces, in the
  video and in the party projection (docs/GUEST-GALLERIES.md, F5). A group 9:16 could only show
  whole becomes a push in on the two of them. Other people are named for the photographer's own
  overview.
- **Privacy.** Names stay in the admin. The guests' page gets the couple's **boxes** at most
  (`projectionFaces`), never a name or a person's id.

### Storage

`Photo.faces Json?` — additive, null until computed, Zod-validated in the action that saves it:

```json
{
  "v": 1,
  "model": "yunet-2026may@2048+check+eyes2@ort-web-1.30.0",
  "faces": [
    {
      "x": 0.41,
      "y": 0.22,
      "w": 0.06,
      "h": 0.08,
      "score": 0.93,
      "le": [0.43, 0.25],
      "re": [0.45, 0.25],
      "blink": 0.04,
      "smile": 0.62,
      "sharp": 0.81
    }
  ]
}
```

Coordinates are 0–1 in the oriented image. A new model or threshold bumps `model` and recomputes on
demand; nothing else depends on it.

**Privacy.** These are detection boxes, not recognition: **no embeddings, no identities**, nothing
that could match a face across photos. Names exist only where the photographer typed them ("Who is
who" above). A few hundred bytes per photo, deleted with the photo. Pavel
to confirm this reading of GDPR Art. 9 before it ships.

**Free second source (to check).** Lightroom can write MWG face regions into the exported JPEG's
XMP, which the upload already reads. If Pavel's exports carry them, they cost nothing and are
better than any detector on a wide shot. Needs one real export to confirm — forums report the
setting behaving inconsistently.

## 5. The camera move

The party projection uses the same camera on the venue's screen (docs/GUEST-GALLERIES.md, F5,
"Face-aware camera") — `planShot` with the screen as the format.

For each photo: its oriented W×H, its faces, the output aspect A (9/16 or 16/9), the slide length.

1. **Subject box S.** Faces with score **≥ 0.7** and area ≥ 15 % of the largest face (on a real
   wedding YuNet's real faces scored 0.7–0.96; the doubtful boxes left after its second look,
   0.60–0.63).
   Each is widened to **head and shoulders** — about ×1.8 wide, from **0.8 h above** the face box
   to 1.0 h below it (the spike's 0.5 h above cut the top of heads on tight frames). S is their
   union. No face: a gentle zoom (≤ 1.12) centred across and aimed at the **upper third** — at a
   wedding the heads are up there, and the middle of a full-length portrait cut to 16:9 is a waist.
   A [smartcrop.js](https://npmjs.com/package/smartcrop) (MIT) focal point is a later refinement.
2. **Cover frame C:** the largest A-aspect rectangle in the photo, centred on S horizontally and
   placed by the same eye line as T vertically, so the move does not drift up or down; clamped
   inside.
3. **Tight frame T:** the smallest A-aspect rectangle holding S plus 8 %, with
   - `T.w ≥ C.w / Zmax`, Zmax = 1.25 (9:16) / 1.35 (16:9) — a small zoom looks expensive, a big one
     cheap;
   - `T.w ≤ C.w / 1.06` — a push that moves less reads as a frozen frame;
   - the tight frame enlarges the source's pixels by **1.35× at most** — Instagram's own re-encode
     hides that. The photo is fetched so its cover frame is at least the output's size
     (`sourceWidth`, rounded up to 256 px so renders share a cached variant); a 3:2 photo for 9:16
     is ~2900 px wide, not 4K, which keeps a 30 s render's decoded photos in memory. This floor
     wins over the 1.06, so a small photo simply does not zoom;
   - a subject **taller** than C (a standing couple in 16:9) keeps the heads and loses the legs;
   - the mean eye line at **38 %** of the frame height (9:16) or 40 % (16:9), but never so high that
     the top of S leaves the frame;
   - clamped inside the photo.
4. **Off-centre pairs — Pavel's case.** If S fits in C, the camera drifts from C to T and ends framed
   on the two heads wherever they are. If S is **wider than C** (two people far apart in a landscape
   photo cropped to 9:16) and is at most three people, it **pans** from the leftmost face to the
   rightmost at C's width. If neither works (a wide group in 9:16, or a pan faster than the cap in
   step 6), the photo is shown whole on a dark, muted colour of its own — its average, at most 15 %
   saturation and 6–16 % lightness (`backdropColor`) — and its 9:16 fit score drops so the
   suggestion avoids it. (Until 2026-10-18 it was a blurred, darkened copy of the photo; Safari's
   canvas ignores `filter`, so there the copy came out sharp and bright and the photo appeared
   twice, cut, above and below itself.)
5. **Direction.** Push in (C→T) and pull out (T→C) alternate; groups (three faces or more) and the
   opening slide always pull out, even when that makes three alike in a row. Pans alternate left
   and right.
6. **Interpolation.** Centre linear, scale geometric (`w(t) = w0·(w1/w0)^e(t)`, so the zoom speed
   feels constant), `e(t) = 0.5 − 0.5·cos(πt)`. Caps: scale ≤ 8 %/s — over a 2.95 s slide that is
   1.25×, so it, not Zmax, limits 16:9 — and pan ≤ 0.35 frame widths per second. Faster reads as
   seasick on a phone. (The proposal said 6 % per second for the pan; that allows no pan between two
   people at all — the concept's couple needs about 0.3.)
7. **Timing.** 2.5 s per photo, 0.45 s crossfade during which both slides keep moving; the first
   slide 3 s, the last one holds still for its final 0.5 s. 30 s ≈ 12–13 photos.
8. **9:16 safe area.** Eyes and faces stay inside y 14–65 %, x 6–86 % of the frame, clear of the
   Reels caption and buttons (Meta publishes percentages; pixel figures online disagree — check on a
   phone). 16:9 keeps a 5 % margin. The eye line keeps them there in the usual case; a photo whose
   tight frame cannot (a face at the photo's edge) scores lower in the suggestion.
9. **Determinism.** The Ken Burns style has no randomness. Any later one (the polaroid tilt) is
   seeded from the gallery id and a style version: rendering twice gives the same file.

## 6. Encoding

[Mediabunny](https://mediabunny.dev/guide/introduction) (MPL-2.0, the successor of `mp4-muxer`):
`CanvasSource` on a 2D canvas → `Mp4OutputFormat({ fastStart: "in-memory" })`.

- **H.264 High** (`avc1.640028`, level 4.0 covers 1080×1920@30) at ~10 Mbit/s, a keyframe every
  second; Instagram re-encodes anyway. Probe with `canEncodeVideo("avc")` and fall back to VP9 in MP4
  where H.264 encoding is missing.
- Sources are drawn from `createImageBitmap` of a `fetch(…, { mode: "cors" })` transform, with
  float coordinates and `imageSmoothingQuality = "high"` — no ffmpeg-zoompan jitter.
- Support: Chrome/Edge 94+, Firefox desktop 130+, Safari 26+. Intel-Mac Safari has a reported H.264
  quality bug (WebKit 258060). The admin probes and says so rather than producing a bad file.

## 7. Spike, 2026-10-17

Run headless in Playwright's Chromium on 4 vCPU, no GPU, against 45 photos of people from the
[Human](https://github.com/vladmandic/human) sample set (MIT) — portraits, couples, groups of 3–30,
full-length shots. **Not wedding photos**: the hit rate on a real wedding (dresses, veils, backlight,
dancing) is still to be measured.

| Measured                         | Result                                                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Faces, whole frame only          | 28 / 45 photos, 33 faces, ~40 ms per photo                                                                              |
| Faces, whole frame + tiles (§4)  | **42 / 45 photos**, 68 faces, ~160 ms per photo                                                                         |
| Render 30 s 1080×1920, 12 photos | **~25 s** wall time, 29 MB — VP9 software (this Chromium has no H.264)                                                  |
| Render 30 s 1920×1080            | ~21 s, 27 MB                                                                                                            |
| Framing                          | pairs and trios land framed; wide groups in 9:16 pan; some tight frames cut the top of heads → the 0.8 h headroom in §5 |

A laptop with a hardware H.264 encoder should be faster than this software VP9 run; to be measured
on Pavel's Mac.

### A real wedding, 2026-10-18

Jáchym & Sophie, Saint-Paul-de-Vence — the 29 photos of the gallery's first set (20 landscape,
9 portrait), fetched at 3072 px wide, run through the app locally (upload → video page → render),
same 4 vCPU without GPU.

| Measured                                   | Result                                                                                                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Faces, frame + 2×2, 3×3 (the spike's grid) | 15 / 29 photos; misses: full-length couples (faces 3–5 % high), kisses in profile, big groups                                                              |
| Faces, frame + 2×2 … 5×5                   | **19 / 29 photos**, 39 faces, ~1.5 s per photo; every new hit a real face                                                                                  |
| Correctly faceless                         | the rings, hands on the steering wheel; the rest of the misses are wide groups and backs                                                                   |
| False hits                                 | two on the whole frame (a dark doorway 0.65, the rings 0.51) — below the framing score of 0.7                                                              |
| Render 15 s / 30 s at 1080p                | about real time: 15 s and 30 s of wall time, 18–42 MB, software VP9                                                                                        |
| What it changed                            | tiles to 5×5, framing score 0.7, faceless aim at the upper third, faceless landscapes out of 9:16, blink only in groups, top-up to twice the count (§3–§5) |

Before the changes, a full-length portrait cut to 16:9 lost the couple's heads (it aimed at the
middle) and a 9:16 video opened its second slide on an empty church. After them, neither happens on
this set. The photos carried no capture time or Lightroom marks (fetched through the transform,
which strips metadata), so the suggestion here ran on the fit alone; in the gallery itself both are
there.

**The detector replaced, same day.** BlazeFace's 19 of 29 led to a comparison of detectors (§4) and
YuNet, measured on the same 29 photos:

| YuNet                                                   | Result                                                                                                                                                                                                                  |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One pass, full resolution (Node, CPU)                   | 29 / 29 photos, 199 faces, ~0.17 s per photo — the groups whole (81 on the steps), but false hits: the rings, hands on a steering wheel, the altar painting                                                             |
| + the second look (§4)                                  | 26 / 29, 175 faces; every one of those false hits gone, no real face lost                                                                                                                                               |
| In the app (Chromium, onnxruntime-web, ~2900 px source) | **28 / 29 photos, 175 faces**, ~1.5 s per photo (3072 px, main thread)                                                                                                                                                  |
| Faceless in the app                                     | hands on the steering wheel                                                                                                                                                                                             |
| Left doubtful                                           | the handle of the rings' basket (0.78 — the camera would drift to it), three boxes at 0.60–0.63, under the framing score                                                                                                |
| Kiss in profile                                         | at the render's size the groom's face is found (0.83); at full resolution it was not                                                                                                                                    |
| In the worker, capped at 2048 px (§4, now)              | **27 / 29 photos, 167 faces**, ~1 s per photo; faceless: the rings and the hands on the steering wheel, both right; the basket's handle gone; lost: 4 small background faces and the bride of the dancing couple (0029) |

The sheet with every box drawn was checked by eye against the photos; the numbers in §4 come from it.

## 8. Later

- **Polaroid:** white frame with a thicker bottom, soft shadow, ±6° seeded tilt, dropped in with an
  ease-out-back onto a paper or linen background — plain canvas 2D.
- **Album page:** a WebGL page curl (gl-transitions) or a faked flip (horizontal squash + shading).
- **Server rendering** for batch or one-tap videos: the same page in headless Chromium inside
  **Cloudflare Containers** (GA April 2026, EU placement, ~$0.002 per 60 s render, inside the
  Workers Paid quota), woken from a Queue like the ZIP builder and writing to R2 itself. Not before
  the browser version proves the format.
- Lightroom MWG regions as the preferred face source when present.

Ruled out: **Remotion** (in-browser rendering still experimental; Lambda adds AWS — the licence would
be free for a company of ≤3), **editly / ffmpeg** (native dependencies; zoompan jitters, ffmpeg
ticket #4298), **InsightFace** models (non-commercial licence), running detection at guest upload.

## 9. Open before building

1. **CORS GET on the transform URL.** Drawing a photo into a canvas that is then encoded needs
   `Access-Control-Allow-Origin` on the image response, or the canvas is tainted and the export
   throws. Checked 2026-10-18 with `curl -H Origin:` on a real photo: **missing**, on the object
   and on its transform alike. Add `GET` to the bucket's CORS rule (`docs/SETUP.md` §3), then check
   the transform again; if it still lacks the header, a Response Header Transform Rule on the CDN
   zone adds it for `/cdn-cgi/image/*`. The offline mode fetches the same way (`public/sw.js`) and
   needs the same header.
2. **Hit rate on real weddings** — one measured (§7, 29 photos); a second, with a dance floor, to
   come.
3. **Lightroom MWG regions** in one of Pavel's exports.
4. **H.264 encode speed and quality** in Chrome and Safari on Pavel's Mac.
5. ~~Detector inside a Web Worker~~ — done (§4). Left: onnxruntime's WebGPU backend vs the
   single-threaded WASM, if a 400-photo gallery is too slow on Pavel's Mac.

## 10. Build plan (2026-10-18)

Built the same day: PR 1 as #62, PRs 2 and 3 together as #63. Where the build departed from the
plan below, the sections above say what was built — detection runs on the main thread on the
render's own copy of the photo (§4), not in a worker on a 1600 px transform; the suggestion has no
seeded randomness (§5 step 9); the detector became YuNet instead of tiled BlazeFace (§4, §7). The
plan is kept as written.

Three pull requests, each mergeable on its own; nothing a guest sees changes until the third.
The order follows what can be tested without the open items in §9: the pure parts first, the
browser-only parts last.

### PR 1 — the pure core (no dependencies, no UI)

`src/lib/social-video/`, client-safe, unit-tested against the spike's photos and faces:

| File          | Does                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `faces.ts`    | Zod schema of `Photo.faces` (§4); the tile grid, the per-tile score floor and NMS that merge whole-frame and tile detections into one list. |
| `camera.ts`   | §5 steps 1–8: subject box, cover and tight frames, eye line, pan for pairs wider than the crop, blurred fallback, speed caps, safe area.    |
| `timeline.ts` | Slides → time: 2.5 s each, 3 s first, 0.45 s crossfade, last-slide hold; `slideAt(t)` returns the one or two slides and their progress.     |
| `suggest.ts`  | §3 on top of `pickHighlights` (count 6–7 / 12–13), fit-to-format, blink penalty, rhythm and strong ends; seeded alternation (§5 step 9).    |
| `frame.ts`    | `drawFrame(ctx, t, plan, bitmaps)` — the one function the preview and the encoder both call, so the preview is the output (§2 step 4).      |

`pickHighlights` gets a `maxPinned` option: today it caps pins at the highlight count (6), a
30 s video needs room for 13.

### PR 2 — faces in the database, detected in the admin

- Migration: `Photo.faces Json?` — additive, null until computed.
- `saveFaces(galleryId, entries)` in `src/app/admin/social-video-actions.ts`: session re-verified,
  Zod on every entry, only rows of that gallery.
- `@mediapipe/tasks-vision` pinned at 1.1.1; the WASM and the two models self-hosted under
  `public/vendor/mediapipe/` by a copy script, so the admin never calls a Google CDN.
- Detection in a module Web Worker (§9.5) on a 1600 px transform fetched with `mode: "cors"`,
  only for picked photos whose `faces` is null or from an older `model`.

### PR 3 — the admin page and the render

- `/admin/g/[id]/video`, linked from the gallery's admin page. Format (9:16 / 16:9), length
  (15 / 30 s), the suggested strip — reorder by drag and by buttons (keyboard, touch), remove, add
  from the gallery — a live preview and **Render**.
- `mediabunny` pinned at 1.61.6: `canEncodeVideo("avc")` → H.264, else VP9; progress, cancel,
  and a clear message where neither encoder exists (old Safari, Firefox on Android).
- **Download** the MP4; **Add to gallery** hands the file to `runUploads` with the owner's
  credentials — the same path as a hand-uploaded film (`docs/VIDEO.md`), poster and loop included.
- The selection is not stored in the database: a draft per gallery in `localStorage`, so a reload
  keeps it. A table comes with the first need to re-render later.
- E2E (`e2e/social-video.spec.ts`, admin cookie as in `e2e/video.spec.ts`): open the page, accept
  the suggestion, render 15 s 9:16, check the MP4's size and duration with `inspectMp4` (`src/lib/mp4-inspect.ts`).

### Before PR 3 ships

- §9.1, the CORS **GET** rule: one `wrangler r2 bucket cors set` with `"methods": ["PUT", "GET"]`.
  It also fixes the poster picker's fallback (`docs/VIDEO.md`). Whether the transform URL
  (`/cdn-cgi/image/…`) passes the header through is checked right after with `curl -H Origin:`;
  if it does not, a Response Header Transform Rule on the CDN zone adds it for `/cdn-cgi/image/*`.
- §9.2 hit rate on two real weddings — tunes the thresholds in `faces.ts`, does not block the
  code.
- §4 GDPR reading of `Photo.faces` confirmed by Pavel.

## Sources (checked 2026-10-17)

- Pic-Time reels: https://blog.pic-time.com/blog/how-to-create-reels-in-pic-time-in-3-easy-steps
- ShootProof slideshows: https://www.slrlounge.com/shootproof-launches-slideshows-music-backed-reels-built-right-into-your-client-galleries/
- SmartSlides vertical video: https://feedback.pixellu.com/b/smartslides/vertical-videos-for-ig
- Lightroom Classic slideshow export: https://helpx.adobe.com/lightroom-classic/desktop/slideshows/playing-exporting-slide-shows.html
- Google Photos highlight templates: https://www.androidauthority.com/google-photos-new-highlight-video-templates-3607805
- MediaPipe Face Detector: https://developers.google.com/edge/mediapipe/solutions/vision/face_detector
- MediaPipe Face Landmarker (web): https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js
- Mediabunny, writing media files: https://mediabunny.dev/guide/writing-media-files
- WebCodecs / VideoEncoder support: https://caniuse.com/mdn-api_videoencoder
- WebKit bug 258060: https://bugs.webkit.org/show_bug.cgi?id=258060
- Cloudflare Containers GA: https://developers.cloudflare.com/changelog/2026-04-13-containers-sandbox-ga
- Cloudflare Containers pricing: https://developers.cloudflare.com/containers/pricing/
- Cloudflare Containers placement: https://developers.cloudflare.com/containers/concepts/placement/
- Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Remotion licence: https://www.remotion.dev/docs/license
- ffmpeg zoompan jitter: https://ffmpeg.org/pipermail/ffmpeg-trac/2025-March/072906.html
- Lightroom MWG face regions: https://community.adobe.com/t5/lightroom-classic-discussions/person-info-not-removed-during-export-since-11-0/m-p/13047771
- Reels safe zones: https://www.hopperhq.com/blog/instagram-reel-size/

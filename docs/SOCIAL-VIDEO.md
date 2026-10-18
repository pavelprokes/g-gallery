# Social videos — short silent clips made from a gallery

Proposed 2026-10-18, **not built yet**. The authority for the feature once it is: read before
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

| Question               | Decision                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| Where frames are drawn | **In the browser** on the photographer's machine — canvas → WebCodecs → MP4 (§4). No server. |
| First style            | **Face-aware Ken Burns** (§5). Polaroid and album page later (§8).                           |
| Formats                | 1080×1920 (9:16) and 1920×1080 (16:9), 30 fps, 15 or 30 s.                                   |
| Sound, captions        | **None.** Music is added in the social app if wanted.                                        |
| Who uses it            | The owner, from the admin. Guests and couples never render.                                  |
| Output                 | Download, and "Add to gallery" as a video item (`docs/VIDEO.md`) — the couple's gift.        |

## 2. The flow

1. Admin → gallery → **Video**. Choose 9:16 or 16:9, 15 or 30 s.
2. The page proposes 6–7 (15 s) or 12–13 (30 s) photos (§3). The photographer reorders, removes or
   adds any photo of the gallery.
3. Faces are detected for the picked photos that have none stored yet (§4), and saved.
4. A live preview plays, driven by `requestAnimationFrame` through **the same frame function** the
   encoder uses, so the preview is the output.
5. **Render** encodes frame by frame (§6) and offers the MP4 to download. **Add to gallery** uploads
   it through the existing owner video path (browser → presigned PUT to R2, `docs/VIDEO.md`), with
   a poster taken from its first frame.

The tab must stay open while it renders. That is the trade for a feature with no server.

## 3. The suggestion

A starting point, never a verdict — the same spirit as the highlights (`docs/HIGHLIGHTS.md`).

- Reuse `pickHighlights`' signals: pins, XMP stars above the gallery's usual, colour labels, the
  spread across parts of the day, burst de-duplication. N = 6–7 or 12–13 instead of 6.
- **Fit to the format:** for 9:16 prefer portrait photos, or landscape ones whose subject box fits a
  0.5625-wide crop (§5). For 16:9 the reverse.
- **Blink penalty:** Face Landmarker's `eyeBlinkLeft/Right` above 0.5 on any face.
- **Rhythm:** no three face-less slides in a row; alternate people and details.
- **Ends:** the first and last slides are the strongest (pinned or highest score).

## 4. Face data

### Detection

[MediaPipe Tasks Vision](https://developers.google.com/edge/mediapipe/solutions/vision/face_detector)
(Apache-2.0) `FaceDetector`, model BlazeFace short-range, run **lazily in the admin** on a
1600 px transform of each picked photo — never at guest upload (the WASM bundle is ~13.5 MB, too much
for wedding-day mobile data). The model and WASM are **self-hosted** in `public/`, so the admin
makes no request to Google.

The short-range model is tuned for selfies. In the spike it found **no face below ~12 % of the photo
height**: every large group and most full-length portraits came back empty (28 of 45 photos with a
face). The fix measured in the spike:

- run the detector on the whole photo **and** on 2×2 and 3×3 overlapping tiles (30 % overlap), where
  each face is two to three times larger;
- accept a tile detection only at **score ≥ 0.75** (0.5 on the whole frame) — at 0.5, tiles read
  shoulders and knees as faces;
- merge everything by non-max suppression at IoU 0.3.

Result: **42 of 45 photos** with a face, 68 faces, false hits nearly gone, **~0.16 s per photo** on
4 vCPU without a GPU. The 1927 Solvay group photo (tiny faces, 29 people) still returns nothing, and
it should not zoom anyway.

`FaceLandmarker` (with blendshapes) runs on the same photo for the blink score only; it is not used
for framing because it misses more faces than the tiled detector.

### Storage

`Photo.faces Json?` — additive, null until computed, Zod-validated in the action that saves it:

```json
{
  "v": 1,
  "model": "blazeface-sr+tiles@tasks-vision-1.1.1",
  "faces": [
    {
      "x": 0.41,
      "y": 0.22,
      "w": 0.06,
      "h": 0.08,
      "score": 0.93,
      "le": [0.43, 0.25],
      "re": [0.45, 0.25],
      "blink": 0.04
    }
  ]
}
```

Coordinates are 0–1 in the oriented image. A new model or threshold bumps `model` and recomputes on
demand; nothing else depends on it.

**Privacy.** These are detection boxes, not recognition: **no embeddings, no identities**, nothing
that could match a face across photos. A few hundred bytes per photo, deleted with the photo. Pavel
to confirm this reading of GDPR Art. 9 before it ships.

**Free second source (to check).** Lightroom can write MWG face regions into the exported JPEG's
XMP, which the upload already reads. If Pavel's exports carry them, they cost nothing and are
better than any detector on a wide shot. Needs one real export to confirm — forums report the
setting behaving inconsistently.

## 5. The camera move

For each photo: its oriented W×H, its faces, the output aspect A (9/16 or 16/9), the slide length.

1. **Subject box S.** Faces with score ≥ 0.6 and area ≥ 15 % of the largest face. Each is widened
   to **head and shoulders** — about ×1.8 wide, from **0.8 h above** the face box to 1.0 h below it
   (the spike's 0.5 h above cut the top of heads on tight frames). S is their union. No face: a
   gentle zoom (≤ 1.12) on the centre; a [smartcrop.js](https://npmjs.com/package/smartcrop) (MIT)
   focal point is a later refinement.
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
   step 6), the photo is shown whole over a blurred, darkened copy of itself, and its 9:16 fit score
   drops so the suggestion avoids it.
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
   throws. The offline mode already fetches with `mode: "cors"` (`public/sw.js`), which suggests the
   header is there; a `curl -H Origin:` against a real transformed photo settles it. If missing, add
   `GET` to the bucket's CORS rule (`docs/SETUP.md` §3).
2. **Hit rate on two real weddings** (~100 photos: portraits, medium, wide, dance floor).
3. **Lightroom MWG regions** in one of Pavel's exports.
4. **H.264 encode speed and quality** in Chrome and Safari on Pavel's Mac.
5. Detector inside a module Web Worker, GPU delegate vs CPU — keeps the admin responsive while it
   runs.

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

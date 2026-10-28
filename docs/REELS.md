# Reels s hudbou — a fast vertical cut to music, from one or more weddings

Built 2026-10-28 at Pavel's request: "a quick video for Instagram and Facebook from chosen weddings
or albums, its own page in the admin, vertical, a fast song, one photo per cut, about a second
each, music found for it, several variants." The authority for `/admin/reels`, `src/lib/reels/*`
and the sound in `encodeVideo`. It builds on the social video (docs/SOCIAL-VIDEO.md): the camera,
the suggestion, the frame and the encoder are that feature's; this page adds the music, the cuts
on the beat, several galleries at once and the variants.

## 1. Decisions (2026-10-28)

| Question          | Decision                                                                                                                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where             | `/admin/reels`, "Reels" in the admin's top bar — not per gallery: a reel is often several weddings.                                                                                                       |
| Format            | 9:16 only, 1080×1920, 30 fps; 15, 20 or 30 s.                                                                                                                                                             |
| Cuts              | Hard cuts, one photo per cut, every cut on a beat (§3). No crossfade.                                                                                                                                     |
| Sound             | **Music in the file** — a change from the social video's "no sound": that one is a gift and a silent clip; this one is cut to the song, so the song belongs to it. AAC 192 kbit/s, 48 kHz.                |
| Where music lives | **In the photographer's browser** (IndexedDB), never uploaded (§2). The licence is Pavel's; a copy on our storage would be ours to answer for.                                                            |
| Which music       | Whatever file Pavel adds. The page lists where licensed music comes from (§6); we ship none — the session that built this could not reach any music library, and a bundled track would be redistribution. |
| Variants          | Three at a time, side by side, each playing with its music; "Další varianty" for three more (§4).                                                                                                         |
| Output            | Download only. Not added to a gallery: it is marketing, and often several couples' photos.                                                                                                                |

## 2. The music

`src/lib/reels/music-library.ts` keeps each track as added — the file, its name, a free-text note
"where it is from and under what licence", and its beat analysis — in this browser's IndexedDB
(`g-gallery-music`). Another computer starts with an empty list; a private window keeps tracks until
the page closes and says so. A track analysed by an older `BEATS_VERSION` is analysed again on load.

**The beat** (`src/lib/reels/beats.ts`, pure, tested on drum machines at 96–140 BPM):

1. Decoded by the browser (`OfflineAudioContext.decodeAudioData`, resampled to 48 kHz), mixed to
   mono, averaged down to ~22 kHz.
2. **Onset envelope**: log-magnitude spectral flux (1024-sample Hann frames, 256 hop, bins up to
   8 kHz), half-wave rectified, minus its ±0.5 s mean, normalised.
3. **Tempo**: the envelope's autocorrelation between 60 and 200 BPM under a log-Gaussian prior
   centred on 120 BPM, one octave wide (librosa's defaults), refined between lags by a parabola.
4. **Beats**: Ellis' dynamic programme (2007, librosa's `beat_track`) — tightness 100, onsets
   smeared by a Gaussian of period/32; beats before the first real onset (a silent intro) dropped.
5. **Bars**: 4/4 assumed; the downbeat is the phase of every fourth beat with the strongest onsets.
6. **Energy**: RMS from each beat to the next, against the loudest.

Measured on synthetic drums: tempo within 0.3 %, every beat within 20 ms of its hit (0.5 ms on
average, after moving the frame time a hop later — 11 ms early without it). A 30 s track takes
~0.3 s, a 3-minute one ~1.5 s in Chromium on 4 vCPU, once per track. Real songs with a soft
attack, swing or a tempo change are still to be checked on Pavel's own music.

## 3. The cuts (`src/lib/reels/cuts.ts`)

- **Pace** → beats per cut: the musical group (1, 2, 4, 8, 16 beats) nearest the pace — "Rychle"
  ~0.5 s, "Co vteřina, to fotka" ~1 s, "Klidněji" ~2 s. At 128 BPM "a second" is 2 beats (0.94 s);
  at 70 BPM it is 1 beat; at 174 it is 4.
- **Start**: the first beat of a bar. `sections` ranks bar starts by the loudness of the next
  `seconds` and keeps those at least half a reel apart — a reel opens where the song is already
  going, not on its intro. Each variant can move its music by four bars ("◀ dřív / později ▶").
- **End**: on the first beat of a bar — the one that, with the hold, comes nearest the length —
  where the last photo stays for about a bar (1.5–2.5 s) while the music fades out over it.
- **Accents** (variant C): the last cut of every four-bar phrase is split in two — the fill.
- **Too few photos** for the slots: cut half as often, then end sooner.
- Every cut is snapped to a frame (±17 ms at 30 fps). The plan is a `Timeline` with `fade: 0`,
  so `drawFrame` and `slidesAt` draw it unchanged (`slidesAt` treats fade 0 as a hard cut).
- The camera is the social video's (`shotsFor`): faces framed, a short push or pull, held to its
  speed caps, so a one-second slide moves a little and a landscape photo is cut to 9:16 on its faces.

## 4. Photos and variants (`src/lib/reels/variants.ts`)

- **Galleries in the address**: `?g=id,id` (at most 10, `src/lib/reels/sources.ts`), ticked in
  "Odkud fotky" by wedding (all its albums) or album. The server loads only the ticked galleries'
  photos, through the same loader as the gallery's video page (`src/lib/social-video/studio-photos.ts`).
- **The pick**: the slots' count shared out evenly between the galleries (a small one gives its
  spare to the others, `shareOut`); inside each, the social video's `suggestPhotos` — pins, stars,
  the guests' favourites, every chapter, the shape for 9:16, strong first and last photos. **Only
  the photographer's own photos**, never guests'.
- **Variants**, three per round:
  - A "Nejlepší výběr" — the suggestion, on the loudest stretch;
  - B "Jiné fotky" — passing over A's photos, on the second loudest;
  - C "Se zrychlením" — passing over A's and B's, with accents, the galleries taken in turn.
- **"Další varianty"** passes over every photo shown so far and moves on through the song's loud
  stretches; "Zpět na první návrh" returns to round 0.
- **×** on a photo takes it out of every variant (and the gap is filled); "Vrátit vyřazené fotky"
  brings them back. Nothing is stored on the server.

## 5. Sound in the file

`encodeVideo` (`src/lib/social-video/encode.ts`) takes an optional `AudioBuffer`. The reel's sound
is cut by `reelAudio` (`src/lib/reels/audio.ts`): `OfflineAudioContext` at 48 kHz, the track from
the variant's offset, a 20 ms fade in (a cut mid-note clicks), the fade out over the last photo.
The preview plays the same envelope live on an `AudioContext`, and the picture follows the sound's
clock.

- **AAC**: the browser's own encoder where `canEncodeAudio("aac")` says so; otherwise
  `@mediabunny/aac-encoder` (MPL-2.0, FFmpeg's AAC in WASM, ~600 kB, loaded only then), pinned to
  Mediabunny's version.
- **Fed a second at a time** between the frames, so the muxer interleaves the tracks.
- **Priming**: FFmpeg's encoder opens with 1024 samples of silence that Mediabunny writes no edit
  list for — every player started the sound 21.3 ms late (measured with ffmpeg on the file). The
  WASM path skips those samples; afterwards the kicks land within 0.2 ms of the cuts. **The
  browser's native AAC (Chrome or Safari on a Mac) is not measured yet** — to check on Pavel's
  Mac; even uncorrected, ~20–45 ms of late sound is below what people notice.
- Video: H.264 where the browser encodes it, VP9 in MP4 otherwise (as in docs/SOCIAL-VIDEO.md §6).

Measured 2026-10-28 in Playwright's Chromium (VP9 + WASM AAC), 4 vCPU: a 15 s reel renders in
~20 s including the photos.

## 6. Where the music comes from (what the page says)

Checked 2026-10-28 from search results (the providers' own pages could not be opened from the
build session; to re-check before relying on it):

- **Meta Sound Collection** — free, royalty-free, commercial use allowed, **Facebook and Instagram
  only**. Meta Business Suite → All tools → Sound Collection; download on a computer.
  https://help.instagram.com/ipad-app/402084904469945
- **Mixkit** — free stock music licence, commercial use, social posts, no attribution.
  https://mixkit.co/free-stock-music/
- **Epidemic Sound** — a business promoting its services needs the **Business** plan; linking the
  channels clears them against claims. https://www.epidemicsound.com/our-plans/business-plan/
- **CC BY** (Kevin MacLeod / incompetech, Free Music Archive's CC BY tracks) — credit in the post's
  caption; **CC BY-NC is not** for a business. https://incompetech.com/music/royalty-free/faq.html
- A business account may use only music it holds a licence for; commercial music from a streaming
  app gets the video muted or blocked.
- Pixabay (contributors' Content ID registrations), Uppbeat free (business use needs a paid plan)
  and Bensound free (attribution, no ads) are left out of the page on purpose.

Fast cuts suit songs around 120–130 BPM (2 beats ≈ 1 s).

## 7. Later

- Words over the reel (names, place) — none now, as in the social video.
- A flash or zoom punch on the downbeats as a style.
- Remembering the music across devices — only with a licence model that allows our copy.

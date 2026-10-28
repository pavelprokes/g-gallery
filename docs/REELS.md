# Reels s hudbou — a fast vertical cut to music, from one or more weddings

Built 2026-10-28 at Pavel's request: "a quick video for Instagram and Facebook from chosen weddings
or albums, its own page in the admin, vertical, a fast song, one photo per cut, about a second
each, music found for it, several variants." The authority for `/admin/reels`, `src/lib/reels/*`
and the sound in `encodeVideo`. It builds on the social video (docs/SOCIAL-VIDEO.md): the camera,
the suggestion, the frame and the encoder are that feature's; this page adds the music, the cuts
on the beat, several galleries at once and the variants.

## 1. Decisions (2026-10-28)

| Question          | Decision                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where             | `/admin/reels`, "Reels" in the admin's top bar — not per gallery: a reel is often several weddings.                                                                                                                                                                                                                                                                                          |
| Format            | 9:16 only, 1080×1920, 30 fps; 15, 20 or 30 s.                                                                                                                                                                                                                                                                                                                                                |
| Cuts              | Hard cuts, one photo per cut, every cut on a beat (§3). No crossfade.                                                                                                                                                                                                                                                                                                                        |
| Sound             | **Music in the file** when it came as a file — a change from the social video's "no sound": that one is a gift and a silent clip; this one is cut to the song, so the song belongs to it. AAC 192 kbit/s, 48 kHz. **No sound** when the song was only listened to (§2): its music is added in Instagram (Pavel, 2026-10-28).                                                                 |
| Where music lives | **In the photographer's browser** (IndexedDB), never uploaded (§2). The licence is Pavel's; a copy on our storage would be ours to answer for.                                                                                                                                                                                                                                               |
| Which music       | Whatever file Pavel adds, or a song the page listens to — from a YouTube player on the page, another tab or the microphone (§2). The page lists where licensed music comes from (§6); we ship none — the session that built this could not reach any music library, and a bundled track would be redistribution.                                                                             |
| YouTube           | **Never downloaded** (Pavel asked for "a YouTube link → its music", 2026-10-28): the browser cannot fetch YouTube's audio at all, a server would need yt-dlp off Vercel against YouTube's terms and its blocking of data-centre addresses, and a song on YouTube is rarely licensed for a business's Reel. The page shows YouTube's own embedded player and listens to it for the beat (§2). |
| Galleries         | **Published ones only**, the photos chosen by what the guests looked at and printed (§4, Pavel 2026-10-28).                                                                                                                                                                                                                                                                                  |
| Variants          | Three at a time, side by side, each playing with its music; "Další varianty" for three more (§4).                                                                                                                                                                                                                                                                                            |
| Output            | Download only. Not added to a gallery: it is marketing, and often several couples' photos.                                                                                                                                                                                                                                                                                                   |

## 2. The music

`src/lib/reels/music-library.ts` keeps each track as added — the file, its name, a free-text note
"where it is from and under what licence", and its beat analysis — in this browser's IndexedDB
(`g-gallery-music`). Another computer starts with an empty list; a private window keeps tracks until
the page closes and says so. A track analysed by an older `BEATS_VERSION` is analysed again on load.

**Listening instead of a file** (`src/lib/reels/listen.ts`, `src/components/admin/reel-listen.tsx`):
the song plays somewhere and the page records what it hears with `MediaRecorder`, raw (no echo
cancelling, noise suppression or gain riding — they flatten the drum hits), 10 s to 3 min:

- **"Poslouchat kartu"** — `getDisplayMedia` with the tab's sound, hinted to offer this very tab
  (`preferCurrentTab`); the picture is dropped at once. A pasted YouTube link (`youtubeId`,
  `src/lib/reels/youtube.ts`) shows YouTube's privacy-enhanced player (`youtube-nocookie.com`,
  IFrame API on) on the page, so the song plays in the tab being shared: once the tab is heard the
  page seeks the player to "Začít od", starts it (`postMessage` commands — `playerCommand`) and
  stops listening after the chosen 30–90 s. If the player ignores the command, Pavel presses play.
  Nothing is downloaded from YouTube. Desktop Chrome and Edge only — phones have no
  `getDisplayMedia`, and the option is not shown there.
- **"Poslouchat mikrofonem"** — `getUserMedia`; works on phones too. A speaker in the room is
  enough for the beat; the onset envelope only needs the hits to stand out.

A listened track is stored like a file (`kind: "listened"`, `listenSource` "tab" or "mic", the
YouTube address as `origin`), its beat found the same way, and its recording plays under the
previews.

**With sound or without** (Pavel, 2026-10-28 — "výsledek bude jen video bez zvuku nebo se
zvukem"): every track — a file, a tab, Instagram's library — can go into the MP4 as its sound;
"Bez zvuku" leaves it out (`-bez-zvuku.mp4`) for the song to be added in Instagram, where the
page tells the start to slide it to. A microphone's recording is the room, so it starts on "Bez
zvuku"; everything else on "Se zvukem". The licence is Pavel's ("no copyright" music, §6). Tested headless with Chromium's fake
microphone fed a 126 BPM track: found 126 BPM from the recording.

**The beat** (`src/lib/reels/beats.ts`, pure, tested on drum machines at 96–140 BPM):

1. Decoded by the browser (`OfflineAudioContext.decodeAudioData`, resampled to 48 kHz), mixed to
   mono, averaged down to ~22 kHz.
2. **Onset envelope**: log-magnitude spectral flux (1024-sample Hann frames, 256 hop, bins up to
   8 kHz), half-wave rectified, minus its ±0.5 s mean, normalised.
3. **Tempo** (since 2026-10-28): comb-filter resonance (Davies & Plumbley 2007, eq. 5) — each
   tempo 60–200 BPM scores the envelope's autocorrelation at its period and three multiples, each
   widened by its tolerance, under a Rayleigh weighting peaking at 120 BPM; then to 0.1 BPM. After
   `@audio/beat`'s `combTempo` (MIT, github.com/audiojs/beat — found by Pavel), ported rather than
   installed: the rest of that package is the same spectral flux and Ellis DP as here. On our own
   synthetic set (`beats.styles.test.ts`, 9 styles × 70–180 BPM) it lifted exact tempo from 64 % to
   70 % and tempo-or-octave from 88 % to 96 %; the plain autocorrelation (librosa's prior) remains
   for a clip too short for the comb.
4. **Beats**: Ellis' dynamic programme (2007, librosa's `beat_track`) — tightness 100, onsets
   smeared by a Gaussian of period/32; beats before the first real onset (a silent intro) dropped.
5. **Bars**: 4/4 assumed; the downbeat is the phase of every fourth beat that is hit hardest and,
   weighted four times more, where the song gets louder — a chorus starts on a bar's first beat.
   Loudness, not onsets, because it reads the same at 44.1 and 48 kHz: on Pavel's test song
   (d.higgs, "Shut It Down") the onset-only phase moved by two beats between the two rates.
6. **Energy**: RMS from each beat to the next, against the loudest.
7. **Strength, density, hits** (`BEATS_VERSION` 3): the onset at each beat (±35 ms; the downbeat
   reads it), the mean onset from beat to beat (sections, §3), and every onset peak with its
   strength — what the cuts land on (§3).

The Web Audio `AnalyserNode` (suggested 2026-10-28) is not used: it gives FFT snapshots of sound
playing in real time, so a 3-minute song would take 3 minutes to read and its frames would land
on animation ticks, not on samples. The decoded file is read whole instead, ~1.5 s for 3 minutes.

Measured on synthetic drums: tempo within 0.3 %, every beat within 20 ms of its hit (0.5 ms on
average, after moving the frame time a hop later — 11 ms early without it). A 30 s track takes
~0.3 s, a 3-minute one ~1.5 s in Chromium on 4 vCPU, once per track. Real songs with a soft
attack, swing or a tempo change are still to be checked on Pavel's own music.

## 3. The cuts (`src/lib/reels/cuts.ts`)

- **"Podle písničky"** (the default since 2026-10-28, `src/lib/reels/follow.ts`): **a cut on every
  hit that stands out** — Pavel: "opravdu se trefovat do těch úderů". The analysis keeps every
  onset peak (`hits`, `hitStrength`, `BEATS_VERSION` 3); a hit's salience is its strength against
  the 75th percentile of the hits in the 3 s before it (and 0.3 s after), so a verse's soft kick
  counts like a chorus's loud one, the chorus's first hit stands out from the verse, and the hit
  after a break counts most. A dynamic programme (Ellis' kind, one level up) picks the chain from
  the first bar to the last: each cut earns its hit's salience minus a cost (0.6; 0.45 for "Se
  zrychlením"), a little more on a bar start (+0.15) and much more on a change of section (+1.2,
  Foote novelty on bar intensity); no photo shorter than 0.42 s (0.27 s faster) — at 140 BPM and
  above that is every other beat; a hold past 3 s costs, so a silent break holds a photo but an
  intro of faint hits still moves. Not a grid: a syncopated riff, a waltz or a drifting tempo is cut
  where it is heard. **Fewer photos than hits** (photos picked by hand): exactly as many cuts as
  photos, still on hits, each near an even share of the reel — the same programme over (cut,
  count). Measured on nine songs (below): 13–28 photos per 15 s, median length 0.43–0.83 s; in the
  rendered MP4s every cut lies within 24 ms of a hit in the file's own sound (median 7–12 ms; a
  frame is 33 ms).
- **Pace** → beats per cut: the musical group (1, 2, 4, 8, 16 beats) nearest the pace — "Rychle"
  ~0.5 s, "Co vteřina, to fotka" ~1 s, "Klidněji" ~2 s. At 128 BPM "a second" is 2 beats (0.94 s);
  at 70 BPM it is 1 beat; at 174 it is 4.
- **Start**: the first beat of a bar. `sections` ranks bar starts by the loudness of the next
  `seconds` and keeps those at least half a reel apart — a reel opens where the song is already
  going, not on its intro. Each variant can move its music by four bars ("◀ dřív / později ▶").
- **"Část písničky"** (`reel-section.tsx`, added 2026-10-28 at Pavel's ask): the song's loudness
  drawn across its length (`loudness`), the reel's stretch marked on it. A click or a drag puts the
  start at the nearest bar start that leaves the reel room (`barAt`); the arrows move it a bar,
  PageUp/PageDown four. The chosen part is every variant's start (`songStart` in `reelVariants`) —
  a variant's own "dřív / později" still moves it from there; "Vybrat samo" goes back to the loudest
  stretches. "Poslechnout tuhle část" plays exactly what a variant would, envelope included, with a
  playhead on the strip. A new song starts from its loudest stretch again.
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
  "Odkud fotky" by wedding (all its albums) or album. **Only published galleries** are listed or
  loaded. The server loads only the ticked galleries' photos, through the same loader as the
  gallery's video page (`src/lib/social-video/studio-photos.ts`).
- **"Fotky podle hostů"** (on by default): inside each gallery the suggestion chooses only among
  the photos the guests took to most — `likedScore`: favourites ×3, reactions and print copies ×2,
  unique viewers ×1 — three times as many as the gallery's share, plus as many as earlier rounds
  showed (`guestPool`). Where fewer photos than that were noticed at all, every photo stays in and
  the photographer's own marks decide, as without the switch.
- **The pick**: the slots' count shared out evenly between the galleries (a small one gives its
  spare to the others, `shareOut`); inside each, the social video's `suggestPhotos` — pins, stars,
  the guests' favourites, every chapter, the shape for 9:16, strong first and last photos. **Only
  the photographer's own photos**, never guests'.
- **"Fotky"** (2026-10-28, `reel-photo-pick.tsx`): "Vybrat samo" — the suggestion — or "Naklikat
  ručně": every gallery's own photos as tiles to click; the reel then shows only those (`only` in
  `reelVariants`), the guests' ranking does not narrow them and every variant may use them all.
  Fewer picked than the reel's length wants (~1.3 per second) and the page says each will stay
  longer. The clicks are kept in this browser per set of galleries (localStorage, a convenience).
  **"Promíchat alba"** (on): every variant takes the galleries in turn; off — album by album.
- **Variants**, three per round:
  - A "Nejlepší výběr" — the suggestion, on the loudest stretch;
  - B "Jiné fotky" — passing over A's photos, on the second loudest;
  - C "Se zrychlením" — passing over A's and B's, with faster cuts.
- **"Další varianty"** passes over every photo shown so far and moves on through the song's loud
  stretches; "Zpět na první návrh" returns to round 0.
- **×** on a photo takes it out of every variant (and the gap is filled); "Vrátit vyřazené fotky"
  brings them back. Nothing is stored on the server.

## 5. Framing — the reel's camera

`shotsFor(…, { reel: true })` → `reelShot` (`src/lib/social-video/camera.ts`). A photo is on
screen for half a second to a second, so a slideshow's slow push is invisible and a landscape photo
shown whole over its blur is too small (Pavel, 2026-10-28: "fotka na šířku je špatně vidět").

- **Close on the subject**: the faces' head-and-shoulders box (or, with no face to frame, the
  photo's sharp part — `focus`) with 1.25× air, as close as **1.8×** past the cover frame — or as
  the photo's pixels allow: never enlarged past `MAX_UPSCALE` of what is fetched. The fetch is
  sized for it (`sourceWidth(…, zoom)`), so a 24 MP photo gets the full 1.8×.
- **No head cut**: a subject wider than the crop keeps the faces a crop can hold whole
  (`facesInWindow`): of every place for the crop — each head at either edge — the one keeping the
  most face area, a head it would cut through costing twice its area; ties to the centre.
- Eyes on the eye line as everywhere; then a 4 % push in or out (`directShots` alternates).
- A photo with no face and no sharp part known: the cover frame, a third down — as before. The
  sharp part exists only where the gallery's face scan ran ("Najít tváře").

## 6. Sound in the file

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

Measured 2026-10-28 in Playwright's Chromium (VP9 software, WASM AAC), 4 vCPU, against `pnpm dev`:
the encoder alone does a 15 s reel of flat frames in ~24 s; the page, with photos, in ~39 s. With
the three previews redrawing a standing frame 60 times a second it took 68 s, so a preview that is
not playing draws once its photo is in and stops.

## 7. Where the music comes from (what the page says)

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

## 8. Instagram's own music through its API (not built)

**Built as docs/INSTAGRAM-AUDIO.md** (2026-10-28): Instagram's music as a source of sound and beat,
without publishing — Pavel posts the file himself. This section is the first reading, kept for its
history.

Asked 2026-10-28. Meta has an **Instagram Audio API** (2026): with Facebook Login, a Reel
published through the Content Publishing API can carry licensed audio searched for and attached by
an `audio_configuration` parameter (`audio_name` alone only renames original audio). What could
not be confirmed — developers.facebook.com is outside the build session's network — is whether a
business account gets anything beyond the Sound Collection, whether a start time can be set, and
what app review it needs. It would mean publishing from the admin (a Meta app, Facebook Login,
`instagram_content_publish`, the video at a public URL) — a project of its own. The beat would still
come from listening (§2): the API hands out ids, not audio. Sources:
https://developers.facebook.com/docs/instagram-platform/content-publishing/audio-api/ ,
https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media

"No copyright" music (NoCopyrightSounds and the like) is usually free with credit for creators;
for a business's marketing NCS points to its own licence (ncs.io/UsagePolicy, to read before use).

## 9. Later

- Words over the reel (names, place) — none now, as in the social video.
- A flash or zoom punch on the downbeats as a style.
- Remembering the music across devices — only with a licence model that allows our copy.

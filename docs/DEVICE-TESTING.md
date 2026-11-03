# Testing on guests' devices

Adopted 2026-11-03 on Pavel's ask ("vymysli jak pomocí Playwright testovat iPhone, Safari,
Firefox, Windows… ať to můžeme použít i příště"). How to check a change, or measure a live
gallery, on the browsers and devices guests actually use, with no device lab: what is real, what
is emulated, and which command does what. `docs/GALLERY-LOADING.md` holds the numbers these runs
produced.

## What Playwright can be, and what it cannot

What decides how a page behaves is the **engine**, and Playwright drives all three that matter:

| Guests on                             | Engine   | Here                                                                           |
| ------------------------------------- | -------- | ------------------------------------------------------------------------------ |
| iPhone, iPad — **every** iOS browser  | WebKit   | Playwright WebKit with the device's screen, pixel ratio, touch, user agent     |
| Safari on a Mac                       | WebKit   | the same, desktop window                                                       |
| Chrome, Edge, Samsung Internet, Opera | Chromium | Playwright Chromium, or the installed Chrome/Edge (`channel`)                  |
| Firefox                               | Gecko    | Playwright Firefox                                                             |
| Windows                               | any      | Windows' user agent, window and 125 % pixel ratio here; **real Windows in CI** |

- **WebKit is not Safari.** It is the engine Safari is built on, from the same source, without
  Apple's networking stack and media codecs. Layout, events, history and image loading match;
  video playback and exact network timing may not. A real iPhone is still the last check for
  anything that only shows there — see "A real phone" below.
- **Windows changes no engine.** Chrome and Edge on Windows are the Chromium measured here,
  Firefox the same Gecko. What does differ: pixel ratio 1 or 1.25 (different image widths picked),
  classic scrollbars that take ~15 px of width (a different justified layout), fonts. The
  `win-*` profiles cover the first; `.github/workflows/devices.yml` runs on a real Windows machine
  for the rest.
- **Slow networks:** DevTools throttling exists only in Chromium, and it delays whole requests.
  `scripts/devices/throttle-proxy.mjs` is a proxy that delays bytes instead — one link (round
  trip, down and up bandwidth) shared by every connection — so WebKit and Firefox get the very same
  slow link as Chromium, and so does a real phone. Presets: `slow4g` (Lighthouse's default mobile
  link: 150 ms, 1.6 Mbps / 750 kbps), `3g` (WebPageTest "3G Slow": 400 ms, 400 kbps), `4g`
  (WebPageTest "4G": 170 ms, 9 Mbps). Numbers from DevTools' "Slow 4G" (562.5 ms per request) are
  not comparable with these: that preset inflates the same link to make up for throttling requests.
- **Slow CPU** exists only in Chromium (`android` 4×, `android-low` 6×). WebKit and Firefox run at
  this Mac's speed — a fast iPhone, roughly.
- **Slow mode.** The gallery reads Chromium's own estimate (`navigator.connection.effectiveType`).
  Behind the proxy Chromium measures the slow link itself; `--ect=3g` says it outright (Chromium
  only). Safari and Firefox have no such API; the gallery times its own images there, as on a real
  iPhone.

## Commands

**Measure a live gallery** — `pnpm perf:gallery <link> [<link>…] [flags]`
(`scripts/devices/gallery-perf.mjs`). A fresh browser per run, read-only page views (analytics,
beacons and presence never leave the browser, without route interception, which would turn
Chromium's cache off).

```sh
# The gallery, a chapter and a photo link, on the default five devices, Slow 4G
pnpm perf:gallery "$G" "$G#group-photos" "$G?foto=…"
# Scrolling: a screen down three times, each timed until the screen is complete
pnpm perf:gallery "$G" --devices=iphone,android --scroll=3
# The lightbox, hurried: next every 400 ms, 20 times
pnpm perf:gallery "$G?foto=…" --devices=iphone,win-chrome --net=4g --browse=20 --interval=400
```

Flags: `--devices=` (below), `--net=none|4g|slow4g|3g`, `--runs=` (median of every column),
`--ect=3g`,
`--cap=60000`, `--json=file.jsonl` (every run, raw), `--md` (a Markdown table). Columns, all in
ms from navigation: `fcp`, `firstTile` (the first tile on screen drawn), `screen` (every tile on the
first screen drawn) with `screenTiles` and `imagesBeforeScreen` (images requested by then),
`preview` and `full` (the lightbox's first pixels and its full-size photo) with `imagesBeforePhoto`,
then `images`, `kB` and `pages` (`/photos` requests) for the whole visit; `scroll` (each screen;
15000 = not complete within 15 s), `steps` (median ms until the photo the counter shows is on top,
a step where it never was counting as the whole interval) and `wrongSteps` (presses after which it
still was not, over every run).

Devices (`scripts/devices/devices.mjs`): `iphone`, `iphone-se`, `ipad`, `android` (Pixel 7, CPU
4×), `android-low` (Moto G4, CPU 6×), `mac-safari`, `mac-chrome`, `mac-firefox`, `win-chrome`,
`win-edge`, `win-firefox` (1536×730 at 125 %), `win-laptop` (1366×768 at 100 %). A branded
`channel` that fails to start (Edge on a Mac) falls back to Playwright's Chromium, and its rows say
`→ Playwright Chromium`.

**Real Windows** — Actions → Devices → Run workflow, or
`gh workflow run devices.yml -f links="$G" -f net=slow4g -f extra="--scroll=3"`. Edge, Chrome and
Firefox on `windows-latest`, the table lands in the run's summary, raw runs as an artifact.
Started by Pavel, not by an agent: a gallery link is a credential (its token opens the gallery),
and the run's inputs show it to everyone who can see the repository's Actions.

**The end-to-end suite on more engines** — `pnpm test:e2e:engines` runs the guest-facing specs
(gallery, photo links, chapters, highlights) on desktop Safari and Firefox, against the local
stack like `pnpm test:e2e` (whose own projects already cover Chromium, the iPhone and a throttled
Pixel). Not on every change; when a change touches the gallery's loading, links or lightbox.

**Just a slow link** — `pnpm proxy:slow --net=3g` and point any browser at `127.0.0.1:8899`.

## A change, before merging

Previews have no database (`docs/VERCEL-ENV.md`), and the local seed has no image files, so a
loading change is measured on a local build that shows a live gallery's real photos:

```sh
pnpm mirror:gallery "$G"   # the live gallery's photo list into the LOCAL database, keys pointing at the live CDN
pnpm perf:build            # a production build whose images come from that CDN
pnpm perf:start            # both refuse where .env.local / .env.production* exist: production's credentials
pnpm perf:gallery "http://<printed address>:3000/g/…" --devices=iphone,android,mac-firefox
```

The mirror reads only the public photos API and writes only a database on this machine (it refuses
any other `DATABASE_URL`, and keeps the live token only as a hash); films and chapters are not
copied, the order is the live one. `perf:build` and `perf:start` run only where `.env` is the
one env file (a worktree, `.claude/worktrees/`): in the main checkout `.env.local` and
`.env.production.local` would load production's credentials into the build. It prints this machine's network
address, not `127.0.0.1`: WebKit sends loopback past the proxy, so its page would load at full
speed. Compare a build of `main` with the branch the same way — production's servers answer
faster than a laptop, so production numbers are not the baseline. Stop `perf:start` before
`pnpm test:e2e`, which would otherwise test this build instead of making its own.

## A real phone

Some things only a real device shows (Safari's networking, real touch, memory pressure):

1. `pnpm proxy:slow --net=slow4g --lan` on the Mac — it prints the Mac's address.
2. iPhone on the same Wi-Fi: Settings → Wi-Fi → ⓘ → Configure Proxy → Manual → that address,
   port 8899. Every app on the phone now goes through the slow link.
3. Watch it from the Mac: iPhone Settings → Safari → Advanced → Web Inspector on, cable, then
   Safari on the Mac → Develop → the iPhone → the page (network waterfall, console).
4. Proxy back off on the phone, Ctrl+C on the Mac. While it runs, anyone on that network can use
   it — for ports 80, 443 and 3000 only, and never to this Mac's own loopback services.

Apple's Network Link Conditioner (Xcode → Additional Tools; on the iPhone under Developer settings)
throttles the whole device instead, with no proxy.

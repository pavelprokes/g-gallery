# TODO — to discuss

Raised by Pavel 2026-08-21, to be worked through **after Phase 2 is finished**.
Nothing here is designed or estimated yet; the point of the list is that none of
it gets lost. `docs/PLAN.md` stays the architecture authority — anything from
here that we adopt gets folded into it with the same verification standard.

## 0. E2E test suite — **started 2026-08-21, on Pavel's signal**

Was deferred until Pavel said so; he did, once the P3 batch (§6 slug, signed image URLs,
virtualization, justified layout, trash) was implemented. First suite lives in `e2e/` and covers
the unauthenticated share-gallery viewer flow (`e2e/gallery-view.spec.ts`, 5 cases, seeded against
local Docker Postgres, green on chromium + mobile-safari).

Still open: the admin upload → confirm → publish → share-link-creation flow — the path that has
broken twice already — needs a signed-in session, and this repo has no test-auth bypass yet. A
real Google OAuth test account or a documented bypass is a prerequisite before that flow can be
covered; not attempted yet.

Added 2026-09-01: `e2e/promo-tile.spec.ts` (4 cases) covers the credit tile's inertness claims —
it must not be openable, arrow-navigable, selectable or countable
(`docs/PROMO-CARDS.md`). The seed places one at slot 5 in the _same_ gallery
`gallery-view.spec.ts` asserts on, so that file's existing expectations double as proof that a
non-photo tile in the grid disturbs none of them.

Two things from the 2026-09-01 review are known-untested and want a case each once the above
bypass exists, because neither is reachable from Vitest (no layout, no server):

- **Virtualizer row alignment across a resize.** Set the viewport 390 → 375 and assert no two
  row `<li>` bounding boxes overlap. This regressed silently before (`estimateSize` is not a
  memo dependency of `getMeasurements`) and would regress silently again.
- **The optimistic-write rollback.** Stub the favourite endpoint to 403, tap a heart, and assert
  the heart empties again _and_ the alert appears. The failure mode being guarded is a viewer
  marking sixty photos that reach nobody, which is invisible to every other kind of test.

Added 2026-09-01, from the touch-icons work: **marking mode has no E2E case.** On a coarse
pointer the grid no longer draws an idle heart or printer at all, and the header's `Označit`
toggle is what pins them back. Vitest covers the class strings the visibility hangs off
(`src/components/gallery-view.test.tsx`) and the CSS was checked in Chromium against the compiled
stylesheet, but nothing exercises the real thing on a real engine. Wanted, in `mobile-safari`
where the project already runs E2E:

- The toggle is visible on a coarse pointer and absent on a fine one, and no idle heart or
  printer is hit-testable on a tile until it is pressed. The regression this guards is an
  invisible 44px tap target over every photo — `pointer-coarse:hidden` rather than `opacity-0`
  is the whole fix, and nothing outside that one class prevents it coming back.
- A long press on a pinned heart favourites the photo _without_ also entering the download
  selection. The controls are children of the div that handles the press, so their `touchstart`
  bubbles into it; the guard is one `contains` check that a refactor could quietly drop.

## 1. Offline access — **done 2026-08-21**

Opt-in per gallery, in the gallery footer. Pavel accepted the revocation
trade-off: cached bytes on someone's device cannot truly be recalled. The
service worker still drops a gallery's cache when the share page comes back
403/404/410, which covers the honest case of a link being revoked while the
viewer is online.

## 2. Ideas from the Hello Interview thread

<https://www.hellointerview.com/community/questions/photo-storage-sharing/cmkbgr2qp08d108adu0khqo6o>

Photo storage/sharing system design discussion. To read and mine for ideas worth
adopting; treat as input, not as a specification — our constraints (20 galleries
a year, Vercel + R2, no bytes through the app) differ sharply from a
consumer-scale photo service, so most scale advice will not transfer.

## 3. Infinite scroll with a stable order — **closed, not needed yet**

Measured before building anything: a 500-photo page is **223 kB of HTML over the
wire** (brotli crushes the repeated URLs), and every tile below the fold is
already lazy, so the browser does viewport prioritisation for free. The stable
order this was asked for **already exists** on the client surface — the share
page orders by `takenAt` (capture time, since 2026-08-25; `createdAt` before
that); only the _admin_ grid sorts by favourite
count, and that is Pavel's own view, not one a client scrolls while others
favourite. (`sortOrder` itself was removed 2026-08-21 — see `docs/AUDIT.md`
§3.5/§8 P2 — it was never written, so it never actually contributed to this
ordering.)

Reopen when galleries grow past a few thousand photos, or if a real device shows
the DOM cost mattering. Building cursor pagination now would be work with no
user-visible effect.

## 4. Enlarged view with swipe between adjacent photos — **done 2026-08-21**

Tap a photo to enlarge, swipe left/right between adjacent photos seamlessly.
A lightbox with keyboard navigation exists; this adds touch gestures and
neighbour prefetch so the next photo is already decoded when the swipe lands.

## 5. Core loading steps — **done 2026-08-21**

- **Index fetching** — metadata and tiny placeholders first, so the grid
  geometry is final before any photo bytes arrive (we already store
  `width`/`height`; placeholders would be new).
- **Viewport priority** — visible images download before off-screen ones.
- **Progressive enhancement** — low-resolution preview instantly, high-resolution
  streams in behind it.
- **Caching** — frequently viewed thumbnails and recent items persisted to
  device storage to cut network calls.

Note the tension with the cost model: every distinct width/quality combination
is a billable Cloudflare transformation (5,000 unique/month free), so adding a
placeholder tier and a preview tier multiplies the variants per photo. Worth
measuring against the current fixed set before committing.

## 6. Readable URL slug — **done 2026-08-21**

Share URL now carries a human-readable hint (e.g. `svatba-petra-a-jana-2026-08-12`) alongside the
opaque token: `/g/{token}/{slug}` (`src/lib/gallery-slug.ts`). Built from `Gallery.title` **and**
`Gallery.eventDate`. Slug trails the token in its own path segment the app never parses for
resolution, so it stays purely cosmetic and the token remains the sole authority.

Open questions resolved: the slug is **frozen at share-link creation** (stored on `ShareLink`, not
recomputed per request) — a later rename doesn't invalidate an already-sent link, same trade-off
Notion/Figma make. Diacritics: NFD-normalized and stripped (`svatba-petra-a-jana`, not
`svatba-petřa-a-jana`).

## 7. Free ZIP download (skip Workers Paid) — **done 2026-08-23**, broke on large galleries,

**fixed 2026-09-02** (see §7a)

`docs/SETUP.md` §9 / `worker/` ship a **live, on-the-fly** streaming ZIP Worker, but it needs
**Workers Paid ($5/mo)** — Free's 10 ms CPU-per-invocation limit can't cover streaming an 8 GB
archive in one request/response. Pavel wanted genuine pay-per-use instead of a flat monthly
minimum; a cross-cloud alternative (AWS Lambda, Google Cloud Run) was considered and rejected —
Lambda is structurally disqualified (streamed-response bandwidth is throttled to 2 MB/s past the
first 6 MB, so an 8 GB archive needs ~66 minutes against a 15-minute hard timeout — not a pricing
question), and a third cloud platform for one rarely-used feature is operational overhead a
same-account free-tier design avoids entirely.

**Shipped as `zip-builder-worker/`** — a second, separate Cloudflare Worker deployment (deliberately
_not_ added to `worker/`, since that script's `[limits] cpu_ms` override would force this one onto
Workers Paid too):

- **"Download all"** pre-builds the archive in the background and stores it as a plain R2 object;
  the app serves it as a direct `cdn.svatebni-fotograf-cechy.cz` link with no Worker involved at
  download time (`Content-Disposition` is set on the R2 object itself, at build time).
- **Partial selection** on-the-fly ZIP was dropped as planned — per-photo download covers it.
- **Chunking turned out simpler than first sketched**: `localHeader`/`centralHeader`/
  `endOfCentralDirectory` (`src/lib/zip64.ts`) are pure functions of entry metadata, so the whole
  archive's byte layout is knowable before any file data is read. `src/lib/zip-chunk-layout.ts`
  exploits that to make every part **independent** — no rolling buffer, no ordering, no state
  carried between Queue messages — rather than the sequential design originally proposed here.
  R2's requirement that every part but the last be the _same_ size (not just independently ≥5 MiB)
  is handled by cutting fixed windows out of the logical byte stream regardless of photo boundaries.
- **Orchestration**: a Vercel cron (`/api/cron/zip-build`, `src/lib/zip-build.ts`) kicks off one
  build at a time via a signed handoff (`src/lib/zip-build-manifest.ts`, same HMAC scheme as the
  live Worker's manifest) to the builder's `/build-start`, which creates the R2 multipart upload and
  enqueues one Queue message per part. The builder's own Cron Trigger (every 2 min) finalizes
  completed uploads and aborts stale ones, then calls back to `/api/internal/zip-callback` — the
  builder holds no session and talks to no database, same principle as the live Worker.
  `Gallery.zipStatus` (`NONE → PENDING → BUILDING → READY`, or `FAILED`) is the state machine; a
  photo confirmed after `READY` drops it back to `PENDING` rather than serving a stale archive.
- Verified end-to-end against real R2 before merging: uploaded fake photos, ran the full
  build-start → Queue → Cron-finalize → callback path, downloaded the resulting object, and
  confirmed a byte-correct, `unzip -t`-clean archive with the right `Content-Disposition`.

### 7a. The archive never built for a large gallery — **fixed 2026-09-02**

A 377-photo production gallery (~2 GB, 315 parts) showed "Připravujeme archiv" for a day. Two
independent bugs, and it took both:

**The build could not finish.** `wrangler.toml` gave the Queue consumer `max_batch_size = 10` and
no `max_concurrency`, so Cloudflare ran many invocations at once, each assembling up to ten 6 MiB
parts — and `buildOnePart` buffered every part **twice** (`readAll` materialised each piece, then
each piece was copied again into the part buffer) — measured 12 MB live for a 6 MiB part, so up to
~120 MB of churn per invocation against the **128 MB isolate limit**, which applies on every plan
and is shared by every concurrent invocation. Workers analytics for 2026-09-01 20:15–20:45:
**718 of 1013 invocations `exceededResources`** — while burning _less_ CPU than the invocations that
succeeded, which is what rules CPU out and names memory. Only 111 of 315 parts ever landed, in the
tell-tale gappy pattern of batches dying part-way (1–14, 55–58, 65–67, 75–78, …). Note the design
comments blamed the Workers **Free 10 ms CPU** ceiling for everything; the account runs the
`standard` usage model and a 1.4 s-CPU invocation succeeded in the same window. Chasing CPU here
would have found nothing.

Fixed by `max_batch_size = 1` + `max_concurrency = 4`, and by `src/lib/zip-part-assembly.ts`, which
streams each source range straight into one part-sized buffer: 6.1 MB per invocation measured,
so ~25 MB in total at the configured concurrency. The arithmetic is now bounded rather than
emergent, which is the actual fix — the old design had no number you could check.

**And it could never recover.** `FAILED` was terminal: `kickoffPendingZipBuild` selected only
`NONE`/`PENDING`, and `resetStaleZipBuilds` swept only `BUILDING`. Nothing but a fresh photo upload
ever left `FAILED`. Separately, a gallery with a photo missing `crc32`/`sizeBytes` returned early
without writing anything, so its `updatedAt` never moved and the `orderBy: updatedAt asc`
`findFirst` picked _the same row_ every tick — one bad gallery starved every other one, which is
exactly what the comment above it claimed the ordering prevented.

Fixed by `src/lib/zip-build-policy.ts`: candidates are scanned as a list and chosen in pure,
tested code. `FAILED` retries on an exponential backoff bounded by `Gallery.zipAttempts`; a stale
`BUILDING` is recorded as `FAILED` so hung and reported failures share one retry rule; an
unbuildable gallery is skipped rather than blocking the queue; and the cron response now reports
_why_ nothing was built. A build is also deferred until a gallery has gone `QUIET_PERIOD_MS`
without a new photo — rebuilding 315 parts every 15 minutes during a live wedding is waste, since
the next upload invalidates it anyway.

**And the viewer hid a perfectly good archive.** `archiveFor` served a link only for
`READY`/`PENDING`, on the theory that during `BUILDING` the key "names a multipart upload still
being assembled". It does not: an in-flight R2 multipart upload leaves the object already at the
key untouched until `complete()` (verified against the production bucket on a scratch key,
2026-09-02). So a gallery mid-rebuild — and _permanently_, one whose rebuild had failed — showed a
dead "Připravujeme archiv" button over a complete, downloadable archive. The rule is now
`zipBuiltAt`: once an archive has been built, the link never disappears again. Covered by
`e2e/gallery-archive.spec.ts`.

### 7b. The build's tracking manifest was public — **fixed 2026-09-02**

Found while fixing §7a. The builder Worker parks a tracking manifest in the photos bucket for the
duration of a build, and that manifest lists **every photo's R2 object key** for the gallery. It was
named `_zip-builds/{galleryId}.json`, and the photos bucket is served publicly at
`cdn.svatebni-fotograf-cechy.cz` — verified: a probe object written under `_zip-builds/` came back
`200` over the CDN.

`Gallery.id` is a cuid, not a secret, and the gallery page hands it to every viewer (the presence
channel needs it — it is in the page HTML). So anyone who has ever opened a share link keeps the id
and can poll that URL; during any rebuild it hands over every original's key, and originals are
otherwise protected only by the gallery's 128-bit random `storagePrefix`. That survives link expiry
and revocation, which invariant #5 requires to hold on every surface.

Fixed by `src/lib/zip-build-scope.ts`: build bookkeeping is now named by
`HMAC-SHA256(ZIP_BUILD_SIGNING_SECRET, galleryId)`, which the app and the Worker both derive and
neither publishes. Contained entirely in the Worker — no manifest, message or schema change.
Nothing migrates: the old-style keys only ever exist for the length of one build.

**Open questions before building**

- Staleness: what invalidates a pre-built ZIP — any upload/delete after the initial build? Rebuild
  on every publish action, or only on explicit admin request ("prepare download")?
  → answered 2026-09-02: any confirmed upload/delete, but debounced by a quiet period.
- Failure/retry: an interrupted multipart upload needs an explicit `abortMultipartUpload`, or
  storage leaks silently. (The claim here that R2 does **not** auto-expire them was wrong — R2
  aborts incomplete multipart uploads after 7 days by default. It is still worth aborting
  explicitly: 7 days of a half-built 2 GB archive is billed storage, and `abandonBuild` now retries
  the abort and logs `ORPHANED MULTIPART UPLOAD` when it cannot.)
- Does this **replace** `worker/`'s live ZIP entirely, or stay alongside it as a fallback for
  galleries too large/urgent to wait for a background build?
- Cleanup: pruning old pre-built ZIPs when a gallery is re-built or archived.

## 8. Guest galleries & wedding hubs — **adopted 2026-08-23, spec written**

Public QR galleries that wedding guests upload to from their phones, plus one hub address per
wedding listing several separate galleries (guest photos, preview set, full set) that the couple
can expose selectively. Researched against the Czech and international market, reviewed, and
accepted by Pavel the same day — so it is no longer "to discuss": the data model, the resolved
decisions and the phase estimates live in **`docs/GUEST-GALLERIES.md`**, and `docs/PLAN.md` §11
carries it as Phase 6.

**F1 (guest uploads) implemented 2026-08-23** — schema, both upload branches, quotas, refusal
messages, per-photo delete, and an E2E suite that drives a real file through presign → PUT →
confirm. **F2 (the wedding page) implemented the same day** — `Event` with its own token, the
`/s/` route, admin CRUD, and trash/purge at the wedding level. `docs/GUEST-GALLERIES.md` §11 has
the as-built notes for both. Guest self-delete followed the same day; **moderation is deferred on
Pavel's call**. **F3 landed the same day** — a screen wake lock plus an IndexedDB-backed upload
queue that resumes by itself when the guest comes back. **The client-side thumbnail (§9) and F5
projection also landed the same day** — `src/lib/thumbnail.ts` (pica) and
`src/components/slideshow.tsx` are both in the tree, so nothing from the original F1–F5 scope is
open.

**Reviewed against the codebase and re-prioritized with Pavel, same day, second pass** — see
`docs/GUEST-GALLERIES.md` §15 for detail. Green-lit next: printable QR graphics (F7), closing the
two §8 abuse gaps that shipped without (per-`anonKey` rate limiting, server-side size-mismatch
check on confirm), and the physical half of F6 (real-device matrix, small-wedding trial run).
Pricing is decided too — bundled free with a full-day package, not a standalone paid product.
Still deferred, not reopened: moderation, the PIN (dropped, not deferred — see §5), a co-host login
for the couple, and video.

**F7 (printable QR signage) implemented 2026-08-23, third pass** — one fixed A6 sign, two copy
variants, server-rendered QR (`qrcode`, `src/lib/qr.ts`), generated from either a wedding's `/s/`
address (`/admin/e/[id]/sign`, the stable one) or a standalone gallery's own `/g/` link
(`/admin/g/[id]/sign`), refused for a link that isn't upload-ready rather than silently generated.
`docs/GUEST-GALLERIES.md` §11 has the as-built notes. **Same pass, explicit scope call: the
physical half of F6 (real-device matrix, small-wedding trial run) is out of this first version** —
not dropped, just no longer scheduled as part of this batch; see `docs/GUEST-GALLERIES.md` §16.
Moderation, co-host access and video remain deferred, unchanged.

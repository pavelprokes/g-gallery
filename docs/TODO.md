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
page orders by `createdAt`; only the _admin_ grid sorts by favourite
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

## 7. Free ZIP download (skip Workers Paid) — **done 2026-08-23**

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

**Open questions before building**

- Staleness: what invalidates a pre-built ZIP — any upload/delete after the initial build? Rebuild
  on every publish action, or only on explicit admin request ("prepare download")?
- Failure/retry: an interrupted multipart upload needs an explicit `abortMultipartUpload` (R2 lists
  incomplete multipart uploads and does **not** auto-expire them), or storage leaks silently.
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
Pavel's call**, and the free 5 000 Cloudflare transformations are accepted as enough for now, which
takes the client-side thumbnail off F3's critical path. What is left before a real wedding is the
upload queue surviving a locked screen.

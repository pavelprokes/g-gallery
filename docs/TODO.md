# TODO — to discuss

Raised by Pavel 2026-08-21, to be worked through **after Phase 2 is finished**.
Nothing here is designed or estimated yet; the point of the list is that none of
it gets lost. `docs/PLAN.md` stays the architecture authority — anything from
here that we adopt gets folded into it with the same verification standard.

## 0. E2E test suite — last, on Pavel's signal

Playwright is installed and `pnpm test:e2e` exists, but **no E2E tests get written until Pavel says
so**. Removed from Phases 1–4 and parked as Phase 5 in `docs/PLAN.md` on 2026-08-21. The reason is
churn: routes, the upload flow and share gating have all changed under bug fixes this week, and
tests written against a moving surface get rewritten rather than run. Unit tests continue as normal.

When it does happen, the path worth covering first is the one that has broken twice already:
upload → confirm → publish → share link → view tracking.

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

## 6. Readable URL slug — raised by Pavel 2026-08-21

Want the share URL to carry a human-readable hint (e.g. `svatba-petra-a-jana-2026-08-12`)
instead of only the opaque token (`/g/QpFM9K1v81FIbyxxTedBVA` today), built from
`Gallery.title` **and** `Gallery.eventDate` — the date lives in its own field, not in the
title, so the slug generator has to pull both.

Proposed shape: `/g/{token}/{slug}` — slug trails the token in its own path segment the
app never parses for resolution, so it stays purely cosmetic and the token stays the sole
authority exactly as today. Putting the slug _before_ the token (`/g/{slug}-{token}`) was
considered and rejected: `generateShareToken()` is base64url, which itself contains `-`
and `_`, so splitting on a hyphen to recover the token would be ambiguous/unsafe.

Open questions before building: generate the slug once at share-link creation (frozen even
if the title changes later, like Notion/Figma) or derive it fresh on every request (always
current, but a renamed gallery invalidates old bookmarks' _readability_, not their
validity — the token still resolves either way); exact diacritics/casing normalization for
Czech titles.

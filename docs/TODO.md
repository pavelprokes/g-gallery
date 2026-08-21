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

## 1. Offline access

Offline browsing of a gallery. Open questions before this can be scoped: which
surface (client gallery, admin, both), what "offline" covers (already-viewed
photos only, or a deliberate "make available offline" action), and how it
interacts with share-link expiry and revocation — cached bytes on a device
cannot be revoked, which is a privacy decision, not just a technical one.

## 2. Ideas from the Hello Interview thread

<https://www.hellointerview.com/community/questions/photo-storage-sharing/cmkbgr2qp08d108adu0khqo6o>

Photo storage/sharing system design discussion. To read and mine for ideas worth
adopting; treat as input, not as a specification — our constraints (20 galleries
a year, Vercel + R2, no bytes through the app) differ sharply from a
consumer-scale photo service, so most scale advice will not transfer.

## 3. Infinite scroll with a stable order

Browse the library in an infinite scroll, fast loading, **stable and predictable
order**. The stability requirement is the hard part: the current gallery orders
by favourite count then `sortOrder`, so a favourite added mid-scroll reorders
items underneath the user. Cursor pagination needs an immutable sort key.

## 4. Enlarged view with swipe between adjacent photos

Tap a photo to enlarge, swipe left/right between adjacent photos seamlessly.
A lightbox with keyboard navigation exists; this adds touch gestures and
neighbour prefetch so the next photo is already decoded when the swipe lands.

## 5. Core loading steps

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

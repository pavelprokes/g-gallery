# Guest galleries & wedding hubs

**Adopted 2026-08-23** (Pavel). This document is the authority for the feature; `docs/PLAN.md`
stays the authority for the stack it runs on, and nothing here changes an invariant in `CLAUDE.md`.
Market figures were read off public pricing pages on 2026-08-23 and are dated by nature — re-check
before quoting them anywhere customer-facing.

Two things ship together, because neither is worth much alone:

1. **Guest uploads** — wedding guests scan a QR code and add phone photos to a gallery, from the
   browser, with no app and no account.
2. **The wedding hub** — one address per wedding that lists several _separate_ galleries and grows
   over time: guest photos on the night, a 30-photo preview after three days, the full 500-photo
   set after three weeks.

## 1. Why, in one paragraph

Five Czech services (Snapshare 290–990 Kč, FotoDrop 179 Kč, OnlineSvatba 369–479 Kč, ShareLove
730 Kč, MomentsForLove) and a dozen abroad ($20–200) already do "scan a QR, upload from the
browser". That part is table stakes, not an advantage, and the price it commands is small enough
that entering as a sixth vendor is not worth the support load. What none of them have is a
photographer on the other end: they all hand back an album that expires in 14–90 days and has no
relationship to the final photos. **Our wedge is that the same link keeps getting better** — the
QR sign printed before the wedding still resolves a year later, and by then it leads to three
galleries instead of one. Guest uploads are therefore not a product we sell; they are an
acquisition channel for the photography business, and the metric that matters is _what share of
guests uploaded at least one photo_, not photo count.

Feature research, the roundtable it came out of, the guest-facing copy deck, and the full pricing
detail (390 Kč/year renewal once there's something to renew) live in
`docs/GUEST-GALLERIES-RESEARCH.md`. Pricing itself is decided — see §15.

| Sold as a paid feature elsewhere                          | Our position                                                                  |
| --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Live projection during the party                          | Build it — Supabase Realtime is already wired (`src/lib/realtime-channel.ts`) |
| Moderation / private collection                           | Build it — it is the couple's veto and it is cheap                            |
| Printable QR signage (GuestPix ships 180 Canva templates) | Real selling point — **built 2026-08-23**, one fixed design not 180 templates |
| Face recognition ("find yourself")                        | Skip — no value at 78 guests, and biometrics under GDPR is its own project    |
| Guestbook / RSVP / seating                                | Skip — turns the QR into a wedding portal, which is not our business          |
| Video                                                     | Deferred, see §9                                                              |

## 2. What the couple sees

One unlisted page per wedding. Whoever gets the link is in; so is everyone they forward it to.
**Unlisted means not discoverable, not secured** — say it that way to the couple, never "private".

```
photos.svatebni-fotograf-cechy.cz/s/{token}/pavel-a-patricie-statek-benice-2026-08-12

  Pavel a Patricie · 12. 8. 2026 · Statek Benice
  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
  │ Od hostů      │ │ První výběr   │ │ Kompletní set │
  │ 412 · přibývá │ │ 30 · 15. 8.   │ │ 500 · 2. 9.   │
  └───────────────┘ └───────────────┘ └───────────────┘
```

The identity belongs in the header, once. Naming each card with the full
"12. 8. 2026 Pavel a Patricie, Statek Benice — …" stacks three near-identical paragraphs on a
phone with the distinguishing word at the end of each. Cards carry only what differs.

Galleries come and go under the event — a preview set gets pulled, the full set arrives, the guest
gallery closes after a year. Therefore **the event page is the stable address, not any gallery**:
the QR sign, the bookmark and the link in the family chat all point at the event.

- A removed gallery says so where the request landed and **does not redirect to the wedding
  page**. That redirect was in this plan's first draft and is a leak: someone who only ever held a
  link to one gallery would be handed the event token by following a stale card.
- **An event with exactly one listed gallery renders that gallery inline** — it does _not_ redirect
  to the gallery's own URL. On the wedding night the QR therefore lands straight in the upload
  view, but the address bar still says `/s/…`, so what guests bookmark and forward is the wedding
  page. Redirecting would hand eighty people a URL that can never grow a second card.
- `public/sw.js` already drops a gallery's offline copy on 403/404/410; it must do the same for a
  gallery removed from an event.
- A new gallery on an event people already know is a notification event, not a silent change.

## 3. Data model

Additive, and **`ShareLink` is not touched at all** — no grants, no nullable-FK XOR, no migration of
links already in someone's inbox. One share link still means one gallery, exactly as today.

```prisma
model Event {                     // "svatba" — the wedding page
  id, ownerId, title, eventDate, venue?, trashedAt, purgeAt, createdAt, updatedAt
  tokenHash String @unique        // SHA-256 of the event token; the raw token is never stored
  slug      String                // frozen at creation, cosmetic — same rule as ShareLink.slug
  galleries Gallery[]
}

model Gallery {
  eventId       String?           // nullable: standalone galleries stay legal
  position      Int     @default(0)     // order of the cards on the wedding page
  listedOnEvent Boolean @default(true)  // is this card shown to whoever holds the event link
  eventKey      String?           // this gallery's key within the wedding: /s/{token}/{slug}/{eventKey}
  eventLinkId   String?           // which ShareLink the card grants through (a gallery may have several)
  kind          GalleryKind       // GUEST | PHOTOGRAPHER — drives upload defaults and card copy
  ...
}

model Photo {
  source             PhotoSource      // OWNER | GUEST
  uploadedByViewerId String?          // attribution inside a guest gallery
  moderationState    ModerationState  // VISIBLE | HIDDEN | AWAITING_REVIEW
  ...
}
```

**Two independent switches, and that is the whole access model:**

| Switch                         | Means                                   | Who is affected                                 |
| ------------------------------ | --------------------------------------- | ----------------------------------------------- |
| Gallery has a live `ShareLink` | reachable by anyone holding _that_ link | people the couple forwarded the gallery link to |
| `listedOnEvent`                | shown as a card on the wedding page     | everyone holding the event link                 |

This is the unlisted-video distinction, and it is worth stating plainly because it replaces a whole
subsystem the earlier draft of this document proposed. **A grant list on the share link is not
needed.** The case it existed for — _the grandmother sees the full set but not the eighty guests_ —
falls out of the model for free: forward that gallery's own `/g/` link and the recipient never
reaches the wedding page, because the event token is a different secret they were never given.

Consequences to hold on to:

- Un-listing a gallery does **not** revoke its link, and revoking a link does **not** un-list it.
  Two switches, two effects. Admin offers "remove from the wedding page" as one action that does
  both, so the common intent is one click, but the underlying state stays honest.
- A gallery may carry more than one share link (one with a password, one without). `eventLinkId`
  says which one the card _grants through_, rather than the page guessing.
- **A card cannot be a `/g/{token}` link.** Raw share tokens are never stored (invariant 5), so the
  server physically cannot rebuild one. Cards address galleries with the composite token in §4
  instead; the designated `eventLink` still supplies every permission, so a card never grants more
  than the gallery's own link does.
- Password, expiry and revocation stay per gallery link, where they already are. There is no
  "unlock the whole wedding" step, because there is nothing to unlock at the event level in v1.
- The event page itself is unlisted-by-token in exactly the same way a gallery is: 128-bit token,
  never stored raw, `noindex`. See §10 for what that does and does not buy.

## 4. Routes

- **`/g/[token]/[[...slug]]` — unchanged.** The per-gallery, forwardable address that already
  exists in production, e.g.
  `photos.svatebni-fotograf-cechy.cz/g/-va8I3IzPVLyNLDnfcyS_Q/test-galerie-2026-08-21`. This is
  what the couple sends when they want someone to see one gallery and nothing else: it carries no
  event token, so it cannot lead to the wedding page. The trailing segment stays **cosmetic and
  never parsed** (`docs/TODO.md` §6).
- **`/s/[token]/[[...slug]]` — the wedding page.** Unlike `/g/`, this route **does parse one
  segment**:

  ```
  /s/{token}/{slug}          the wedding page
  /s/{token}/{slug}/{key}    one gallery listed on it
  ```

  The first trailing segment is cosmetic, exactly like `/g/`'s. The second is the gallery's
  per-wedding `eventKey`. A request with no segments at all redirects to the canonical form, so the
  key is always at index 1 and can never be mistaken for the slug. Nothing already handed out is
  affected: `/s/` is a new namespace, and `/g/`'s rule is untouched.

Slugs come from `src/lib/gallery-slug.ts` — title first, ISO date last, diacritics stripped — so a
wedding page reads `/s/{token}/pavel-a-patricie-statek-benice-2026-08-12`, matching the gallery
URLs beside it.

### The composite viewer token

Cards address galleries as **`"{eventToken}~{eventKey}"`** (`src/lib/event-token.ts`). This is not
decoration; it is forced by invariant 5. Raw share tokens are never stored, only their SHA-256, so
the wedding page cannot rebuild a `/g/{token}` URL for a gallery it lists — it has to address them
with the one secret it holds, plus a per-wedding key.

`resolveShareLink` understands both shapes and both end at a `ShareLink` row, so expiry,
revocation, the password gate and the permission flags have exactly one implementation. For the
composite form the row is the gallery's designated `eventLink`, which is also checked to belong to
that gallery — a mis-set pointer must not grant access to someone else's photos. `~` is a safe
separator: share tokens are base64url, whose alphabet cannot contain it, and it is unreserved in
RFC 3986.

The client never parses the token — `GalleryView` only interpolates it into API URLs — so every
existing `/api/g/[token]/…` route serves both shapes unchanged.

**No pass-through redirect.** When the wedding has exactly one listed gallery, `/s/` renders that
gallery's grid inline using the same `GalleryView`. Redirecting would put a gallery URL in eighty
address bars on the one night everybody saves the link, and that URL can never grow a second card.
The sign, the bookmark and the family chat all have to end up holding `/s/`.

**A stale key stays put.** A gallery that has been un-listed, or whose designated link was revoked,
is refused where the request landed. It deliberately does _not_ redirect to the wedding page: that
would hand the event token to someone who only ever held a link to one gallery, which is exactly
the separation this whole design exists to keep.

## 5. PIN on a single gallery — dropped, the password already does it

**Resolved 2026-08-23 (Pavel): the share-link password covers this, so no separate PIN is built.**

"Show this gallery to some people, not all" was the one case a listing switch could not express,
and it turns out not to need a new primitive. `ShareLink.passwordHash` has existed since Phase 2:
create a second link for that gallery, give it a password, and hand out the link and the password
together. If the wedding-page card should be gated too, point `eventLinkId` at the protected link
and everyone arriving via the card meets the password form.

What that inherits, and why it is fine here: the lockout counter
(`failedUnlockAttempts` / `unlockLockedUntil`) lives on the `ShareLink`, so five wrong attempts
lock the link for **everyone** holding it. For a link given to a handful of people — which is
exactly the "not all" case — that is harmless. It would have been a self-inflicted denial of
service on a link eighty guests use, which is why a PIN on the _guest_ gallery was never the idea.
So: **never put a password on the guest-upload link**, and if a password ever does end up on a
many-viewer link, move that counter to the viewer (`anonKey`) first.

## 6. Guest upload path

Unchanged in shape from the owner path, which is the point — `src/components/uploader.tsx`,
presign, PUT to R2, confirm. Bytes never touch Vercel (invariant 1) and the 4.5 MB body limit never
applies.

- `/api/uploads/presign` and `/api/uploads/confirm` currently call `requireAdmin()`. They gain a
  second branch: resolve a share token via `resolveShareLink`, check the resolved link carries
  `allowUpload`, then sign into that gallery's `storagePrefix`. The token is the sole
  authority, exactly as on every other share surface.
- `Photo.source = GUEST` and `uploadedByViewerId` are set from the existing `Viewer` row
  (`anonKey` in localStorage, optional `displayName`). No account, no IP — unchanged privacy model.
- **The phone generates the thumbnail.** A 512 px WebP produced from the file the browser already
  holds is uploaded alongside the original. This is not an optimisation, it is what keeps the
  feature free: see §7.
- Capture straight from the camera via `<input capture>` next to the normal file picker.

## 7. Taking a photo back (moderation deferred)

**Pavel, 2026-08-23: no moderation for now — a guest just needs to be able to delete their own
photos.** So the private-collection mode and the approve-first workflow stay unbuilt, and what
shipped instead is the smallest thing that solves the real problem:

- **A guest can delete a photo they uploaded**, from the lightbox, with no time limit
  (`/api/g/[token]/mine`). Every condition is checked server-side: the photo must be in this
  gallery, must be a guest upload, and must be attributed to _this_ `anonKey`. Nobody gains any
  power over anybody else's photo, which is precisely why this is not moderation.
- **The photographer can delete any single photo** from the admin (`deletePhoto`). That is the
  backstop for anything a guest will not remove themselves.

No time window on the guest's own deletion. OnlineSvatba uses six hours; a window would mostly
produce a "this can no longer be deleted" message, which is a worse thing to read than the deletion
is a thing to allow.

**Still unbuilt, and worth knowing before a real wedding:** a guest photo is visible to everyone the
moment it lands, and stays visible until somebody deletes it. There is no approve-first mode and no
hide. If that turns out to matter on the night, the original two modes are still the right shape —
_visible immediately_ (default) versus _private collection_, one boolean, the way FotoDrop sells it
as "soukromý sběr".

## 8. Quotas and abuse

A guest-upload link is an **anonymous write endpoint into our storage**, and links get forwarded.
Non-negotiable before this ships:

- 150 files per `anonKey`, 2 000 per gallery, both raisable from admin.
- Rate limit per `anonKey`; reject on declared size mismatch and on content-type spoofing.
- Every refusal produces a readable message. A silent failure on a wedding night is worse than a
  refusal.
- Uploads are rejected outright for expired, revoked, archived or `allowUpload = false` links —
  re-checked server-side on presign _and_ confirm, not just on the page.

## 9. Cost

Cloudflare Image Transformations bill per unique transformation, 5 000/month free. 800 guest
photos × 3 variants = 2 400 — **one wedding eats half the monthly allowance**, and two weddings in
one month put us over.

**Built 2026-08-23.** The grid is served from a 512 px derivative the uploading browser produced,
so a transformation is only spent when someone opens a photo full-screen. Measured on the local
stack: a 148 kB photo yields a 32 kB thumbnail.

- **Resampling is pica** (`src/lib/thumbnail.ts`), **dynamically imported**. Scaling 4000 px
  straight to 512 px with one `drawImage` aliases badly on exactly what a wedding is full of —
  lace, foliage, hair — and pica resamples properly in a worker. Verified in the browser that the
  chunk loads on the first upload and not before: DOM ready at 137 ms, pica fetched at 28.9 s when
  a file was picked. The ~14 kB is paid only by people who actually upload, never by the eighty
  who just look.
- **The native shortcut is a dead end**, which is why the library earns its place:
  `createImageBitmap`'s `resizeWidth` / `resizeQuality` are [unsupported in
  Safari](https://caniuse.com/createimagebitmap), and pica
  [disables that path by default](https://github.com/nodeca/pica) even where it exists because the
  result depends on the browser.
- **Every step degrades rather than fails**: no pica → plain canvas with smoothing; no WebP →
  JPEG; nothing at all → null, and the photo uploads exactly as before while the grid falls back to
  a Cloudflare transformation. No device ends up worse off than before this existed.
- **Timeouts, because the failure that hurts is not an exception.** A worker that never answers
  would leave the `await` hanging and the guest's upload sitting at "Nahrávám" until they gave up.
  pica gets 8 s to load and 10 s per resize; the whole thumbnail gets 25 s. Past any of those it
  falls through to the next option down.
- **A failure disables pica for the rest of the session.** Retrying a resizer that just stalled for
  ten seconds, once per photo in a batch of forty, would cost the guest six minutes to reach the
  same answer forty times.
- **It says so in the console** (`[g-gallery/thumbnail]`), once per session for pica and per photo
  for a total failure. The guest sees nothing — the photo uploads either way — but "why do the
  tiles look crunchy" needs to be answerable.
- **Two signed targets per photo**, `.thumb.webp` and `.thumb.jpg`, both in the presign response
  the client already waited for. A signed PUT is bound to one content type, so offering only WebP
  would have meant no thumbnail at all on a browser that cannot encode it.
- A plain `<canvas>` rather than `OffscreenCanvas`: Safari only got the latter in 16.4, and this
  should reach as many phones as possible.
- The key is derived from the one the server issued; the client only reports _which format_ it
  managed, never where to write it. R2 storage and egress are unaffected (egress is free, and guest photos are small
  relative to the photographer's 12 MB exports).
- **The orphan sweep deleted every one of these once** (2026-09-01). `sweepOrphanObjects`
  (`src/lib/reconcile.ts`) removes anything under `galleries/` that the database does not account
  for, and its live set was built from `Photo.objectKey` alone — so the thumbnail sitting beside
  the original, and every `_archive.zip`, looked like debris on the first weekly run after upload.
  The rows kept pointing at objects that were gone, which on Cloudflare renders as an empty tile:
  a thumbnail key is served straight from the bucket, with no transform behind it to fall back on.
  See docs/PLAN.md §5a for the fix and why it is shaped the way it is. The grid now also falls
  back to the transformed original when a thumbnail 404s, and `pnpm clear:missing-thumbs` clears
  the column for thumbnails already lost.

## 10. Privacy and law

Guests upload photos of other people, which is a different situation from the photographer
uploading their own work.

- A one-line consent next to the upload button, and a contact route for take-down requests in the
  gallery footer.
- **Indexing.** `src/app/g/[token]/[[...slug]]/page.tsx` already returns
  `robots: { index: false, follow: false }` on every path including the failure paths; `/s/` must do
  the same from its first commit. Deliberately **do not** add `Disallow: /g/` or `/s/` to a
  `robots.txt` — a disallowed URL cannot be fetched, so the crawler never sees the `noindex`, and
  Google may still list the bare URL if it finds it linked somewhere. Crawlable-but-noindex is the
  combination that actually keeps a page out of the index.
- **The CDN is a second surface.** Photo bytes are served from `cdn.svatebni-fotograf-cechy.cz`,
  where an HTML meta tag does not apply. A leaked image URL is indexable by Google Images unless the
  origin sends `X-Robots-Tag: noindex` — one Cloudflare Transform Rule on the R2 custom domain.
- **Referrer.** Nothing sets `Referrer-Policy` today; the browser default
  (`strict-origin-when-cross-origin`) already stops the token from leaving in a cross-origin
  `Referer`, so this is documentation rather than a hole. Setting it explicitly on `/g/` and `/s/`
  costs nothing and states the intent.
- **What "unlisted" does not cover, and must not be sold as covering.** Pasting the link into
  WhatsApp, Messenger, iMessage or Slack makes their servers fetch the page to build a preview
  card, so the URL and the wedding's title leave the recipient's device. The URL sits in browser
  history (and syncs, for anyone signed into Chrome), in screenshots of the address bar, and in our
  own Vercel and Cloudflare request logs, because the token _is_ the path. Unlisted means
  **not indexable and not guessable — not invisible.** Tokens still never reach analytics
  (invariant 7).
- Deletion stays in the couple's hands with no delay.
- No viewer IPs, viewer identity remains the first-party `anonKey` — unchanged.

## 11. Phases

Estimates are person-days for one developer and assume nothing already built gets reworked.
F1–F4 are the minimum that can run a real wedding.

| #   | Scope                                                                                                                                                                                                                                                                                                                                | Est.     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| F0  | Close §11 decisions                                                                                                                                                                                                                                                                                                                  | 0.5 d    |
| F1  | Guest uploads: `ShareLink.allowUpload`, second branch in presign/confirm, `Photo.source`, `uploadedByViewerId`, quotas, migration — **done 2026-08-23**, see below                                                                                                                                                                   | 3–4 d    |
| F2  | Wedding page: `Event` (own token + slug), `Gallery.eventId` / `eventKey` / `position` / `listedOnEvent` / `eventLinkId`, `/s/` route, cards with cover + counts, inline render of a lone gallery, trash + purge at the wedding level — **done 2026-08-23**, see below                                                                | 2–3 d    |
| F3  | Mobile reality: upload queue surviving screen lock and app switch, honest progress state — **done 2026-08-23**, see below                                                                                                                                                                                                            | 1–2 d    |
| F4  | ~~Moderation~~ — deferred by Pavel 2026-08-23. Guest self-delete and per-photo admin delete shipped instead (§7); the consent line shipped with F1                                                                                                                                                                                   | —        |
| F5  | Projection: fullscreen, live, no controls — **done 2026-08-23**, see below                                                                                                                                                                                                                                                           | 1–2 d    |
| F6  | Tests and a dry run: extend `e2e/` with the guest flow (no test-auth bypass needed — it is an unauthenticated path) — **e2e done 2026-08-23**. The physical half (real-device matrix, trial run on a small event) is **out of scope for this first version** (Pavel, 2026-08-23, third pass) — not dropped, just not blocking launch | 2 d      |
| F7  | Printable QR graphics — **done 2026-08-23**, see below                                                                                                                                                                                                                                                                               | separate |
| F8  | Video                                                                                                                                                                                                                                                                                                                                | separate |

Lifecycle, trash and purge operate on a gallery (`src/lib/lifecycle.ts`); the wedding page got its
own 30-day trash window on top, swept by the same daily cron.

### F1, as built (2026-08-23)

- **Schema** (`20260823103732_guest_uploads`): `ShareLink.allowUpload` (default false — every link
  that existed before this column stays read-only), `PhotoSource`, `Photo.source`,
  `Photo.uploadedByViewerId` (`onDelete: SetNull`, so the 13-month viewer cleanup forgets _who_
  without deleting the photo), `Viewer.uploads`.
- **One pipeline, two authorisations.** `/api/uploads/{presign,confirm,pending}` each take either a
  session or a share token; `src/lib/guest-upload-access.ts` is the guest gate and re-runs on every
  call, never once at page load. It also refuses a trashed gallery, which `resolveShareLink` does
  not check.
- **`src/lib/upload-run.ts`** now holds the browser transport both uploaders share, so the guest
  path inherited CRC32, EXIF-GPS stripping, retries and resume rather than reimplementing them.
- **Quotas** (`src/lib/guest-quota.ts`, unit-tested): 150 files per `anonKey`, 2 000 per gallery,
  25 MB per file, counted over PENDING _and_ CONFIRMED rows so presigning cannot be used to bypass
  them. Resumed files are not charged twice.
- **Refusals say what happened**: HEIC gets the Settings → Camera → Formats instruction, video gets
  "photos only", a full album says which ceiling was hit
  (`src/lib/upload-content-types.ts`, unit-tested).
- **Per-photo delete** (`deletePhoto`) — new, and not only for guest photos: there was no way to
  remove a single photo before, which §13.7 requires before guests can add any.
- **Attribution**: `POST /api/g/[token]/identify` sets the volunteered name, asked once _after_ the
  first upload lands. A viewer who opted out gets no attribution and no name.
- **E2E** (`e2e/guest-upload.spec.ts`, 4 cases × 2 browsers): a real file goes picker → presign →
  PUT to MinIO → confirm → grid; a read-only link to the _same gallery_ offers no button and is
  refused server-side with `UPLOAD_NOT_ALLOWED`; HEIC comes back 415 with `reason: "heic"`.

### F2, as built (2026-08-23)

- **Schema** (`20260823112834_wedding_event_pages`, `20260823113500_gallery_event_key`): `Event`
  with its own `tokenHash`; `Gallery.eventId` (`SetNull` — deleting the page must never delete the
  photographer's galleries), `eventKey`, `position`, `listedOnEvent`, `eventLinkId`.
- **A rename that prevents a real bug**: `Gallery.events` (activity log) became
  `Gallery.activityEvents`, likewise on `Photo` and `Viewer`. With a wedding page in the model,
  `gallery.event` and `gallery.events` would have been two unrelated things one letter apart.
  Relation fields are virtual, so this cost no migration.
- **`resolveShareLink` now resolves two token shapes** (§4). Every `/api/g/[token]/…` route, the
  password unlock and the guest-upload gate inherited the composite form without a line of change,
  because they all go through that one function.
- **`/s/[token]/[[...slug]]`** with `EventHub` cards (cover from the newest confirmed photo, count,
  date), canonical-slug redirect, inline render of a lone gallery, and a back link that appears
  only when there is a rozcestník to go back to — a plain `/g/` link must never hint that a wedding
  page exists.
- **`loadGalleryViewData`** (`src/lib/shared-gallery.ts`) is now shared by `/g/` and `/s/`, so the
  two surfaces cannot drift on ordering, page size or which photos count as visible.
- **Admin**: create a wedding, rename it, reorder and attach/detach galleries, the listing switch,
  and the picker for which share link a card grants through. A gallery can also be un-published,
  which cuts off every link to it including its card. Attaching freezes the `eventKey`, for the same reason a
  share link's slug is frozen. The page warns when a gallery is listed but has no designated link —
  the one state that silently produces no card.
- **Trash and purge**: a wedding page gets the same 30-day window as a gallery and is swept by the
  same daily cron. Trashing it does _not_ trash the galleries; they are the photographer's work and
  outlive the page that listed them.
- **Tests**: `isCardVisible` / `visibleEventCards` and `splitEventToken` are unit-tested (the card
  rule is a five-way conjunction whose failure is silent). `e2e/wedding-page.spec.ts` covers the
  canonical redirect, that an un-listed gallery has no card _and_ is refused by key without
  redirecting, the two-card rozcestník, and the single-gallery inline render keeping its `/s/` URL.

### Admin, reworked (2026-08-23)

Links are no longer shown once and then lost. `ShareLink.tokenCipher` and `Event.tokenCipher` keep
the token AES-256-GCM encrypted next to its hash (`src/lib/token-cipher.ts`, CLAUDE.md invariant 5
revised) so every address can be displayed and copied at any time. Resolution is unchanged: still
by hash, never by ciphertext.

- **`/admin`** — two buttons rather than two permanently open forms: _+ Nová svatba_ and
  _+ Samostatná galerie_. Weddings are listed with their address and a copy control.
- **`/admin/e/{id}`** — the wedding's own address at the top, then per gallery: the card address
  (`/s/{token}/{slug}/{key}`) _and_ the gallery's own `/g/` links, each copyable, so it is obvious
  which one to send to whom. Plus the listing switch, the card-link picker and detach.
- **`+ Nová galerie` inside a wedding** creates it, attaches it, publishes it and wires a share
  link as the card's route in one step — the sequence where the old flow silently produced no card.
  It is created **not listed**: everything is ready, but nothing reaches the rozcestník until
  someone presses _Zobrazit na stránce_. A new gallery must not publish itself to eighty people as
  a side effect of being created.
- A row whose token predates the ciphertext (or a deployment without `TOKEN_ENCRYPTION_KEY`) says
  so plainly instead of showing a broken link.

### F3, as built (2026-08-23)

- **`src/lib/wake-lock.ts`** holds a screen wake lock for the length of a run and re-acquires it
  when the tab comes back. This is the cheapest fix for the actual problem: uploads at a wedding
  usually die because somebody put the phone down and the display timed out after thirty seconds,
  not because anyone deliberately locked it. Best-effort — Safari has had it since 16.4, older iOS
  will not, and nothing depends on it.
- **`src/lib/upload-queue.ts`** persists the pending files in IndexedDB (`File` is
  structured-cloneable, so the _bytes_ are stored, not just the names). Each entry is removed the
  moment it lands, so an interrupted run resumes with exactly what is left. Returning to the page
  finishes the job automatically, even if the page was discarded entirely and the `File` objects
  are long gone from memory. Entries expire after 7 days, and a clock that jumped forward cannot
  create one that never expires. Without IndexedDB everything still uploads, it just cannot resume.
- Server-side resume is unchanged and does the other half: `matchResumeTargets` re-claims the
  PENDING rows by name and size, so a resumed run reuses them instead of creating duplicates.
- **Honest copy**: "displej nechám svítit. Kdyby se to přerušilo, dopošle se, až se sem vrátíte."
  Not "you can lock the phone" — on iOS, JavaScript is suspended when the screen locks and there is
  no API that keeps bytes flowing. What is promised is that nothing is lost, which is true.
- A resumed run shows _Zahodit zbytek_ for anyone who abandoned it on purpose. Requests already in
  flight finish; there is nothing to gain from abandoning bytes that are nearly there.

### F5 projection, as built (2026-08-23)

One **Projekce** button in the gallery header (not in the lightbox — Pavel's call), and from then
on there is nothing to operate. It runs fullscreen, holds a screen wake lock so the projector does
not sleep, and its only affordance is a way out (Escape, or a click).

- **Crossfade, not a src swap.** Two layers stay mounted and the incoming photo is placed in the
  hidden one a full interval before it is shown, so it is decoded by the time it fades in. A single
  `<img>` whose `src` changes flashes white on a slow connection, and on a five-metre screen that
  is the one thing everybody notices.
- **Live.** It refetches every 30 s, and a photo it has not shown yet goes next — so a guest's shot
  reaches the screen seconds after they upload it, which is the entire reason to project rather
  than hand someone a slideshow file. Once every photo has had its turn the pass restarts.
- **No controls on purpose.** Arrows, a counter or a scrubber on a screen nobody stands next to are
  only things for a guest to poke at. The E2E asserts the dialog contains exactly one button.
- 6 s per photo, 1.2 s fade, both constants at the top of `src/components/slideshow.tsx`.

### Guest self-delete (2026-08-23)

`GET /api/g/[token]/mine` lists the ids this `anonKey` uploaded; `DELETE` removes one, taking the
R2 object with it and dropping any pre-built ZIP back to PENDING. The affordance is a button in the
lightbox, shown only for the viewer's own photos, and the set refreshes after an upload so a shot
can be taken back straight away. E2E covers both halves: a guest deletes what they added, and a
photo somebody else added shows no delete button at all.

Nothing from the original F1–F3 scope is left open. What remains deliberately out of this first
version: moderation (§7), a co-host login for the couple (§13.6), the real-device matrix and small-
wedding trial run (F6's physical half), and video (F8). The separate PIN was **dropped** — see §5.
(The client-side thumbnail, §9, is _not_ on this list — it shipped the same day as F1, see below;
an earlier version of this paragraph said otherwise and was stale.)

### F7, as built (2026-08-23)

Printable QR signage the photographer generates from the admin and prints for the wedding
(`docs/GUEST-GALLERIES-RESEARCH.md` §10/§11 first proposed it; round-1 team review — engineer,
copywriter, wedding photographer, QA, designer, and a groom/paying-client persona — refined the
spec before building).

- **One fixed A6 card, two copy variants**, not GuestPix's 180 templates — a flat card, not a
  fold-over tent, kept deliberately simple for v1. "Na stůl" (short, the workhorse — one per table)
  and "Do fotokoutku" (longer, a single hero piece), both gender-neutral by construction
  (`src/components/printable-sign.tsx`): the artifact's original draft used a gendered participle
  ("co jsi vyfotil/a"), which a printed object can never patch after the fact the way an app string
  can, so it was rewritten out.
- **QR generation is server-side and dependency-free of any client JS** — `qrcode`'s `toString`
  (`src/lib/qr.ts`) returns SVG synchronously from a Server Component. Pure black on white with a
  4-module quiet zone, not a brand tint: round-1 findings agreed low contrast under evening
  reception lighting is a real scan-reliability risk, not worth trading for branding on the one
  element with no room for ambiguity.
- **Two entry points, not one**, because a printed sign's stability differs by what it points at
  (docs/GUEST-GALLERIES.md §2): `/admin/e/{id}/sign` always encodes the **event's** own `/s/`
  address — the stable one, since galleries come and go under it — while `/admin/g/{id}/sign`
  encodes a **standalone** gallery's own `/g/` link and is hidden from the admin UI once a gallery
  is attached to an event (`ShareLinkPanel`'s `hostedByEvent` prop), so the event address is what
  gets printed for anything actually part of a wedding.
- **Generation is refused, not silently offered, for an ineligible link** — round-1 QA findings:
  no `allowUpload`, a revoked link, or (docs/GUEST-GALLERIES.md §5's own rule — never put a
  password on the guest-upload link) a password-protected link each get an explanatory `Alert`
  instead of a sign that would fail silently on the wedding night. The event-level sign still
  generates even with zero upload-ready galleries yet (printing ahead of the first gallery being
  published is the whole point of a stable address) but shows a live readiness line —
  round-1 groom-persona finding: trusting a print run needs a "vede na: X · nahrávání zapnuto"
  confirmation, not a blind QR.
- **`window.print()` + `@media print`**, not a generated PDF — the browser already does this for
  free, and every photographer already knows "print → save as PDF" from other web tools.
- **`src/lib/sign-url.ts`, unit-tested**: the URL a sign encodes has no fallback and no error
  surfaces to anyone until the wedding (round-1 QA's top concern), so the path-building logic for
  both the gallery and event shapes is tested on its own, separate from the QR library itself.
- **Not done**: a fold-over tent format, brand/logo customization, and a real phone scan-test before
  first use — all explicitly out of scope for this pass, same as the rest of this section.

## 12. Test focus

Written down because none of it is caught by unit tests:

- **Devices** — iPhone on "Keep Originals" (HEIC out) _and_ "Most Compatible" (JPEG out); Android 9
  with an old Chrome; 40 photos selected at once; capture straight from the camera.
- **Network** — 3G throttling with packet loss mid-upload; screen locked for five minutes during an
  upload; switch to another app and back; twenty guests uploading into one gallery at once.
- **Access** — upload after expiry, after revocation, into an archived gallery, through a link
  without `allowUpload`; over quota; spoofed content-type; declared size smaller than the body.
- **Edge states** — empty gallery as the first guest sees it; couple deletes a photo a guest has
  open; 0 → 800 photos on an older phone; ZIP built before the guests finished uploading.

## 13. Decisions (resolved 2026-08-23)

1. **How does the couple share less than everything?** Not with per-link grant lists — those were
   dropped. Each gallery keeps its own forwardable `/g/` link, and `listedOnEvent` decides whether
   it also appears on the wedding page. Forwarding a gallery link never exposes the wedding page,
   since the event token is a separate secret. `allowUpload` stays on the guest gallery's own link,
   mirroring `allowDownload` and `allowReactions`.
2. **Per-guest cap?** 150 files per `anonKey`, 2 000 per gallery, raisable from admin, with a
   readable message at the ceiling.
3. **Visible immediately or after the wedding?** The couple's choice per gallery; default visible
   immediately.
4. **Moderation?** Not now (Pavel, 2026-08-23). A guest deleting their own photo covers the real
   case and the photographer's per-photo delete is the backstop; approve-first stays designed but
   unbuilt (§7).
5. **PIN on a single gallery?** Dropped entirely. The share-link password has done this since
   Phase 2: a second, password-protected link is exactly "show it to some, not all". Never put a
   password on the guest-upload link — the lockout counter is per link, so it would let one guest
   lock out the whole wedding. See §5.
6. **Who flips what the hub shows?** For v1, the photographer, on the couple's request. A co-host
   token is a _write_ capability in a URL — a different security class from today's read links. If
   it is built later: forced password, shorter expiry, reversible operations only (hide, never
   purge), every action written to `ActivityEvent`, re-verified server-side per action
   (invariant 3).
7. **Retention?** One year from the event date, then Infrequent Access and a notice to the couple.
   `src/lib/lifecycle.ts` already does the mechanism; this is configuration.
8. **Liability for a guest's photo?** Consent line at upload, take-down contact in the footer,
   deletion in the couple's hands. Cheap now, expensive retrofitted.

## 14. Deliberately out of scope

- **Video.** Every competitor has it and every guest expects it, but it means a player, poster
  frames, transcoding and transfer volume — its own project. Until then the UI must say so
  _before_ the file picker opens, not after a two-minute upload.
- **Mixing guest and photographer photos in one grid.** The earlier draft of this plan did that and
  separated them with a filter. The hub makes the separation structural, which is simpler and
  leaves nobody wondering whose photo they are looking at. `Photo.source` survives for attribution
  inside a guest gallery, not as a view filter.
- **Guestbook, RSVP, seating, face recognition.** See §1.

## 15. Follow-up decisions (2026-08-23, second pass)

Re-reviewed against the codebase — not just this document — before taking it back to Pavel.
Findings first, then what got decided.

- Everything §11 marks "done 2026-08-23" for F1–F3 and F5 is genuinely in the tree
  (`thumbnail.ts`, `wake-lock.ts`, `upload-queue.ts`, `slideshow.tsx`, `event-token.ts`, `pica` in
  `package.json`). `docs/TODO.md` §8 had not been updated after the thumbnail and projection
  landed and said otherwise; fixed there, not a real gap.
- `src/lib/guest-quota.ts` caps file **count** (150/`anonKey`, 2 000/gallery) but nothing caps
  upload **frequency**, and the two numbers are hardcoded constants, not admin-configurable as §8
  implies.
- `POST /api/uploads/confirm` records the client-reported `sizeBytes` without checking it against
  the actual R2 object — the "declared size mismatch" rejection §8 asks for does not exist.
- F6 (§11) has real e2e coverage already (`guest-upload.spec.ts`: 8 cases; `wedding-page.spec.ts`)
  but nothing physical has run yet.

Decided:

- ✅ **F7, printable QR graphics — green-lit**, next up. Moderation, co-host access (§13.6) and
  video (§14) stay deferred, not reopened.
- ✅ **Close two §8 gaps before real guests use this**: per-`anonKey` rate limiting on upload
  requests, and a server-side check that `confirm`'s declared `sizeBytes` matches the R2 object.
  Admin-configurable quota overrides stay out — the hardcoded constants are fine for now.
- ✅ **F6, the physical half**: a real-device matrix (iPhone HEIC, old Android/Chrome) and a trial
  run on a small real wedding before the first paid one. _(Superseded 2026-08-23, third pass — see
  §16: pushed out of this first version, not dropped.)_
- ✅ **Pricing** (`docs/GUEST-GALLERIES-RESEARCH.md` §11): bundled free with a full-day package.
  Not sold as a standalone product.

**The two §8 gaps — done 2026-08-23:**

- **Rate limit**: `checkGuestRateLimit` (`src/lib/guest-quota.ts`) caps a viewer at 80 presign
  requests per rolling 60 s, counted the same way the file quota already is — a Postgres count
  over recent `Photo` rows, no new infra. Deliberately generous: 80/minute clears one guest
  dumping a full camera roll (the client batches 8 files per presign call) while still bounding a
  script. Only applies when `anonKey` is present, matching the existing per-viewer quota's own
  limitation — an opted-out guest still bounded by the gallery cap. `POST /api/uploads/presign`
  returns 429 `rate_limited`.
- **Size mismatch**: `POST /api/uploads/confirm` now HEADs the R2 object (`headObject` in
  `src/lib/r2.ts`) and rejects with 409 `size_mismatch` if the actual byte count disagrees with
  the client's declared `sizeBytes`. Not added to `FATAL_CODES` in `upload-run.ts` — a truncated
  PUT on bad venue wifi is the likely cause, not an attack, so the existing per-file retry loop
  retries it rather than ending the run.
- Both surface a Czech message in `guest-uploader.tsx`; both are unit-tested
  (`guest-quota.test.ts`).

## 16. Follow-up decisions (2026-08-23, third pass)

F7 built (§11 has the as-built notes). Pavel's instruction this pass: build F7, and put everything
else still open on this document's list into this first version's TODO explicitly, rather than
leaving it ambiguous whether it is scheduled or dropped.

- ✅ **F6, the physical half, pushed out of this first version.** The real-device matrix (iPhone
  HEIC, old Android/Chrome) and the small-wedding trial run — §15 had this as "decided: do it before
  the first paid wedding" — are **not** happening as part of this batch. Not dropped: still the
  right thing to do before real guests use this at scale, just not a blocker for shipping F7 or
  anything else in this document. Whoever picks this back up should re-read §12 first.
- Reaffirmed, unchanged: moderation stays **dropped** (§7, §13.4), a co-host login for the couple
  stays **deferred** (§13.6), video stays **deferred** (§14). None of these were reopened this
  pass — they were already out of scope, this just makes the "first version" boundary explicit
  in one place instead of scattered across three sections.
- Not started, and out of this pass too: a fold-over tent sign format and brand/logo customization
  for the sign (round-1 F7 findings flagged both as reasonable v2 refinements, not v1 requirements).

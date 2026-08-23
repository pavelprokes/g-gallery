# g-gallery — Audit against two Google Photos architecture analyses

**Written: 2026-08-21** by a principal-engineer pass through the codebase, checked against two
independently-sourced write-ups on Google Photos' UX/UI and architecture supplied by Pavel:

- `google-photos-ux-ui-technicka-architektura.md` — 147 numbered sections, mostly
  `[OVĚŘENO]`/`[POZOROVATELNÉ]`/`[ODVOZENO]` tags against the public Google Photos API and Help
  Center docs, ending in a list of "big mistakes" and a recommended API surface.
- `Architektura a UX Google Fotek.md` — 9 sections on planetary-scale infrastructure (Spanner,
  interleaved tables, the AI tagging pipeline, mobile SQLite sync), sourced from public
  engineering blog posts and system-design write-ups.

Every finding below is tagged **[browser]** (reproduced live against a running `pnpm dev` +
Docker stack instance, with measured numbers) or **[code]** (read from source, not exercised).
`file:line` references were re-checked against the working tree as of this audit — the tree
moved twice during this pass (`7e04dcf` offline galleries, `8784998` digest idempotency), and
neither commit touched the files cited in §3–§5.

## 1. Scope and method

Both source documents describe a **consumer media library** for upward of a billion users:
timeline across a lifetime of photos, semantic search, face clustering, planetary-scale
distributed databases, an AI tagging pipeline. g-gallery is a **client-delivery gallery** for one
photographer: ~20 galleries/year, ~500 photos each, delivered once, read-heavy, no user library,
no search, no ML, a marginal budget of single-digit USD/month (`docs/PLAN.md` §1, §10). Most
individual recommendations in either document therefore do not transfer as-is, and `docs/PLAN.md`
already rejected several with sources (§3 "Rejected during revision").

The filter applied here has three outcomes, used consistently in §2–§7:

- **✅ holds** — a scale-independent principle the codebase already implements correctly.
- **⚠️ gap** — a scale-independent principle that is violated today, worth fixing regardless of
  growth. These become the technical/UX/accessibility findings in §3–§5.
- **⛔ out of scope** — a Google-scale mechanism that does not apply at this product's size,
  listed once in §6 so it does not resurface, with a reopening threshold in §7 where one exists.

## 2. Principle map

| Principle (source)                                                                                                    | Our state              | Evidence                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Media has a stable ID; URL is not identity (UX doc §2, §8)                                                            | ✅ holds               | `Photo.id` is the app identifier; `objectKey` is a separate unguessable R2 key (`prisma/schema.prisma:143,147`)                                                                                            |
| Thumbnail is a derivative, never the original (UX doc §6–§7)                                                          | ✅ holds               | Control-plane/data-plane split is a project invariant; `src/lib/image-loader.ts` never serves originals to the grid                                                                                        |
| Metadata loads before pixels; dimensions known pre-paint (UX doc §5, §14, big-mistake #117)                           | ✅ holds               | `Photo.width`/`height` selected server-side (`src/app/g/[token]/page.tsx:46-49`), `aspectOf()` reserves layout before any byte arrives (`gallery-view.tsx:81-84`) — zero image-driven CLS                  |
| Signed/short-lived media URLs, not permanent public ones (UX doc §8, big-mistake #114–115)                            | ⚠️ gap                 | Image URLs are permanent and unauthenticated; see §3.7                                                                                                                                                     |
| Cursor/keyset pagination over offset (UX doc §10–§11, big-mistake #116)                                               | ⛔ out of scope today  | Whole gallery server-rendered in one query; consciously closed, see §6 and §7                                                                                                                              |
| DOM virtualization for large collections (UX doc §13)                                                                 | ⛔ out of scope today  | See §6 and §7                                                                                                                                                                                              |
| Layout reserves space per aspect ratio (UX doc §14)                                                                   | ✅ holds               | Same evidence as the dimensions row above                                                                                                                                                                  |
| Neighbour prefetch in the viewer (UX doc §15, §106–§107)                                                              | ✅ holds               | `<link rel=preload imagesrcset>` for ±1, CORS-mode-matched (`gallery-view.tsx:423-457`)                                                                                                                    |
| Selection is a deliberate mode switch (UX doc §17)                                                                    | ✅ holds               | Long-press / hover-affordance / shift-range in `src/lib/selection.ts`, wired at `gallery-view.tsx:293-307,549-564`                                                                                         |
| Album is a reference table, not a file copy (UX doc §32–§33, §111)                                                    | ✅ holds (N/A)         | Single gallery per share link; no album-of-albums model needed at this scale                                                                                                                               |
| Share tokens hashed, never stored raw (UX doc §37, big-mistake #115)                                                  | ✅ holds               | `ShareLink.tokenHash` is SHA-256, raw token shown once (`src/lib/share-token.ts:16-18`)                                                                                                                    |
| Bulk export as an async job, not `for each: download()` (UX doc §43–§44)                                              | ✅ holds               | Signed manifest + streaming ZIP64 Worker (`src/app/api/g/[token]/zip/route.ts`, `worker/src/index.ts`)                                                                                                     |
| Trash as soft delete, not immediate `DELETE` (UX doc §49–§50)                                                         | ⚠️ gap                 | No trash exists at all; see §3.9                                                                                                                                                                           |
| Security state must be a cross-cutting invariant (UX doc §51–§52, on Locked Folder)                                   | ⚠️ gap (narrower)      | No Locked Folder equivalent needed, but the _image-URL_ half of this principle is the §3.7 gap                                                                                                             |
| Control plane vs data plane, different caching/security per plane (UX doc §99–§100)                                   | ✅ holds               | Explicit in `docs/PLAN.md` §2 diagram and `src/lib/image-loader.ts` header comment                                                                                                                         |
| Fast path before expensive reasoning (UX doc §26, #113)                                                               | ✅ holds (N/A)         | No search/AI path exists to race against                                                                                                                                                                   |
| Never send more data, a bigger image, or wider permission than the UI needs right now (UX doc §147, the closing line) | ⚠️ gap                 | Violated concretely by the `sizes` mismatch in §3.1 and the permanent image URLs in §3.7                                                                                                                   |
| Progressive resolution escalation in the viewer (UX doc §15)                                                          | ⚠️ gap                 | Lightbox skips straight to full-size; see §3.2                                                                                                                                                             |
| Accessible, keyboard-navigable grid and viewer (UX doc §90)                                                           | ⚠️ gap                 | See §5 in full                                                                                                                                                                                             |
| Event-driven, decoupled media pipeline (arch doc §5)                                                                  | ✅ holds (right-sized) | Upload confirm → `CONFIRMED` is synchronous by design; no thumbnail generation needed since transforms are on-demand at the edge — decoupling a pipeline that doesn't exist would be over-engineering here |
| Separate metadata DB from object storage (arch doc §6)                                                                | ✅ holds               | Postgres for metadata, R2 for bytes, exactly as the analysis recommends, at a scale where Spanner/interleaved tables are not needed (§6, §7)                                                               |

## 3. Technical findings

### 3.1 Grid `sizes` ignores the `max-w-7xl` container cap — **[browser]**

`gallery-view.tsx:596` sets `sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"`,
but the grid lives inside `<main className="mx-auto max-w-7xl ...">` (`gallery-view.tsx:460`),
which caps the content column at 1280 CSS px regardless of viewport width. Measured live at the
widest viewport this environment could produce (1404 CSS px — window resize saturated there):

|                   | measured                                         |
| ----------------- | ------------------------------------------------ |
| viewport width    | 1404px                                           |
| `main` width      | 1280px (capped)                                  |
| actual tile width | 307px = **21.8vw** of the viewport               |
| `sizes` claims    | 25vw = 351px                                     |
| bucket picked     | 384w (smallest available — already correct here) |

At this viewport the mismatch is masked because 351px still rounds up to the same smallest
srcset bucket (`IMAGE_SIZES = [384]`, `src/lib/image-sizes.ts:18`) that a correctly-capped 307px
tile would need. But `main`'s width is fixed past ~1344px viewport width while `sizes`' `25vw`
keeps growing linearly with the viewport — extrapolating from the measured constant tile width,
a 1920px-wide viewer would compute `25vw = 480px` against an unchanged ~305px tile and cross into
the 640w bucket; a 2560px display crosses further. Every such crossing downloads roughly 2× the
necessary bytes **and** burns a distinct billable Cloudflare transformation
(`docs/PLAN.md` §6) for a size the grid never needed. Fix: cap the `sizes` expression at the
container's actual max, e.g. `(max-width: 1280px) 25vw, 320px`.

### 3.2 Lightbox has no progressive resolution escalation — **[browser]**

`gallery-view.tsx:649` sets `backgroundColor: "transparent"` on the lightbox image wrapper (the
grid tile's average-colour placeholder, already computed and already in the DOM, is deliberately
not carried over), and the `<Image>` at `gallery-view.tsx:668-677` goes straight to
`sizes="100vw"` with `priority`. Opening a photo the first time is a black rectangle until the
full-width variant arrives — confirmed visually in this session (no visible placeholder or
low-res flash between the click and the image painting). `docs/TODO.md:55-65` marks "progressive
enhancement — low-resolution preview instantly, high-resolution streams in behind it" as done;
the code does not implement it. Cheapest fix: reuse the tile's `placeholder` colour as the
lightbox background instead of `transparent`.

### 3.3 Confirmed bug: the lightbox's global `keydown` handler steals input from the name prompt — **[browser, reproduced]**

`gallery-view.tsx:384-405` attaches `window.addEventListener("keydown", onKey)` whenever the
lightbox is open, and the handler never checks `event.target`. `NamePrompt` (the "Kdo se dívá?"
dialog, `gallery-view.tsx:981-1020`) can open **on top of** an open lightbox — favoriting or
reacting from inside the lightbox triggers it (`gallery-view.tsx:237-241,280-283`) — and its
`autoFocus`ed text input is a normal DOM node the lightbox listener still sees.

Reproduced end-to-end: opened the lightbox, cleared local viewer identity, clicked the heart to
trigger the name prompt, confirmed focus was on the `<input>` (`document.activeElement` was the
input), then sent the keystroke `s`. Result: **the input stayed empty** and **the underlying
photo got selected** (`selectionActive` toolbar appeared: "1 vybraná", "Stáhnout"). The lightbox
handler's `event.preventDefault()` on `" "`/`"s"` (`gallery-view.tsx:394-400`) fires regardless of
where focus is. Any viewer who types a name starting with `s` (a very common first letter in
Czech: "Simona", "Sára", "Standa"…) silently fails to enter it and instead selects a photo.

A second, worse interaction from the same reproduction: pressing **Escape** while the name prompt
is open does not close the name prompt (it has no Escape handler of its own — §5.6) — it bubbles
to the lightbox's handler and closes the **lightbox**, leaving the name-prompt modal **orphaned
on top of the grid**, with the grid's own selection toolbar now visible and active underneath it.
Screenshot-verified: after Escape, the page showed the grid with a "1 vybraná / Stáhnout 1 fotku"
toolbar and the "Kdo se dívá?" dialog both on screen simultaneously.

Fix: gate the lightbox `keydown` handler on `event.target === document.body` (or check that the
target isn't a form control), and give `NamePrompt` its own dialog semantics and Escape handler
(also needed for §5.6).

### 3.4 No `React.memo` on the grid tile

`gallery-view.tsx` has no memoized child components. Every photo tile is a closure inside the
single `photos.map(...)` at line 542; any state change anywhere in the component (a favorite
toggle, a reaction, opening the lightbox, moving the selection anchor) re-renders all N tiles and
all N `<Image>` elements. At 500 photos this is a measurable amount of avoidable render work per
interaction. Fix: extract `PhotoTile` and wrap in `React.memo`, passing only the primitives each
tile needs.

### 3.5 `takenAt` and `sortOrder` are dead columns — **[code]**

`Photo.takenAt` (`prisma/schema.prisma:161`) is accepted by the confirm route's Zod schema
(`src/app/api/uploads/confirm/route.ts:22,59`) but the uploader never sends it
(`src/components/uploader.tsx:90-101` posts only `photoId, etag, crc32, sizeBytes, width, height,
placeholder`) — there is no EXIF `DateTimeOriginal` parser anywhere (`src/lib/exif-gps.ts` only
walks IFD0 to strip the GPS pointer). `Photo.sortOrder` (`prisma/schema.prisma:164`) is read in
three places (`src/app/g/[token]/page.tsx:42`, `src/app/admin/g/[id]/page.tsx`,
`src/app/api/g/[token]/zip/route.ts:53`) and written in zero — every row is `0`, so it is a
no-op leading column of the only index on `Photo`
(`@@index([galleryId, status, sortOrder])`, `prisma/schema.prisma:172`), with `createdAt` doing
all the real ordering work. Either wire both (an EXIF-date backfill for `takenAt`, a drag-reorder
action for `sortOrder`) or drop them and the dead index column.

### 3.6 No Web Worker for the upload pipeline — **[code]**

`docs/PLAN.md:99` specifies "Client-side per file, in a Web Worker: CRC32 … + EXIF GPS strip".
`src/components/uploader.tsx:69-77` runs `stripGpsFromFile`, `crc32HexOfBlob`, `readDimensions`
(via `createImageBitmap`), and `averageColorOf` (via `OffscreenCanvas`) all on the main thread,
per file, in the upload loop. For a 500×12 MB session this is 500 synchronous decode/hash passes
competing with the UI thread — the admin's own browser tab, not a client's, but still a real
responsiveness cost the plan already flagged as the intended design.

### 3.7 Image URLs are permanent, public, and unaffected by revocation — **[code]**

`src/lib/image-loader.ts` builds URLs directly from the R2 object key with no signature and no
expiry. Security rests entirely on the unguessable 128-bit `storagePrefix` + random UUID
filename (`docs/PLAN.md` §4.1 "v1"). `docs/PLAN.md:74-77` already documents this as a known gap
("v2 hardening: a lightweight Worker … validating a signed, expiring token") and
`prisma/schema.prisma:124` even comments `storagePrefix` as "rotated on expiry" — but nothing
rotates it (confirmed: no write site touches `storagePrefix` after gallery creation). Revoking or
expiring a share link (`ShareLink.revokedAt`/`expiresAt`) stops the _share page_ and the
authenticated API routes, but a URL captured before revocation keeps working forever.

This was "v2, optional" in the original plan. It should move up because the new offline cache
(`public/sw.js`, shipped 2026-08-21) makes the same unauthenticated URLs reachable from a
service-worker cache that persists **after** the share page itself would refuse a revoked
viewer — the SW does drop its cache on a 403/404/410 from the share page (`docs/TODO.md:18-24`),
but the raw image URL was never behind auth to begin with, so this is a pre-existing gap the new
feature makes marginally more visible, not one it introduces.

### 3.8 Documentation drift

- `CLAUDE.md:39-40` states share-link passwords "use argon2"; the code
  (`src/lib/share-token.ts:24-39`) uses scrypt, a deliberate choice documented and justified in
  `docs/PLAN.md:82` ("avoids a native argon2 dependency on Vercel"). The invariant text is stale.
- `docs/PLAN.md:83` promises "a rate-limited password prompt"; `unlockShareLink`
  (`src/app/g/[token]/actions.ts:14-28`) has no rate limiting of any kind, and scrypt (keylen 64)
  makes each guess a real CPU cost on a Vercel function — a cheap amplification vector against a
  password-protected gallery.
- `docs/PLAN.md:172-174` specifies reactions as "API writes via Prisma → server publishes a
  Broadcast via service-role REST"; no Broadcast code exists (confirmed: grep for `broadcast` in
  `src/` is empty). Reactions and favorites are fetched once on mount
  (`gallery-view.tsx:165-200`) and never update live — two viewers in the same gallery do not see
  each other's hearts in real time, while presence ("who's viewing now") is genuinely live.

### 3.9 No trash / soft delete, and no gallery- or photo-level delete UI — **[code]**

No model has `deletedAt`/`trashedAt`. `GalleryStatus.ARCHIVED` and `Gallery.archivedAt` exist in
the schema (`prisma/schema.prisma:101,127`) but are never set or read anywhere in `src/`. The one
real deletion path, `deleteGalleryWithObjects()` (`src/lib/reconcile.ts:58-70` — deletes R2
objects before the DB row, cascades correctly), is exported and **called from nowhere**: no
action, route, or admin UI invokes it. There is also no per-photo delete. `docs/PLAN.md:316-319`
explicitly decided "nothing is deleted, ever" for storage-tier purposes, which is a reasonable
retention policy — but it leaves no answer for "the client sent the wrong gallery" or "this photo
needs to come down," which is a different question than retention.

### 3.10 Missing baseline web-app hygiene — **[code]**

- No `src/app/**/error.tsx`, `not-found.tsx`, or `loading.tsx` anywhere — an exception rendering
  the share page shows Next's default error screen to a client, not a branded fallback.
- No security headers anywhere (`next.config.ts` has only `images`; `vercel.json` has only
  `crons`) — no CSP, no `Referrer-Policy`, no `X-Frame-Options`/`frame-ancestors`.
- `/g/[token]` has no `robots` meta and there is no `robots.txt`/`sitemap.ts` — confirmed live,
  `document.querySelector('meta[name="robots"]')` is `null`. The unguessable token protects
  against guessing, not against indexing if a client pastes the link somewhere crawlable.
- No `generateMetadata` anywhere — confirmed live, `document.title` on a real share page reads
  `"g-gallery"`, the generic root-layout title, not the gallery's own title. Same for the
  description meta tag.
- `src/app/page.tsx` is `<div>Hello world!</div>` — the apex of the photographer's own domain.

## 4. UX findings

### 4.1 Grid tiles crop content, they don't justify it

The layout is `flex flex-wrap` with `flexGrow`/`flexBasis` set from aspect ratio
(`gallery-view.tsx:541-548`), but tile **height is a fixed Tailwind class per breakpoint**
(`h-36 sm:h-48 lg:h-52`, `gallery-view.tsx:547`) and the image is `object-cover`
(`gallery-view.tsx:598`). Because width is proportional but height is fixed, a tile's rendered
box does not exactly match the photo's own aspect ratio, and the image is cropped to fill it —
visible in this session's test gallery: group shots lose people at the tile edges. A true
justified layout (row height computed per row, e.g. a lightweight version of the Knuth-Plass
approach the UX analysis describes in §5.1/§5.2, or simply per-row height solving) would show the
whole photo. For a photographer's delivery gallery this is a content problem, not a cosmetic one
— the crop can hide the reason the client picked that photo.

### 4.2 Lightbox has no browser-history entry

Opening the lightbox does not push a history entry (`setLightboxIndex` is local state only, no
`router.push`/`history.pushState` anywhere in the file). On Android, the hardware/gesture back
button does not close the lightbox — it navigates away from the gallery entirely. There is also
no deep link to a single photo (no `/g/[token]?photo=<id>` or similar), so a viewer cannot share
"look at this one" without describing it.

### 4.3 `move()` wraps silently at the ends

`gallery-view.tsx:368-382` computes `(current + delta + photos.length) % photos.length` with no
end-of-gallery signal — pressing → on the last photo silently jumps to the first with no visual
or haptic cue that the sequence wrapped.

### 4.4 Favorites and reactions visibly flicker in after hydration

Both are fetched client-side after mount (`gallery-view.tsx:165-200`) because the viewer's
identity (`anonKey`) lives in `localStorage`, which isn't available during server render. A
returning viewer briefly sees every heart in its unfavorited state before the fetch resolves.
Moving `anonKey` to a cookie would let the server render the correct initial state, at the cost
of the GDPR framing currently built around "nothing leaves the browser as a cookie"
(`docs/PLAN.md` §8 GDPR section) — worth a deliberate decision, not a silent fix.

## 5. Accessibility (WCAG 2.2 AA)

Verified live against a running instance (Chrome, `localhost:3000/g/<token>`, 14-photo test
gallery) unless marked **[code]**.

### 5.1 2.4.3 Focus Order / 2.4.11 Focus Not Obscured — **fails, [browser, reproduced]**

The lightbox (`role="dialog" aria-modal="true"`, `gallery-view.tsx:641-643`) does not trap focus.
Reproduced: focused the "Zavřít" (close) button inside the open dialog, pressed **Shift+Tab three
times**, and focus landed on a **"Přidat do oblíbených" (add to favorites) button belonging to a
background grid tile** — confirmed via `dialog.contains(document.activeElement) === false`. The
dialog visually covers the entire viewport (`fixed inset-0 bg-black/90`), so a keyboard user is
now interacting with a control that is not on screen at all. There is also no focus transfer into
the dialog on open and no focus restoration to the originating tile on close — both confirmed
absent by reading the code (`gallery-view.tsx:639-798`), consistent with the observed escape.

### 5.2 2.1.2 No Keyboard Trap (inverse problem) / 4.1.2 Name, Role, Value — **NamePrompt fails, [browser, reproduced]**

`NamePrompt` (`gallery-view.tsx:981-1020`) has no `role="dialog"`, no `aria-modal`, and no Escape
handler. See §3.3 for the full reproduction: Escape leaks to the lightbox underneath and closes
the wrong thing, leaving the prompt orphaned on screen with no keyboard path to dismiss it besides
tabbing to "Přeskočit"/"Uložit".

### 5.3 1.4.3 Contrast (Minimum) — **fails for dark-mode secondary text, [browser, measured]**

Measured the actual rendered RGB values of the two Tailwind v4 theme tokens the dark-mode toolbar
and footer text use (`text-neutral-500` unconditionally, `dark:bg-neutral-950/90` for the sticky
toolbar and `dark:bg-neutral-900` for the name-prompt card), via a canvas round-trip so the
browser's own color engine resolved the `oklch()` theme values to sRGB rather than computing them
by hand:

| foreground         | background       | measured RGB                | contrast ratio | WCAG AA (normal text, 4.5:1) |
| ------------------ | ---------------- | --------------------------- | -------------- | ---------------------------- |
| `text-neutral-500` | `bg-neutral-950` | (115,115,115) on (10,10,10) | **4.18:1**     | **fails**                    |
| `text-neutral-500` | `bg-neutral-900` | (115,115,115) on (23,23,23) | **3.78:1**     | **fails**                    |

Both pass AA-large (3:1) but not AA for the normal-size body/footer copy that actually uses this
pairing (the GDPR notice, the offline-toggle label, the footer opt-out link).

A second, more structural finding surfaced while measuring this: the page never sets
`color-scheme` (confirmed live: `getComputedStyle(document.documentElement).colorScheme ===
"normal"`, no `<meta name="color-scheme">`). `body`/`html` have no background color at all
(`bodyBg`/`htmlBg` both `rgba(0,0,0,0)`) and `globals.css` is the single line `@import
"tailwindcss"` — no root background token. Tailwind's `dark:` variant is media-query-based here
(no `darkMode: "class"` config, confirmed: no `tailwind.config.*` exists at all in a Tailwind v4
project, which is CSS-config-only). The practical consequence: under a real OS dark-mode
preference, only the handful of elements carrying an explicit `dark:` class (the sticky toolbar,
the name-prompt card, a few borders) flip to a dark background, while the rest of the page —
`body`, `main`, the grid background — stays on the browser's default white canvas, because
nothing tells the browser the whole page opts into a dark palette. This produces a partially
inverted, inconsistent page rather than a coherent dark theme, and it is _why_ the contrast pairs
above exist in isolation rather than against a full dark background.

### 5.4 2.5.8 Target Size (Minimum) — **at the floor, not below it, [browser, measured]**

Measured actual rendered dimensions:

| element                                            | measured | WCAG 2.5.8 minimum |
| -------------------------------------------------- | -------- | ------------------ |
| selection checkbox (`gallery-view.tsx:876-910`)    | 24×24px  | 24×24px            |
| heart/favorite button (`gallery-view.tsx:843-866`) | 39×24px  | 24×24px            |

Both pass the letter of SC 2.5.8 — they sit exactly at, not under, the 24px floor — but leave zero
margin, and are well under the 44–48px usability guidance (Apple HIG / Material) that the
checkbox's own hover-reveal design already fights against on touch (it's hidden until long-press,
`gallery-view.tsx:868-875`).

### 5.5 2.4.1 Bypass Blocks / operable tab order at scale — **[browser, measured] + [code, extrapolated]**

Measured on the 14-photo test gallery: **45 focusable elements** for 14 tiles ≈ **3.2 per photo**
(tile-open button + selection checkbox + heart button), no skip link, no `aria-label` on the
`<ul>`. Extrapolated to a real 500-photo gallery: **~1,500 sequential tab stops** before reaching
the footer, with no way to skip past the grid and no arrow-key navigation within it (confirmed
absent: no `onKeyDown` on the grid, no roving `tabindex`, no `role="grid"`).

### 5.6 4.1.3 Status Messages — **fails, [code]**

No `aria-live` region exists anywhere in the repository. The selection count
(`gallery-view.tsx:484-486`), the ZIP state transitions ("Připravuji…" / the error message at
`gallery-view.tsx:530-534`), and every state of `OfflineToggle` (`src/components/offline-toggle.tsx`
— seven distinct states, zero aria attributes across all of them) are silent to assistive
technology.

### 5.7 1.1.1 Non-text Content — **partial fail, [code]**

`alt={photo.fileName}` (`gallery-view.tsx:594,670`) uses the raw uploaded filename
(`IMG_4821.jpg`) as alt text on every tile and in the lightbox, duplicating information already
in the tile button's own `aria-label` (`gallery-view.tsx:588-590`) rather than describing the
photo's content. Acceptable as a fallback, not as the only description a screen-reader user gets.

### 5.8 Scroll lock — **verified working, correcting an assumption**

Checked live whether the background scrolls while the lightbox is open (mouse wheel over the
overlay, `window.scrollY` before/after): **it does not** — `scrollY` was unchanged after a
5-tick wheel scroll directly over the open lightbox. There is no explicit `overflow: hidden`
lock in the code, but the `fixed inset-0` overlay happens to absorb wheel input in practice, so
this is **not** a live bug on desktop. It remains an unverified concern for touch: the lightbox's
inner wrapper is explicitly `touch-pan-y` (`gallery-view.tsx:648`), which the code comments
document as intentionally permitting vertical panning — on a touch device this could pan the
grid behind the modal. Not exercised in this session (no touch emulation available); flagged as
**[code, unverified]** rather than claimed as a confirmed bug.

## 6. Consciously out of scope (do not re-propose without re-reading these)

| Recommendation                                                               | Source                           | Why it doesn't apply here                                                                                                                                           |
| ---------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DOM virtualization / windowing                                               | UX doc §13, big-mistake #110     | `docs/TODO.md:35-47` measured a 500-photo page at 223 kB brotli'd HTML with native `loading=lazy` doing viewport prioritisation for free, and closed it             |
| Cursor/keyset pagination for the timeline                                    | UX doc §10–§11, big-mistake #116 | Same measurement; whole-gallery server render has no user-visible cost yet (`docs/PLAN.md:286-288`)                                                                 |
| Knuth-Plass justified-layout solver                                          | arch doc §2.1                    | Real justified layout is worth doing (§4.1) but a full line-breaking optimizer is overkill for rows of ~4 tiles; a per-row height solve is enough                   |
| Date-based timeline grouping / fast-scroll-by-year                           | UX doc §3, §65–§66               | One gallery = one event; there is no multi-year timeline to navigate                                                                                                |
| Semantic/vector search, Ask-Photos-style hybrid search                       | UX doc §24–§27; arch doc §5.2    | No search surface exists or is planned; nothing to search across one delivered event                                                                                |
| Face clustering / People & Pets                                              | UX doc §28                       | No cross-gallery identity model; out of product scope                                                                                                               |
| Photo Stacks / burst deduplication                                           | UX doc §18                       | Photographer delivers curated exports, not raw bursts                                                                                                               |
| Memories / generated collections                                             | UX doc §58–§59                   | No returning-user surface to generate memories from                                                                                                                 |
| Locked Folder / multi-tier visibility states                                 | UX doc §51–§52                   | One gallery = one audience via one or more share links; no in-library privacy tiers                                                                                 |
| Google Cloud Spanner, interleaved tables, TrueTime                           | arch doc §6                      | Postgres has no join-fanout problem at this row count; this is solving a problem the product doesn't have                                                           |
| Mobile-client SQLite full-library sync, tombstones, temp-UUID reconciliation | arch doc §3                      | No native mobile client exists or is planned; the web share page has no offline-mutation conflict surface to reconcile                                              |
| Two-phase upload token (`uploadToken` → `batchCreate`)                       | UX doc §20–§21                   | Presign → PUT → confirm (`src/app/api/uploads/{presign,confirm}/route.ts`) already separates transport from the domain transaction; a third phase adds nothing here |
| AI tagging pipeline (YOLO/ArcFace/OCR/embeddings)                            | arch doc §5.1                    | No product surface consumes any of this                                                                                                                             |
| Read-only shard / traffic isolation for ML batch jobs                        | arch doc §6.2                    | No ML batch workload exists to isolate                                                                                                                              |

## 7. Reopening thresholds

- **Virtualization + cursor pagination** (§6): reopen when a real gallery exceeds a few thousand
  photos, or a real device shows measurable DOM cost — the exact language already in
  `docs/TODO.md:45-47`.
- **Signed/short-lived image URLs + width allowlist** (§3.7): reopen at the first gallery where
  revocation is a real client expectation, not a theoretical one — e.g. the first paid dispute or
  a client who explicitly asks "can you take that link down now." `docs/PLAN.md:74-80` already
  scopes the fix (a validating Worker in front of the image path); this audit just moves the
  trigger earlier than "v2, someday."
- **True justified layout** (§4.1): reopen when the photographer notices or flags cropped
  composition in a delivered gallery — a concrete complaint is a better trigger than a redesign
  done speculatively.
- **Broadcast for live reactions** (§3.8): reopen if concurrent same-room viewing becomes common
  enough that stale reaction counts are noticed (weddings with a shared-screen slideshow are the
  likely trigger).

## 8. Fix order

### P1 — before the next gallery ships to a client — **done 2026-08-21**

1. ✅ Fix the lightbox `keydown` handler to ignore events whose target is a form control (§3.3),
   and give `NamePrompt` real dialog semantics: `role="dialog"`, `aria-modal`, an Escape handler
   scoped to itself, focus trap, focus return on close (§3.3, §5.2).
2. ✅ Lightbox focus trap: move focus into the dialog on open, trap Tab/Shift+Tab inside it,
   restore focus to the originating tile on close (§5.1).
3. ✅ Add a root background token and `color-scheme` declaration so `dark:` variants apply
   consistently across the whole page, not just the elements that opted in; darken
   `text-neutral-500` in dark contexts to clear 4.5:1 (§5.3).
4. ✅ Add `aria-live="polite"` regions for selection count, ZIP state, and `OfflineToggle` state
   (§5.6).
5. ✅ `noindex` meta + per-gallery `generateMetadata` (title/description) on `/g/[token]` (§3.10).
6. ✅ Add `error.tsx`/`not-found.tsx` for the share route tree (§3.10).
7. ✅ Fix the grid `sizes` attribute to respect the `max-w-7xl` cap (§3.1).

Verified live in a browser, not just by reading the diff — every P1 item above plus a bug found
in the process are in `git log` as `fix: accessibility audit P1 — focus trap, keyboard bug,
noindex, contrast`.

### P2 — next release — **done 2026-08-21**

1. ✅ Rate-limit `unlockShareLink` (§3.8). Implemented per-`ShareLink` (not per-visitor — no
   viewer identifier is involved, per the "never store viewer IPs" invariant): 5 consecutive
   wrong passwords locks the link for 15 minutes, checked _before_ `verifyPassword` runs so the
   scrypt CPU-amplification angle is actually closed, not just UI-throttled.
2. ✅ Lightbox: seed the background with the tile's placeholder colour instead of `transparent`
   before the full image loads (§3.2); push a history entry on open so back/Escape close it
   symmetrically (§4.2). **Superseded 2026-08-23**: the placeholder-colour background was
   replaced with a fixed black background plus a real opacity fade-in on load (Pavel's call,
   matching Google Photos) — the black flash this item fixed no longer reads as broken once the
   image actually fades in instead of popping in, so masking it with colour stopped being needed.
3. ✅ Arrow-key navigation across the grid with a roving `tabindex` (§5.5).
4. ✅ `React.memo` the photo tile (§3.4) — the shared long-press ref moved to a local one per
   tile in the process (a new `react-hooks/immutability` lint rule flags mutating a ref passed
   down as a prop, and per-tile is also the more correct model).
5. ✅ Reconciled `CLAUDE.md`'s argon2 claim with the actual scrypt implementation, and clarified
   its "image bytes never flow through Vercel" invariant against the offline-galleries service
   worker (§3.8).
6. ✅ Resolved `takenAt`/`sortOrder`: removed both (project owner's call — cleanup over building
   EXIF-date backfill or a reorder feature), and shrank the `Photo` index accordingly (§3.5).

Verified live in a browser: rate-limit lockout confirmed against the DB after 5 failed attempts
(and a 6th attempt with the _correct_ password still rejected while locked); lightbox
back-button/close/Escape symmetry confirmed via `window.history`; roving tabindex confirmed via
realistic-timing key dispatch. Found and fixed one real bug outside this list's original scope in
the process: `OfflineToggle` computed its initial state from `offlineSupport()` (which reads
`window`) inside a `useState` initializer, which runs differently on the server (no `window`) than
on the client's pre-hydration first render (real `window`) — a straight SSR/CSR mismatch that threw
an uncaught hydration error on every real page load, caught only because the page was actually
loaded in a browser rather than trusted from typecheck/lint/test/build output. All in `git log` as
`fix: accessibility audit P2 — rate limiting, lightbox history, roving nav`.

### P3 — once conditions change (see §7 for triggers)

Five of six triggered early — Pavel wanted the URL slug for readability regardless of scale, and
asked for the other four alongside it rather than waiting for their individual thresholds.

1. ✅ Signed/short-lived image URLs + width allowlist (§3.7) — **done 2026-08-21**. HMAC-signed
   grant per gallery `storagePrefix` (`src/lib/image-signing.ts`, mirrors `zip-manifest.ts`'s
   format), minted server-side with a 2-hour TTL and appended to `next/image` `src` as `?sig=&exp=`
   (`src/lib/image-loader.ts`); a Worker `GET /img/{key}` (`worker/src/index.ts`) verifies the
   grant, checks the key falls under the signed prefix, allowlists width/quality against
   `image-sizes.ts`, and proxies to the zone's own Image Transformations. Degrades gracefully to
   today's unsigned direct-CDN URLs when `IMAGE_SIGNING_SECRET` is unset, so it is safe to ship
   ahead of the Worker route actually being deployed (`docs/SETUP.md` documents the deferred
   deployment steps).
2. ✅ Virtualization and cursor pagination (§6, §7) — **done 2026-08-21**. TanStack Query
   (`useInfiniteQuery`) + TanStack Virtual (`useWindowVirtualizer`) over a new cursor-paginated
   API route (`src/app/api/g/[token]/photos/route.ts`, keyset on `createdAt`+`id`, page size 60);
   the server-rendered first page seeds `initialData` so there is no client refetch on load.
3. ✅ A real justified layout without cropping (§4.1, §7) — **done 2026-08-21**. Greedy per-row
   packing scaled to fill the container width exactly (`src/lib/justified-layout.ts`), replacing
   the fixed-row-height `object-cover` grid — no crop, full aspect ratio preserved per tile.
4. ✅ Trash / soft delete, and wiring `deleteGalleryWithObjects()` to an actual admin action
   (§3.9) — **done 2026-08-21**. `Gallery.trashedAt`/`purgeAt`, a "Smazat" button in the admin
   detail page with a confirm step, a "Koš" section on the admin list with a restore action and a
   countdown to purge, and a daily cron (`/api/cron/purge-trash`) that calls the existing
   `deleteGalleryWithObjects()` once `purgeAt` passes — 30-day recovery window.
5. Move the upload pipeline's CRC32/EXIF/decode work into a Web Worker (§3.6) — still open.

**New, added mid-session, not in the original audit:** a readable URL slug
(`/g/{token}/{slug}`, e.g. `/g/xY82f.../svatba-anna-a-petr-2026-08-12`) built from the gallery
title and `eventDate` (`src/lib/gallery-slug.ts`), frozen into `ShareLink.slug` at link-creation
time and appended after the token — purely cosmetic, never parsed on resolution, so old links
without a slug keep working unchanged. See `docs/TODO.md` §6 for why it sits after the token
rather than before (the token's base64url alphabet includes `-`/`_`, which would make a
slug-before-token boundary ambiguous).

Broadcast for live reactions (§3.8, §7) remains the one originally-listed P3 item not done this
round — its trigger (concurrent same-room viewing, e.g. a wedding slideshow) hasn't come up yet.

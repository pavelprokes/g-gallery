# g-gallery — Architecture Plan

**Revised: 2026-08-20** — every load-bearing claim below was verified against official documentation
(Cloudflare, Vercel, Supabase, Prisma, Next.js, better-auth, Google) by a parallel doc-verification
pass. Sources are linked inline. Verdicts: ✅ confirmed · 🔄 changed during revision · ❌ rejected.

## 1. Product

A photographer's **client-delivery gallery** (Pixieset/Pic-Time category) with a Google-Photos-style
UI (justified grid, lightbox, swipe/keyboard navigation).

- ~**20 galleries/year**, ~500 photos each, ~12 MB JPEG exports (no RAW) → **~120 GB/year**, ~10k photos/year
- Private share links (expiry + optional password), client favorites, whole-gallery ZIP download,
  optional watermark
- Admin (photographer) signs in with Google; clients access via share links
- Budget: a few USD/month of _marginal_ cost (Vercel Pro already paid)

## 2. Architecture

```
┌─ Browser (admin upload) ─────────────┐
│ per-file JIT presign → PUT direct    │      presigned PUT (bypasses Vercel 4.5MB limit)
│ CRC32 + EXIF-GPS strip client-side   │ ────────────────────────────┐
└──────────────────────────────────────┘                             ▼
┌─ Next.js 16 on Vercel (Pro) ─────────┐        ┌─ Cloudflare R2 (jurisdiction=eu) ─────────┐
│ HTML/JSON only — zero image bytes    │        │ originals, immutable Cache-Control        │
│ better-auth + Google OAuth (admin)   │        │ zero egress, ~$0–2/mo year 1              │
│ presign route, share links, favorites│        └───────┬───────────────────────┬───────────┘
│ proxy.ts (optimistic) + in-handler   │                │ same-zone source      │ R2 binding
│ auth checks (authoritative)          │                ▼                       ▼
└───────────────┬──────────────────────┘   ┌─ photos.<domain> (CF zone) ─┐  ┌─ ZIP Worker ──────────┐
                │ Prisma 7 (adapter-pg)    │ /cdn-cgi/image/… transforms │  │ streaming ZIP64,      │
                ▼ :6543 pooler             │ AVIF/WebP, edge-cached      │  │ store-only, known CRCs│
┌─ Supabase Free Postgres ─────────────┐   └─────────────────────────────┘  │ Workers Paid $5/mo    │
│ metadata, sessions, shares, CRC32s   │                                    └───────────────────────┘
│ keep-alive: PostgREST write 3×/day   │
└──────────────────────────────────────┘
```

**Hard prerequisite (step zero):** a domain whose DNS zone lives in the user's Cloudflare account.
Custom R2 domain and Image Transformations both require it
([R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/),
[transformation sources](https://developers.cloudflare.com/images/transform-images/sources/)).

## 3. Stack — verified decisions

| Layer        | Decision                                                      | Verdict                    | Key verified fact                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------ | ------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework    | Next.js 16.3.1, App Router, TS strict                         | ✅                         | Async-only request APIs; Turbopack default for dev+build; Node ≥ 20.9 ([blog](https://nextjs.org/blog/next-16))                                                                                                                                                                                                                                                                                                                                                                                                   |
| Route gating | **`src/proxy.ts`** (not `middleware.ts`)                      | 🔄                         | `middleware.ts` deprecated in 16 and **silently ignored** if left over; proxy runs Node runtime, optimistic checks only ([docs](https://nextjs.org/docs/app/getting-started/proxy))                                                                                                                                                                                                                                                                                                                               |
| Auth         | **better-auth 1.7.x (pinned)** + Google OAuth                 | 🔄 **replaces Auth.js v5** | Auth.js v5 is _still beta_ (5.0.0-beta.32) in maintenance mode; its maintainers (the Better Auth team) recommend better-auth for new projects. better-auth is officially Next 16-compatible, Prisma-7-ready, ships an admin/role plugin ([discussion](https://github.com/nextauthjs/next-auth/discussions/13252), [docs](https://better-auth.com/docs/integrations/next))                                                                                                                                         |
| ORM          | Prisma 7.9.1 + `@prisma/adapter-pg`                           | 🔄 setup changed           | Rust engine removed; driver adapter **required**; `directUrl` in schema.prisma **deprecated** — CLI reads direct URL from `prisma.config.ts`; generator `prisma-client` with explicit `output` ([upgrade guide](https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7))                                                                                                                                                                                                     |
| DB           | Supabase Free (2nd and **last** free slot)                    | ✅ with hardening          | 500 MB DB (~10× headroom), 5 GB egress untouched (images never touch Supabase), pgvector available ([pricing](https://supabase.com/pricing))                                                                                                                                                                                                                                                                                                                                                                      |
| Storage      | R2, **`jurisdiction=eu` at creation (immutable)**             | ✅                         | $0.015/GB-mo Standard, 10 GB free, zero egress; single PUT up to 5 GiB → no multipart at 12 MB ([pricing](https://developers.cloudflare.com/r2/pricing/), [limits](https://developers.cloudflare.com/r2/platform/limits/))                                                                                                                                                                                                                                                                                        |
| Image CDN    | CF Image Transformations on the zone                          | ✅ + guard                 | This is **Cloudflare's own reference architecture** for R2 galleries ([ref-arch](https://developers.cloudflare.com/reference-architecture/diagrams/content-delivery/optimizing-image-delivery-with-cloudflare-image-resizing-and-r2/)). 5,000 unique/mo free **per account**; on the pure free plan overage → **hard error 9422 (broken images), not billing** — enable Images Paid so a bad month costs ~$0.50–1.50 instead of breaking galleries ([pricing](https://developers.cloudflare.com/images/pricing/)) |
| next/image   | `images.loader: 'custom'` + Cloudflare `loaderFile`           | ✅                         | Bypasses `/_next/image` entirely → **zero** Vercel image-optimization billing and zero Vercel transfer for image bytes ([CF loader](https://developers.cloudflare.com/images/transform-images/integrate-with-frameworks/), [Vercel costs](https://vercel.com/docs/image-optimization/managing-image-optimization-costs))                                                                                                                                                                                          |
| Upload       | Browser → R2 presigned PUT (aws4fetch)                        | ✅                         | Vercel 4.5 MB function body limit is current; direct-to-storage is Vercel's own recommended pattern ([limits](https://vercel.com/docs/functions/limitations), [KB](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions))                                                                                                                                                                                                                                                        |
| ZIP download | CF Worker, streaming **ZIP64** writer, **Workers Paid $5/mo** | 🔄 designed                | 6 GB > 4 GiB → ZIP64 mandatory; zip.js broken on workerd, littlezipper unvalidated → ~300-line custom store-only writer with **CRC32 precomputed at upload**; HTTP streaming has _no wall-clock or size limit_; R2→Worker→client egress $0 ([limits](https://developers.cloudflare.com/workers/platform/limits/))                                                                                                                                                                                                 |
| Hosting      | Vercel **Pro team** (existing)                                | ✅                         | Hobby prohibits commercial use; Pro includes 1 TB transfer + 10 M edge requests — HTML/JSON-only app is orders of magnitude below ([fair use](https://vercel.com/docs/limits/fair-use-guidelines), [pro plan](https://vercel.com/docs/plans/pro-plan))                                                                                                                                                                                                                                                            |

### ❌ Rejected during revision

- **Auth.js v5** — perpetual beta, maintenance mode, docs won't track Next 16 (see above).
- **Client-side ZIP (primary)** — Safari/iOS still lack `showSaveFilePicker` in 2026; a 6 GB
  browser-assembled archive is hostile to exactly the clients a photographer serves.
- **"Any origin" transformation sources** — would let strangers burn the 5k monthly quota.
- **Google Drive as origin/backup tier** — rejected in an earlier pass (quota model, no CDN
  semantics); optional `rclone` backup only.

## 4. Security & privacy design (from the adversarial critique)

1. **Image-layer privacy is the #1 hole in naive designs**: share-link auth in Next.js does _not_
   protect `photos.<domain>/…` URLs. Mitigations, in order of adoption:
   - **v1:** unguessable object keys — `galleries/<128-bit-random>/<photo-ulid>.jpg`; key material
     never enumerable; rotate (re-key) on gallery expiry.
   - **v2 (optional hardening):** a lightweight Worker in front of the image path validating a
     signed, expiring token minted by the app.
2. **Variant-parameter abuse**: anyone with one image URL can request arbitrary width/quality combos
   and burn the transformation quota. Mitigate with a WAF/Worker rule allowing only the whitelisted
   widths (see §6) — schedule with v2 hardening.
3. **Share links**: ≥128-bit crypto-random tokens, constant-time comparison, server-side expiry
   check on _every_ surface (page, presign, favorites, ZIP), scrypt for gallery passwords (Node built-in, the same primitive better-auth uses — avoids a native argon2 dependency on Vercel),
   rate-limited password prompt.
4. **EXIF GPS**: transformations strip EXIF (default `metadata=copyright`; AVIF/WebP output drops
   EXIF entirely), but **ZIP delivers untouched originals** → strip GPS **client-side before
   upload** (piexifjs or similar) during the same pass that computes CRC32.
5. **Server Actions are public POST endpoints** — every action re-verifies the session internally;
   `proxy.ts` is optimistic-only by official guidance.
6. **GDPR** (EU photographer): `jurisdiction=eu` bucket handles residency; still needed —
   privacy policy, processor DPAs (Cloudflare/Supabase/Vercel/Google), retention policy, and a
   deletion workflow spanning DB + R2.

## 5. Upload pipeline (500 × 12 MB ≈ 6 GB per session)

- **Just-in-time per-file presigning** (batch of ~10 ahead), _not_ one big up-front batch —
  presigned URLs expire (set ~15 min) while a session takes 30–60+ min.
- Bounded concurrency (~3–4 parallel PUTs), per-file retry with backoff, resume-after-crash by
  reconciling confirmed uploads from the DB.
- Client-side per file, in a Web Worker: **CRC32** (stored in DB — feeds the ZIP writer) +
  **EXIF GPS strip**; byte size recorded for exact ZIP `Content-Length`.
- Upload confirmation protocol: browser reports the returned **ETag** → row flips to `CONFIRMED`;
  a periodic reconciliation job diffs DB keys vs bucket listing (orphans + ghosts) and cascades
  gallery deletion to R2.
- CORS on the bucket (exact JSON from [R2 docs](https://developers.cloudflare.com/r2/buckets/cors/)):
  `AllowedOrigins: [prod domain, http://localhost:3000]`, `AllowedMethods: ["PUT"]`,
  `AllowedHeaders: ["Content-Type"]`, `ExposeHeaders: ["ETag"]`. Content-Type is signed into the
  URL — the browser must send it byte-identical.
- R2 object metadata at upload: `Cache-Control: public, max-age=31536000, immutable`.

## 6. Image delivery

- URL shape: `https://photos.<domain>/cdn-cgi/image/width=W,quality=82,format=auto,fit=scale-down/<key>`
- **Trim `images.deviceSizes`/`imageSizes` to 4–6 fixed widths** (e.g. 384, 640, 1080, 1920, 2560)
  and pin quality — default Next srcset (16 widths) can 4× the unique-transformation count.
- Budget math (verified definition of "unique"): 500-photo gallery ≈ 2,000–3,000 uniques when first
  browsed; counter resets monthly and _re-visits to old galleries re-count_ — expiring share links
  is what keeps this bounded. 2 active galleries/month fits the 5k free allowance.
- `format=auto` counts as one unique; skip `dpr` (srcset already covers it).
- Accepted sources stay at default **"allowed origins"** (same zone).
- Wide-gamut note: ICC profiles are applied but sRGB conversion isn't formally guaranteed —
  **export galleries in sRGB** (standard practice) and keep one wide-gamut test image in QA.

## 7. ZIP delivery (Worker)

- Store-only streaming **ZIP64** writer (~300 lines) on **Workers Paid ($5/mo)**; R2 bucket binding.
- CRCs + sizes known from DB → complete local headers up front, exact `Content-Length`
  (browsers detect truncation), CPU ≈ stream plumbing only; in-Worker CRC32 fallback for
  missing values; `limits.cpu_ms` raised as insurance.
- HTTP streaming: no wall-clock limit while the client stays connected, no response-size limit,
  egress $0. **Never** move this into Queues/Cron (15-min wall clock) or Vercel functions
  (transfer billing).
- Auth: the Worker sits outside the app session — it accepts a short-lived signed manifest token
  minted by the Next.js app (share-link + expiry validated there).
- Cross-extractor integration test on a real >4 GiB archive (macOS Archive Utility, Windows
  Explorer, 7-Zip) before launch.
- Fallback (flaky client connections): same writer pre-generates into R2 via HTTP-triggered Worker
  (multipart, uniform ~100 MiB parts — R2 requires same-size parts), served as a resumable static
  object with a lifecycle-rule expiry (+$0.09/gallery-month while cached).
- v1 escape hatch shipped regardless: per-photo download.

## 8. Activity & notifications (Google Photos model + our extensions)

Researched against Google Photos Help Center + official Supabase/Vercel/WebKit/Resend/CNIL docs
(2026-08-20). What Google actually does — and where we deliberately go beyond it:

| Mechanic                    | Google Photos (verified)                                                                                                                                                                       | g-gallery                                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| View counts                 | **None.** Only avatar "seen" markers: faded = invited, not opened; solid avatar sits next to the newest item that person has viewed ([help](https://support.google.com/photos/answer/6131416)) | Clone the avatar strip (per-viewer high-water mark) **+ add** `N viewers · M views` counter — our extension                 |
| Anonymous link viewers      | Can view without account, **leave no trace**, owner gets nothing ([share-media](https://developers.google.com/photos/library/legacy/guides/share-media))                                       | We track them GDPR-safely (below) — this is the differentiator                                                              |
| Interactions (like/comment) | Require Google Account                                                                                                                                                                         | Substitute: signed first-party viewer-id + optional "Kdo se dívá?" name prompt on first reaction (= Google's "join" moment) |
| Owner notifications         | Email **only** for a new album; ongoing activity = push/in-app only; **no view notifications at all**                                                                                          | Mirror the channel split: email for first-time moments, feed + optional web push for the rest, throttled                    |
| Link semantics              | Unguessable URL + "reset link" invalidates old one                                                                                                                                             | Same: 128-bit token + reset; resetting is the only true revoke (warn owner)                                                 |

**Data model** (all writes via Prisma; source of truth in Postgres):

- `Viewer` (galleryId, anonKey from `crypto.randomUUID()` in localStorage, displayName?, firstSeen/lastSeen; **no IP stored**)
- `ViewSession` (new session when last activity > 30 min) → **views** = sessions, **unique views** = distinct Viewers
- `ActivityEvent` (type: GALLERY_VIEW | PHOTO_VIEW | REACTION | FAVORITE | DOWNLOAD | VISITOR_IDENTIFIED; galleryId, photoId?, viewerId) → per-photo views + uniques for the admin, and the owner's Updates-style feed
- `PushSubscription`, `NotificationThrottle` (≥30 min between instant pushes per gallery)

**Recording (server-side)**: gallery view = POST on share-page load + 5-min visibility heartbeat —
which **doubles as genuine Supabase keep-alive activity**; photo view = lightbox-open
`navigator.sendBeacon` (image bytes never touch Vercel, and lightbox-open is the honest metric —
grid impressions are not views). No third parties; all identity/logic server-side.

**Realtime "someone is viewing now"** — Supabase Realtime, _not_ Vercel:

- Free tier verified: 200 concurrent connections, 2M messages/mo, Presence + Broadcast
  ([limits](https://supabase.com/docs/guides/realtime/limits)) — we'll use <1 %.
- Browser loads `@supabase/supabase-js` **only** as the Realtime socket (anon key, documented safe);
  public channel with unguessable topic `g:sha256(shareToken)[..16]` (same trust model as the link).
  Presence `track()` **once per session** (rate limit: 5 calls/30 s). Reactions: API writes via
  Prisma → server publishes a Broadcast via service-role REST. **Skip `postgres_changes`** (per-
  subscriber auth overhead, doesn't fit Prisma writes).
- Anti-pattern confirmed: SSE/WebSocket from Vercel functions bills provisioned memory for the whole
  open connection (~$0.02–0.04/viewer-hour) and dies at maxDuration
  ([websockets](https://vercel.com/docs/functions/websockets)) — **no Vercel route ever holds a connection**.
- Realtime is **not** documented as pause-preventing activity — the PostgREST keep-alive cron stays.

**Owner notification pipeline** ($0/month):

1. **In-app feed** (admin): reverse-chron ActivityEvents, `last_read_at`, bell badge.
2. **Web Push** — `web-push` npm lib + VAPID, no third party. iOS ≥ 16.4 requires the admin PWA
   added to Home Screen + permission via tap ([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/));
   prune subscriptions on 404/410. Fired on new ViewSession (not heartbeats), throttled.
3. **Daily digest** — Vercel cron 07:00 Europe/Prague → aggregate yesterday → **AWS SES over SMTP**
   (à la carte, $0.10/1,000 emails, no free tier outside EC2-origin sending —
   [pricing](https://aws.amazon.com/ses/pricing/)); skip when empty. `src/lib/mailer.ts` falls
   through to SMTP when `RESEND_API_KEY` is unset, so no code depends on which provider is
   configured. Chosen over Resend to share one verified sending domain
   (`svatebni-fotograf-cechy.cz`) and one IAM-managed credential with the photographer's main site
   (`svatebni-fotograf-cechy-2.0`) rather than running two mail providers for one business.
   Email is the reliable channel if the iOS PWA friction fails — treat it as primary, push as
   enhancement.

**GDPR** (CNIL audience-measurement criteria as the strictest written benchmark —
[sheet 16](https://www.cnil.fr/en/sheet-ndeg16-use-analytics-your-websites-and-applications)):
viewer-id is **functional/strictly-necessary** (powers the viewer's own favorites/reactions +
"viewed" dedup), first-party, single-site, never cross-referenced, no IP stored, lifetime ≤ 13
months and deleted with the gallery, privacy notice + "nepočítat mě" opt-out in the gallery footer.
Names shown only when voluntarily entered.

**Vercel Web Analytics** (aggregate traffic only — cannot do per-viewer/per-photo work):

- Pro includes **zero** free events; $0.03/1k billed against the $20 monthly credit → effectively $0
  at our traffic; 12-month retention; **set a Spend Management alert** (uncapped billing)
  ([pricing](https://vercel.com/docs/analytics/limits-and-pricing)).
- `<Analytics beforeSend={scrub} />` in a small `'use client'` wrapper in root layout; `scrub`
  rewrites `/g/<token>` → `/g/[token]` and deletes secret query params — **ship the scrub before the
  component**, tokens otherwise land verbatim in the dashboard
  ([redacting](https://vercel.com/docs/analytics/redacting-sensitive-data)).
- Per-gallery segmentation: **server-side** `track('gallery_view', { galleryId })` from
  `@vercel/analytics/server` after token validation (token never enters any analytics payload;
  Pro allows 2 custom properties).
- App domain stays **DNS-only** to Vercel (already decided) — Cloudflare proxying silently breaks
  analytics unless `/_vercel/insights/*` is forwarded.
- **Skip Speed Insights** ($10/project/mo — out of budget).

## 9. Operations

**Supabase keep-alive** (the pause definition is officially vague; community evidence says
direct-connection-only traffic has _failed_ to prevent pausing —
[docs](https://supabase.com/docs/guides/platform/free-project-pausing),
[#13121](https://github.com/orgs/supabase/discussions/13121)):

- Single-row `keepalive` table (RLS on, no anon policies).
- Vercel cron `0 */8 * * *` (3×/day) → `CRON_SECRET`-protected route → **PATCH via PostgREST**
  (`/rest/v1/keepalive?id=eq.1`, service key) — simultaneously a platform API call _and_ a real DB
  write, satisfying both interpretations of "activity". Optional Prisma `UPDATE` as second signal.
- **Alert on non-200** (external uptime monitor) — the cron is the sole defense; a Supabase pause
  takes down sign-in too (DB-backed sessions). Add `session.cookieCache` to cut per-request DB reads.
- Watch the ~1-week pause-warning email; 1-year restore window is the safety net.

**Backups** (Free has none — [docs](https://supabase.com/docs/guides/platform/backups)):
weekly GitHub Actions `supabase db dump` via the **IPv4 session pooler :5432** (free-tier direct
connection is IPv6-only; GH runners are IPv4-only), gzip → **store outside Cloudflare** (private
GH repo/artifact) — one Cloudflare account must not hold both photos and DB dumps.
**R2 originals**: the photographer's local archive is the system of record (documented), optional
`rclone` sync to a second provider later.

**Prisma 7 connection setup**: runtime = module-scope singleton
`new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL /* :6543 ?pgbouncer=true */, max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000 }) })`
(pg default connect timeout is 0 = hangs forever — always set it); CLI/migrations read `DIRECT_URL`
(session pooler :5432) from `prisma.config.ts`. Read the actual pooler hostname from the dashboard.

**Monitoring**: Sentry (app + Worker), Vercel Spend Management alert lowered from the $200 default,
Cloudflare billing notifications, monthly transformation-quota check before publishing a second
gallery in one month.

## 10. Cost model (marginal, on top of existing Vercel Pro)

| Item                               | Year 1                       | Year 3        | Note                                                                                   |
| ---------------------------------- | ---------------------------- | ------------- | -------------------------------------------------------------------------------------- |
| R2 Standard storage                | ~$0.75→1.65/mo               | ~$5.25/mo     | +$1.80/mo per retained year → **decide retention/IA policy before launch**; IA saves ⅓ |
| Image Transformations              | $0 (occasionally $0.50–1.50) | same          | requires Images Paid enabled to avoid 9422 hard failure                                |
| Workers Paid (ZIP)                 | $5/mo                        | $5/mo         | hard dependency of the ZIP feature — deferrable to v2                                  |
| Supabase / Vercel marginal         | $0                           | $0            | Realtime, cron, functions — all inside free/included quotas                            |
| Notifications (web-push + AWS SES) | ~$0                          | ~$0           | VAPID self-hosted; SES à la carte $0.10/1,000, ~30 emails/mo ≈ $0.003/mo               |
| Vercel Web Analytics               | ~$0                          | ~$0           | $0.03/1k events, absorbed by the $20 Pro credit; Spend alert set                       |
| Domain                             | ~$10/yr                      | ~$10/yr       | if not already owned                                                                   |
| **Total**                          | **~$1–7/mo**                 | **~$6–11/mo** | lower bound = ZIP deferred                                                             |

## 11. Build phases

1. **Phase 0 — prerequisites**: domain on Cloudflare zone, `jurisdiction=eu` bucket + CORS + custom
   domain, zone Transformations on, Google OAuth client (External, **In production**, basic scopes
   only — no verification review needed), Supabase project, `.env` scheme.
2. **Phase 1 — vertical slice**: schema (User/Gallery/Photo/ShareLink/Favorite + `crc32`, `sizeBytes`,
   `storageTier`, `status`) → better-auth (Google, admin role by email allowlist) → presign route →
   minimal uploader → gallery grid + lightbox via custom CF loader → share-link page.
3. **Phase 2 — delivery features** — _mostly done_: ✅ expiry/password unlock (HMAC cookie bound to
   the password hash), ✅ favorites + name prompt + viewer chips, ✅ per-photo download, ✅ justified
   layout, ✅ uploader (JIT presign, retry, CRC32 + GPS strip + dimensions), ✅ ghost-upload
   reconciliation cron, ✅ keep-alive cron, ✅ view tracking with admin per-gallery & per-photo
   views/uniques, ✅ Vercel Analytics with beforeSend scrub, ✅ restore-verified daily DB backup to
   R2 with 30-day pruning, ✅ upload resume-after-crash (PENDING rows re-matched by name+size),
   ✅ orphan-object sweep via ListObjectsV2 (weekly, 24h age guard, live keys never candidates).
   **Phase 2 complete.**
4. **Phase 3 — activity & polish**: ✅ avatar strip + name prompt, ✅ reactions (5-kind enum, one
   row per viewer+photo), ✅ owner Updates feed with unread badge, ✅ Web Push (VAPID, 30-min
   per-gallery throttle, prunes 404/410) + ✅ daily digest (AWS SES over SMTP in prod, Mailpit
   locally, skipped when empty), ✅ justified layout, ✅ keyboard + swipe lightbox.
   ✅ Supabase Realtime presence ("viewing now"; hashed topic, no-ops without the public env vars,
   counts people not connections), ✅ IA lifecycle job (monthly, publication age + 30-day
   recent-activity guard, never deletes). **Phase 3 complete.**
   **Virtual scroll deferred** into `docs/TODO.md` §3 — infinite scroll with a stable order changes
   the data-fetching model from "all photos server-rendered" to cursor pagination, so anything
   built against the current model would be rewritten by it.
5. **Phase 4 — bulk download & offline**: ✅ Google-Photos-style selection (hover checkbox on
   pointer devices, long-press on touch, shift-click ranges, carried into the open photo),
   ✅ "Stáhnout vše" / "Stáhnout N fotek", ✅ HMAC-signed manifest minted by the app,
   ✅ store-only streaming ZIP64 Worker with an exact Content-Length via `FixedLengthStream`,
   ✅ single-photo download served with `Content-Disposition` (the `download` attribute is ignored
   cross-origin, so this never worked before), ✅ offline galleries (opt-in per gallery; caches the
   display-size variants this device requests, ~170 MB rather than the originals' 8 GB, plus the
   page and the app's JS/CSS so it hydrates; `mode: "cors"` because opaque responses are padded to
   ~7 MB each against quota). Deploying the Worker needs **Workers Paid $5/mo** — the Free plan
   caps CPU at 10 ms per request. Remaining: watermark variants (feasibility + quota impact
   unverified — needs its own spike).
6. **Phase 5 — E2E test suite**: deferred deliberately to the very end (`docs/TODO.md` §0) — the
   routes, upload flow and share gating kept moving, so tests written earlier would get rewritten.
   Unit tests (Vitest) continue as normal throughout.

## 12. Decisions (resolved 2026-08-20)

1. **Domain**: `svatebni-fotograf-cechy.cz`, registered at Vedos.cz; app stays on Vercel.
   Plan: keep registration at Vedos, **delegate nameservers to Cloudflare** (free zone — full-NS
   delegation is required on the free plan; partial CNAME setup is Business-only). In the
   Cloudflare zone: apex/`www` → Vercel (per Vercel docs prefer **DNS-only/grey-cloud** records for
   the app to avoid double-proxying), `photos.svatebni-fotograf-cechy.cz` → R2 bucket custom domain
   (proxied — required for Cache + Transformations).
2. **ZIP**: deferred to **v2** (Workers Paid $5/mo not purchased yet). v1 ships per-photo download.
   CRC32 + byte size are still captured at upload from day one so the ZIP Worker can be added
   without re-reading 6 GB per gallery.
3. **Images Paid**: **enable up front** — $0 in normal months, overage pennies, no 9422 breakage.
4. **Retention**: originals move to **Infrequent Access** N months after delivery (default N=6,
   configurable); nothing is deleted. `Photo.storageTier` drives it; lifecycle job in **Phase 3**
   (this said Phase 2 until 2026-08-21 — the phase list always had it in Phase 3).
   Cost effect: long-run storage growth drops from ~$1.80 to ~$1.20 per month per retained year.

Marginal cost with these decisions: **~$1–2/mo in year 1** (+$5/mo later if/when ZIP ships).

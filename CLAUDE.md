# g-gallery

Photographer client-delivery gallery (Google-Photos-style UI). Production env vars live in
**`docs/VERCEL-ENV.md`**. **`docs/PLAN.md` is the architecture authority** — every stack decision there was verified against official docs with sources; read it
before changing architecture, storage, auth, or billing-relevant code.
**`docs/GUEST-GALLERIES.md`** is the authority for guest uploads and wedding hubs (adopted
2026-08-23, Phase 6) — read it before touching share-link resolution, the presign routes, or
anything that assumes one share link means one gallery.

## Commands

- `pnpm docker:up` — local stack (Postgres :5433, MinIO :9000, imgproxy :8080, Mailpit :8025).
  `cp .env.docker.example .env` on first run; see `docs/DEVELOPMENT.md`.
- `pnpm dev` / `pnpm build` / `pnpm start` — Next.js 16 (Turbopack is default; never add webpack config)
- `pnpm typecheck` · `pnpm lint` · `pnpm test` (Vitest, unit) · `pnpm test:e2e` (Playwright vs prod build)
  — **stop `pnpm dev` before running E2E.** `playwright.config.ts` sets `reuseExistingServer`, so a
  dev server on `:3000` is used instead of a production build, and Turbopack compiling routes on
  first request blows every timeout. It looks like a broad regression across unrelated specs; it
  isn't.
- `pnpm db:generate` · `pnpm db:migrate` · `pnpm db:seed` · `pnpm db:reset` · `pnpm db:studio` —
  Prisma 7 (CLI reads `DIRECT_URL` via `prisma.config.ts`)
- `pnpm smoke:storage` — presign → PUT → public GET → transform → DELETE against the current `.env`
- `pnpm auth:tables` — dump the table shape better-auth expects. **Use this, not
  `@better-auth/cli generate`** — the published CLI lags the library (it emits a 1.4-era
  schema against better-auth 1.7 and silently omits `Account.issuer`).

## Stack

Next.js 16 App Router (TS strict) on Vercel Pro · better-auth 1.7.x (pinned) + Google OAuth ·
Prisma 7 + `@prisma/adapter-pg` → Supabase Postgres (Supavisor `:6543` runtime, `:5432` migrations) ·
Cloudflare R2 (`jurisdiction=eu`) + Image Transformations · Tailwind 4 · Vitest + Playwright.

## Invariants — do not violate

1. **Image bytes and ZIPs never flow through Vercel** (functions, routes, or `/_next/image`).
   All `next/image` usage goes through the custom loader (`src/lib/image-loader.ts`); photo `src`
   is the R2 object key, not a URL. The loader's transform backend is switchable via
   `NEXT_PUBLIC_IMAGE_TRANSFORM` (`cloudflare` | `imgproxy` | `none`) — never bypass it. This is
   about the _path_ bytes travel: the offline-galleries service worker (`public/sw.js`) caching
   CDN-fetched images client-side in Cache Storage does not violate it.
2. **Uploads**: browser → R2 presigned PUT only (Vercel has a hard 4.5 MB body limit). Client
   computes CRC32 + strips EXIF GPS before PUT; server records `etag`, flips `Photo.status`.
3. **Auth**: route gating lives in `src/proxy.ts` (Next 16 — `middleware.ts` is deprecated and
   silently ignored). Proxy checks are optimistic only; every Server Action and Route Handler
   re-verifies the session (`auth.api.getSession`) — Server Actions are public POST endpoints.
4. **Next 16 idioms**: `await props.params` / `await searchParams` / `await cookies()` always;
   `revalidateTag(tag, 'max')` (single-arg form is a TS error); parallel route slots need `default.tsx`.
5. **Share links**: `tokenHash` (SHA-256) is the **only** thing access resolves by — nothing is
   ever looked up by a raw token. Since 2026-08-23 the token is _also_ stored AES-256-GCM encrypted
   (`tokenCipher`, key in `TOKEN_ENCRYPTION_KEY`, never in the DB) **for display in the admin
   only**, so a link can be copied again instead of existing for one render
   (`src/lib/token-cipher.ts`). Passwords stay one-way (scrypt — Node built-in, avoids a native
   argon2 dependency on Vercel). Expiry/revocation is enforced server-side on every surface (page,
   presign, beacon, download).
6. **No long-lived connections from Vercel** (SSE/WebSocket) — realtime belongs to Supabase Realtime.
7. **Privacy**: never store viewer IPs; viewer identity is a first-party `anonKey` only;
   share tokens must never reach Vercel Analytics (server-side `track` with `galleryId`, beforeSend scrub).
8. `cacheComponents` stays **off**; gallery/admin routes are dynamic; classic ISR only for public pages.

## Conventions

- Code, comments, commit messages: English. Conversation with the user: Czech.
- Zod-validate every Route Handler input. Colocate unit tests as `*.test.ts(x)` next to source.
- Vitest cannot render async Server Components; colocated unit tests cover what they can, and E2E
  (Playwright, `e2e/`) covers the rest — started 2026-08-21 on Pavel's signal, see `docs/TODO.md`
  §0 for what's covered so far and what still needs a test-auth bypass first.
- Generated Prisma client lives in `src/generated/prisma` (gitignored; `pnpm db:generate` after
  schema changes, runs automatically on install).
- Local dev runs entirely on Docker (`compose.yaml`); container images are pinned, never `:latest`.
- Standalone scripts importing `src/lib/*` need `tsx --conditions=react-server` (otherwise
  `server-only` resolves to its throwing client build).
- **Deploying**: `pnpm build` runs `prisma generate`, **not** `prisma migrate deploy`. Vercel
  deploys on push to `main`, so pending migrations must be applied against the production
  `DIRECT_URL` _before_ merging — otherwise the new code queries columns that do not exist yet and
  every page 500s. Command and ordering in `docs/VERCEL-ENV.md` §Migrations.
- Renames never change a URL: `ShareLink.slug` and `Gallery.eventKey` are frozen at creation
  (docs/TODO.md §6). Tokens resolve, slugs decorate — a stale slug looks wrong, a changed URL
  breaks something already printed or sent.

# g-gallery

Photographer client-delivery gallery (Google-Photos-style UI). **`docs/PLAN.md` is the architecture
authority** — every stack decision there was verified against official docs with sources; read it
before changing architecture, storage, auth, or billing-relevant code.

## Commands

- `pnpm docker:up` — local stack (Postgres :5433, MinIO :9000, imgproxy :8080, Mailpit :8025).
  `cp .env.docker.example .env` on first run; see `docs/DEVELOPMENT.md`.
- `pnpm dev` / `pnpm build` / `pnpm start` — Next.js 16 (Turbopack is default; never add webpack config)
- `pnpm typecheck` · `pnpm lint` · `pnpm test` (Vitest, unit) · `pnpm test:e2e` (Playwright vs prod build)
- `pnpm db:generate` · `pnpm db:migrate` · `pnpm db:seed` · `pnpm db:reset` · `pnpm db:studio` —
  Prisma 7 (CLI reads `DIRECT_URL` via `prisma.config.ts`)
- `pnpm smoke:storage` — presign → PUT → public GET → transform → DELETE against the current `.env`

## Stack

Next.js 16 App Router (TS strict) on Vercel Pro · better-auth 1.7.x (pinned) + Google OAuth ·
Prisma 7 + `@prisma/adapter-pg` → Supabase Postgres (Supavisor `:6543` runtime, `:5432` migrations) ·
Cloudflare R2 (`jurisdiction=eu`) + Image Transformations · Tailwind 4 · Vitest + Playwright.

## Invariants — do not violate

1. **Image bytes and ZIPs never flow through Vercel** (functions, routes, or `/_next/image`).
   All `next/image` usage goes through the custom loader (`src/lib/image-loader.ts`); photo `src`
   is the R2 object key, not a URL. The loader's transform backend is switchable via
   `NEXT_PUBLIC_IMAGE_TRANSFORM` (`cloudflare` | `imgproxy` | `none`) — never bypass it.
2. **Uploads**: browser → R2 presigned PUT only (Vercel has a hard 4.5 MB body limit). Client
   computes CRC32 + strips EXIF GPS before PUT; server records `etag`, flips `Photo.status`.
3. **Auth**: route gating lives in `src/proxy.ts` (Next 16 — `middleware.ts` is deprecated and
   silently ignored). Proxy checks are optimistic only; every Server Action and Route Handler
   re-verifies the session (`auth.api.getSession`) — Server Actions are public POST endpoints.
4. **Next 16 idioms**: `await props.params` / `await searchParams` / `await cookies()` always;
   `revalidateTag(tag, 'max')` (single-arg form is a TS error); parallel route slots need `default.tsx`.
5. **Share links**: raw tokens are never stored — DB keeps `tokenHash` (SHA-256); passwords use
   argon2; expiry/revocation is enforced server-side on every surface (page, presign, beacon, download).
6. **No long-lived connections from Vercel** (SSE/WebSocket) — realtime belongs to Supabase Realtime.
7. **Privacy**: never store viewer IPs; viewer identity is a first-party `anonKey` only;
   share tokens must never reach Vercel Analytics (server-side `track` with `galleryId`, beforeSend scrub).
8. `cacheComponents` stays **off**; gallery/admin routes are dynamic; classic ISR only for public pages.

## Conventions

- Code, comments, commit messages: English. Conversation with the user: Czech.
- Zod-validate every Route Handler input. Colocate unit tests as `*.test.ts(x)` next to source.
- Vitest cannot render async Server Components — cover those with Playwright instead.
- Generated Prisma client lives in `src/generated/prisma` (gitignored; `pnpm db:generate` after
  schema changes, runs automatically on install).
- Local dev runs entirely on Docker (`compose.yaml`); container images are pinned, never `:latest`.
- Standalone scripts importing `src/lib/*` need `tsx --conditions=react-server` (otherwise
  `server-only` resolves to its throwing client build).

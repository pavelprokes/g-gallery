# Vercel environment variables

What to set in **Project → Settings → Environment Variables**, and which of it
matters at build time rather than run time.

Vercel never reads `.env.production.local` — that file is only a local copy to
paste from, and what `pnpm build && pnpm start` uses if you want to run
production mode on your machine. Anything still marked `TODO` there is not set.

The Vercel project for this app gets the domain **`photos.svatebni-fotograf-cechy.cz`**, not the
apex — the apex/`www` already belong to the separate `svatebni-fotograf-cechy-20` project
(marketing site). R2/Image Transformations moved to `cdn.svatebni-fotograf-cechy.cz` to free up
`photos` for the app.

## Build time vs run time

`NEXT_PUBLIC_*` variables are **inlined into the JavaScript bundle during the
build**. Changing one in the dashboard does nothing until you redeploy — the old
value is baked into the shipped code. Everything else is read at run time and
takes effect on the next invocation.

This bites hardest with `NEXT_PUBLIC_PHOTOS_BASE_URL`: get it wrong and every
photo URL in the built bundle points at the wrong host, with no server-side
error to notice.

## Required — the app will not work without these

| Variable                          | Scope     | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                    | runtime   | Supavisor **transaction** pooler, `:6543`, keep `?pgbouncer=true`                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `DIRECT_URL`                      | runtime   | Supavisor **session** pooler, `:5432` — migrations and CLI                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `BETTER_AUTH_SECRET`              | runtime   | `openssl rand -base64 32`                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `BETTER_AUTH_URL`                 | runtime   | `https://photos.svatebni-fotograf-cechy.cz` — **not** the apex, see below                                                                                                                                                                                                                                                                                                                                                                                                         |
| `GOOGLE_CLIENT_ID`                | runtime   | Add the production redirect URI in Google Cloud (below)                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `GOOGLE_CLIENT_SECRET`            | runtime   |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `ADMIN_EMAILS`                    | runtime   | The only thing separating you from clients, who also sign in with Google                                                                                                                                                                                                                                                                                                                                                                                                          |
| `R2_ACCOUNT_ID`                   | runtime   |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `R2_ACCESS_KEY_ID`                | runtime   |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `R2_SECRET_ACCESS_KEY`            | runtime   |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `R2_BUCKET`                       | runtime   | `g-gallery`                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `R2_ENDPOINT`                     | runtime   | `https://<account>.eu.r2.cloudflarestorage.com` — note `.eu.`                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `S3_REGION`                       | runtime   | `auto` — R2 accepts nothing else                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `CRON_SECRET`                     | runtime   | See "Cron" below                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **`NEXT_PUBLIC_PHOTOS_BASE_URL`** | **build** | `https://cdn.svatebni-fotograf-cechy.cz` — the R2/Images host, not the app                                                                                                                                                                                                                                                                                                                                                                                                        |
| **`NEXT_PUBLIC_IMAGE_TRANSFORM`** | **build** | `cloudflare`                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `NEXT_PUBLIC_TAKEDOWN_EMAIL`      | **build** | Optional. Address guests are pointed at to ask for a photo of theirs to be removed (docs/GUEST-GALLERIES.md §10). Unset: the copy points them at the couple instead, who can delete it themselves.                                                                                                                                                                                                                                                                                |
| `NEXT_PUBLIC_CONTACT_EMAIL`       | **build** | Optional. Shown on the dead-link pages as "napiš mi" for someone whose link does not work (`src/components/dead-end.tsx`). Unset: the line is omitted rather than pointing at an address nobody reads.                                                                                                                                                                                                                                                                            |
| `TOKEN_ENCRYPTION_KEY`            | runtime   | Optional but wanted. 32 bytes base64 (`openssl rand -base64 32`) — lets the admin re-display and copy a share or wedding link instead of showing it once (`src/lib/token-cipher.ts`, CLAUDE.md invariant 5). Unset: links still work, they just cannot be shown again. **Rotating it makes every existing `tokenCipher` unreadable** — the links keep working, they only stop being displayable. Never commit it: it is what stands between a database dump and every share link. |
| `NEXT_PUBLIC_SLIDESHOW_SECONDS`   | **build** | Optional. Seconds each photo stays on the party projection; default 6, clamped to 1–60 (`src/lib/slideshow-settings.ts`). The crossfade scales with it.                                                                                                                                                                                                                                                                                                                           |

### Google OAuth redirect URI

better-auth mounts the callback at `/api/auth/callback/<provider>`. In Google
Cloud console the production client needs, exactly:

- Authorized redirect URI: `https://photos.svatebni-fotograf-cechy.cz/api/auth/callback/google`
- Authorized JavaScript origin: `https://photos.svatebni-fotograf-cechy.cz`

Any other shape gives `redirect_uri_mismatch`. The apex domain does **not** work here — it belongs
to the separate `svatebni-fotograf-cechy-20` marketing site. The same client can serve local
development as well — just add `http://localhost:3000/...` alongside.

## Migrations

`pnpm build` is `prisma generate && next build`. **Nothing runs `prisma migrate deploy`**, and
adding it to the build script is worse than it looks: preview deployments share the production
environment variables, so every pull request would migrate the production database.

So the order on every deploy that carries a schema change is: **migrate first, merge second.**
Vercel deploys on push to `main`, and code that reaches production before its columns do makes
every page 500.

```bash
# the URL is only in .env.production.local, which is gitignored
export DIRECT_URL="$(grep '^DIRECT_URL=' .env.production.local | cut -d= -f2- | tr -d '"')"

pnpm exec prisma migrate status   # read-only: what is pending
pnpm exec prisma migrate deploy   # apply
```

Migrating ahead of the deploy is only safe while migrations stay **additive** — new tables, new
nullable columns, new columns with defaults. The running production code ignores what it does not
know about. A migration that drops or narrows a column has to be split across two deploys instead.

## Cron

Setting `CRON_SECRET` is enough. Vercel
[sends it automatically](https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs)
as `Authorization: Bearer <value>` when it invokes a cron path, and every cron
route checks precisely that. Nothing else needs configuring.

Two things Vercel's own documentation warns about, both of which apply here:

- **Cron jobs do not follow redirects.** `src/proxy.ts` only matches
  `/admin/:path*`, so no cron path is ever redirected. Do not widen that matcher
  without re-checking.
- **Delivery is best effort**: a run can be missed, and a run can be delivered
  **twice**. Every job is written to be idempotent so a double delivery is
  harmless — see `src/lib/digest.ts`, which records the window it last sent so a
  repeat invocation does not email the same digest again.

The schedules in `vercel.json` run more than once a day, which requires **Pro**.
Hobby allows one run per day and rejects anything more frequent at deploy time.

## Optional — the feature degrades cleanly if unset

| Variable                            | Scope     | Unset means                                                                                 |
| ----------------------------------- | --------- | ------------------------------------------------------------------------------------------- |
| `ZIP_WORKER_URL`                    | runtime   | Download buttons return a visible 503 (live Worker, not deployed — docs/SETUP.md §9)        |
| `ZIP_SIGNING_SECRET`                | runtime   | Same. Must match the Worker secret byte for byte                                            |
| `ZIP_BUILDER_WORKER_URL`            | runtime   | `/api/cron/zip-build` no-ops; galleries never get a pre-built archive (docs/SETUP.md §10)   |
| `ZIP_BUILD_SIGNING_SECRET`          | runtime   | Same. Must match the builder Worker's secret of the same name                               |
| `ZIP_BUILD_CALLBACK_SECRET`         | runtime   | Same — also gates `/api/internal/zip-callback`, so the builder can't report a status either |
| `IMAGE_SIGNING_SECRET`              | runtime   | Image URLs stay unsigned (today's behaviour); must match the Worker secret of the same name |
| **`NEXT_PUBLIC_SIGNED_IMAGES_URL`** | **build** | Same — the loader never routes through the signing Worker without it                        |
| `VAPID_PUBLIC_KEY`                  | runtime   | Push toggle explains it is unconfigured; digest still sends                                 |
| `VAPID_PRIVATE_KEY`                 | runtime   |                                                                                             |
| `VAPID_SUBJECT`                     | runtime   | `mailto:...`                                                                                |
| `SMTP_URL`                          | runtime   | Digest is logged and skipped rather than failing the cron                                   |
| `MAIL_FROM`                         | runtime   | Falls back to a Resend sandbox sender                                                       |
| `NOTIFY_EMAIL_TO`                   | runtime   |                                                                                             |
| `SUPABASE_URL`                      | runtime   | Keep-alive falls back to a plain Prisma write                                               |
| `SUPABASE_SERVICE_ROLE_KEY`         | runtime   | **Legacy JWT-style key**, not `sb_secret_…` — PostgREST needs a JWT                         |
| **`NEXT_PUBLIC_SUPABASE_URL`**      | **build** | "Someone is viewing now" silently does nothing                                              |
| **`NEXT_PUBLIC_SUPABASE_ANON_KEY`** | **build** | Legacy JWT-style key, same reason                                                           |

Shared Supabase project (`docs/SETUP.md` §6) — the service role only has access to the `g_gallery`
schema, granted explicitly; it cannot read the marketing site's own data in `public`.

`RESEND_API_KEY` is deliberately **not** set: `src/lib/mailer.ts` prefers it when
present, and production mail is meant to go through SES over SMTP
(`docs/SETUP.md` §8).

## Environments

Set everything for **Production**. For **Preview**, either point at the same
services or leave it unset and accept that preview deployments cannot sign in —
what must not happen is a preview build writing to the production database with
a different `BETTER_AUTH_URL`, which silently breaks the OAuth callback.

A **dev/preview deployment behind its own custom domain is still a Preview (or
custom) environment** — attaching a domain does not give it Production's
variables. With no `DATABASE_URL` there, every database-backed page throws at
request time; `src/lib/db.ts` names the missing variable rather than letting pg
fall back to its own `localhost:5432` default, which used to surface as a
baffling `P1001 — Can't reach database server at 127.0.0.1:5432` (an address
this project never uses: local dev is `:5433`, production `:6543`).

`DIRECT_URL` is also needed by the GitHub Actions backup workflow, but as a
repository secret (`BACKUP_DATABASE_URL`), not a Vercel variable —
`docs/SETUP.md` §13.

## Verifying after deploy

```bash
# Cron auth, without waiting for the schedule
curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/keepalive

# The custom loader is live: this must be a real transformed image, not a 404
curl -sI "https://cdn.svatebni-fotograf-cechy.cz/cdn-cgi/image/width=640,quality=82,format=auto/<key>"
```

Then walk `docs/SETUP.md` §11.

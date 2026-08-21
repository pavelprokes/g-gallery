# Phase 0 — infrastructure setup

Everything here is dashboard/CLI work that needs your accounts. Do it in order;
step 2 depends on step 1 (DNS), and step 3's bucket setting is **immutable**.

Domain: `svatebni-fotograf-cechy.cz` (registered at Wedos.cz). The apex/`www` belong to the
`svatebni-fotograf-cechy-20` marketing site — a separate Vercel project already using that domain.
g-gallery cannot also claim the apex, so it lives on **`photos.svatebni-fotograf-cechy.cz`**
instead; R2/Image Transformations moved to **`cdn.svatebni-fotograf-cechy.cz`** to make room.

---

## 1. Cloudflare zone + nameserver delegation

1. Cloudflare dashboard → **Add a site** → `svatebni-fotograf-cechy.cz` → **Free** plan.
2. Cloudflare imports existing DNS records. **Check them against Wedos before continuing** —
   especially `MX` records if mail runs on this domain. A missing MX record after delegation
   means mail stops arriving.
3. Cloudflare shows two nameservers (e.g. `xxx.ns.cloudflare.com`). In the Wedos admin, replace
   the current NS records with those two.
   > Free plan requires **full nameserver delegation** — the partial/CNAME setup is Business-only.
4. Wait for the zone to go **Active** (usually minutes, up to 24 h).

### DNS records after activation

| Name        | Type                | Target                                         | Proxy                      |
| ----------- | ------------------- | ---------------------------------------------- | -------------------------- |
| `@` / `www` | unchanged           | already the marketing site's — leave untouched | unchanged                  |
| `photos`    | as Vercel instructs | Vercel (g-gallery project)                     | **DNS only** (grey cloud)  |
| `cdn`       | CNAME               | set automatically in step 3                    | **Proxied** (orange cloud) |

⚠️ The app subdomain (`photos`) must stay **DNS-only**. Cloudflare-proxying it silently breaks
Vercel Web Analytics unless `/_vercel/insights/*` is explicitly forwarded. Only `cdn` (R2/Image
Transformations) should be proxied.

---

## 2. Vercel project

1. Import the GitHub repo into the **Pro team** (Hobby forbids commercial use).
2. Add the domain `photos.svatebni-fotograf-cechy.cz` (**not** the apex — that belongs to the
   `svatebni-fotograf-cechy-20` project), follow Vercel's DNS instructions, and create that record
   in Cloudflare as **DNS only**.
3. Environment variables: copy every key from `.env.example` (values filled in by the steps below).
4. Settings → **Spend Management**: lower the notification threshold from the $200 default (≈ $5).
5. The cron in `vercel.json` (`0 */8 * * *` → `/api/cron/keepalive`) registers on first deploy.

---

## 3. Cloudflare R2

> **`jurisdiction=eu` cannot be added later.** Getting this wrong means creating a new bucket and
> copying everything. Do it first.

```bash
npx wrangler login
npx wrangler r2 bucket create g-gallery --jurisdiction eu
```

### CORS (required for browser → R2 presigned PUT)

```bash
cat > cors.json <<'EOF'
{
  "rules": [
    {
      "allowed": {
        "origins": ["https://photos.svatebni-fotograf-cechy.cz", "http://localhost:3000"],
        "methods": ["PUT"],
        "headers": ["Content-Type", "Cache-Control"]
      },
      "exposeHeaders": ["ETag"],
      "maxAgeSeconds": 3600
    }
  ]
}
EOF
npx wrangler r2 bucket cors set g-gallery --file cors.json --jurisdiction eu
```

> Wrangler's CORS file format wraps rules in a top-level `rules` array with a nested `allowed`
> object (lowercase field names) — this differs from the dashboard's flat `AllowedOrigins`/
> `AllowedMethods` JSON. `wrangler r2 bucket cors set` rejects the dashboard-style shape with
> "must contain a 'rules' array".

`Content-Type` **and** `Cache-Control` are signed into the presigned URL, so both must be in
`allowed.headers` or uploads fail with 403/CORS. `exposeHeaders: ["ETag"]` is what lets the uploader
confirm the upload.

### Custom domain

Bucket → **Settings → Public access → Custom domains** → add `cdn.svatebni-fotograf-cechy.cz`
(**not** `photos.` — that subdomain is the app itself, on Vercel). Never use the `r2.dev` URL — it
is rate-limited and documented as non-production.

### API token

R2 → **Manage API tokens** → create a token with **Object Read & Write** scoped to this bucket.
Fill in `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`, and:

```
R2_ENDPOINT=https://<account-id>.eu.r2.cloudflarestorage.com
```

Note the `.eu.` — the jurisdiction endpoint differs from the default one.

---

## 4. Cloudflare Image Transformations

1. Dashboard → **Images → Transformations** → select the zone → **Enable**.
2. Leave _accepted sources_ at the default **"allowed origins"**. Never switch to "any origin" —
   that lets strangers transform arbitrary images through your zone and burn the quota.
3. **Subscribe to Images Paid.** On the pure free plan, exceeding 5,000 unique transformations in a
   month makes new variants fail with error 9422 (broken galleries) rather than billing you.
   With the paid plan a heavy month costs ~$0.50–1.50 and normal months are $0.

Verify after the first upload:

```
https://cdn.svatebni-fotograf-cechy.cz/cdn-cgi/image/width=640,quality=82,format=auto/<object-key>
```

---

## 5. Google OAuth

1. Google Cloud Console → new project → **APIs & Services → OAuth consent screen**.
2. User type **External**. Fill app name, support email, developer email.
3. Scopes: **only** `openid`, `email`, `profile`. Nothing sensitive or restricted — that keeps you
   out of the verification review entirely.
4. **Publish to production immediately.** In Testing mode you would have to list every client as a
   test user (100 max) and their consent expires weekly.
5. Skip the logo upload — it triggers optional brand verification for no benefit here.
6. Credentials → **Create OAuth client ID** → Web application:
   - Authorized JavaScript origins: `https://photos.svatebni-fotograf-cechy.cz`,
     `http://localhost:3000`
   - Authorized redirect URIs:
     `https://photos.svatebni-fotograf-cechy.cz/api/auth/callback/google`,
     `http://localhost:3000/api/auth/callback/google`
7. Fill `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

---

## 6. Supabase

> **Decision (2026-08-21):** shared the existing `byhiodbtosmmtuemldqe` project (the
> `svatebni-fotograf-cechy-20` marketing site's booking/orders database) instead of spending the
> **2nd and last free project slot** on a dedicated one. g-gallery is isolated in its own Postgres
> **schema** (`g_gallery`) behind a **least-privilege role** (`g_gallery_app`) that can only touch
> that schema — chosen over a separate project because the noisy-neighbor risk (shared connection
> pool/CPU) was judged acceptable against burning the last free slot. If that trade stops being
> acceptable, moving to a dedicated project later just means: new project, same schema/role setup
> below, restore the last backup (§12) into it.

1. **Create the schema and role** (run once, as the project's `postgres` superuser):
   ```sql
   create schema g_gallery;
   create role g_gallery_app with login password '<generate one>';
   grant usage, create on schema g_gallery to g_gallery_app;
   alter default privileges in schema g_gallery grant all privileges on tables to g_gallery_app;
   alter default privileges in schema g_gallery grant all privileges on sequences to g_gallery_app;
   ```
   Verify isolation before trusting it: `select has_table_privilege('g_gallery_app', 'public.<a
table from the other app>', 'SELECT');` must return `f`.
2. **Connection strings** — Supavisor's pooler username for a custom role is `<role>.<project-ref>`
   (undocumented but confirmed working; the dashboard only shows this for the default `postgres`
   role). Add `?options=-c%20search_path%3Dg_gallery` — Prisma's multiSchema config (below)
   schema-qualifies every query regardless, but raw connections (psql, backup workflow) need it:
   - `DATABASE_URL` — **Transaction** pooler, port `6543`, `g_gallery_app.<project-ref>` user,
     append `&pgbouncer=true`
   - `DIRECT_URL` — **Session** pooler, port `5432`, same user (IPv4, works from GitHub Actions;
     the direct `db.<ref>.supabase.co` host is IPv6-only on the free tier)
3. **`prisma/schema.prisma`** needs `schemas = ["g_gallery"]` on the `datasource` block and
   `@@schema("g_gallery")` on every model/enum — already done in this repo. No `previewFeatures`
   flag needed; multiSchema is GA in Prisma 7.
4. **Migrations**: `prisma migrate deploy`'s "is the database empty" check (`P3005`) scans the
   _whole database_, not just the declared schema — it will always fail here because `public`
   already has the other app's tables, even against a completely empty `g_gallery`. Baseline
   instead of fighting it: apply each `prisma/migrations/*/migration.sql` directly
   (`psql "$DIRECT_URL" -f migration.sql`, in order — the SQL is schema-agnostic, so it lands in
   whatever `search_path` the connection string sets), then tell Prisma they're already done:
   ```bash
   for dir in prisma/migrations/*/; do
     npx prisma migrate resolve --applied "$(basename "$dir")"
   done
   ```
   After baselining, `prisma migrate deploy` reports `No pending migrations to apply` and works
   normally for anything added later — this is a one-time cost of sharing a database, not a
   recurring one.
5. **Expose the schema to PostgREST** (Project Settings → Data API → Exposed schemas, or via the
   Management API) — add `g_gallery` alongside whatever is already there (`public,graphql_public`
   typically); **do not remove** the existing entries, that's the other app's API access.
6. **Grant `service_role` access within `g_gallery`** (PostgREST's own Postgres role needs this
   independently of `g_gallery_app` — Supabase auto-grants it on `public` but not on custom
   schemas), run as `g_gallery_app` since it owns the tables:
   ```sql
   grant usage on schema g_gallery to service_role;
   grant select, insert, update, delete on all tables in schema g_gallery to service_role;
   alter default privileges in schema g_gallery grant select, insert, update, delete on tables to service_role;
   ```
   Deliberately **not** granted to `anon`/`authenticated` — the client never queries Postgres
   tables directly through PostgREST, only through Next.js routes (Prisma) and Realtime channels.
7. **`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`** — Project
   Settings → API (or `supabase projects api-keys --project-ref <ref>`). Use the **legacy JWT-style**
   keys (`anon`/`service_role`), not the newer `sb_publishable_…`/`sb_secret_…` ones — the keepalive
   cron sends `SUPABASE_SERVICE_ROLE_KEY` as a raw `Authorization: Bearer` JWT to PostgREST, which
   only understands the JWT format.
8. `src/app/api/cron/keepalive/route.ts`'s PostgREST call sets `Content-Profile: g_gallery` — without
   it, PostgREST targets its default schema (`public`) and the write silently 404s against the
   wrong app's data instead of `g_gallery."Keepalive"`.
9. Seed the keep-alive row (the cron PATCHes it, it must exist) — run as `g_gallery_app`, since the
   superuser role doesn't own the table and can't write to it:
   ```sql
   insert into "Keepalive" (id) values (1) on conflict do nothing;
   alter table "Keepalive" enable row level security;
   ```
   No anon policy — only the service role touches it.

---

## 7. Secrets

The full list of what to paste into the Vercel dashboard — and which variables
are needed at **build** time rather than run time — is **`docs/VERCEL-ENV.md`**.

```bash
openssl rand -base64 32   # BETTER_AUTH_SECRET
openssl rand -base64 32   # CRON_SECRET
```

`ADMIN_EMAILS` decides who gets the admin role on first sign-in. Clients sign in with Google too,
so this list is the only thing separating you from them.

### GitHub Actions secrets (for the backup workflow)

`Settings → Secrets and variables → Actions`:

| Secret                 | Value                                                       |
| ---------------------- | ----------------------------------------------------------- |
| `BACKUP_DATABASE_URL`  | the **session** pooler URL (`:5432`) — same as `DIRECT_URL` |
| `R2_ACCESS_KEY_ID`     | R2 API token key id                                         |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret                                         |
| `R2_ENDPOINT`          | `https://<account-id>.eu.r2.cloudflarestorage.com`          |
| `R2_BUCKET`            | `g-gallery`                                                 |

---

## 8. Email — AWS SES over SMTP

`src/lib/mailer.ts` picks a backend by which env var is set: `RESEND_API_KEY` wins if present,
otherwise `SMTP_URL`, otherwise sending is skipped (logged, not fatal). Production uses AWS SES
over SMTP — **`RESEND_API_KEY` stays unset in Vercel** so the SMTP branch is the one that runs.
The verified sending domain (`svatebni-fotograf-cechy.cz`) is shared with the
`svatebni-fotograf-cechy-2.0` project's AWS account.

1. AWS Console → **SES** → confirm the region where the domain identity shows **Verified** under
   **Identities**, and that the account is out of the sending **sandbox** (Account dashboard →
   Sending statistics) — sandboxed accounts can only mail verified recipient addresses.
2. **SES → SMTP settings → Create SMTP credentials** — creates an IAM user scoped to
   `AmazonSesSendingAccess` and returns an **SMTP username/password** (different from a raw AWS
   access key/secret). Reuse existing credentials rather than minting new ones if you want to keep
   everything under one shared IAM user with the 2.0 project.
3. Build the connection string — **percent-encode** the password (it sits inside a URL; `+`
   becomes `%2B`, `/` becomes `%2F`):
   ```
   SMTP_URL=smtps://<smtp-user>:<url-encoded-smtp-pass>@email-smtp.<region>.amazonaws.com:465
   MAIL_FROM="g-gallery <pavel@svatebni-fotograf-cechy.cz>"
   ```
4. Verify before relying on it:
   ```bash
   node -e "require('nodemailer').createTransport(process.env.SMTP_URL).verify().then(console.log).catch(console.error)"
   ```

SES bills à la carte at **$0.10 per 1,000 emails** ([pricing](https://aws.amazon.com/ses/pricing/)) —
no free tier outside EC2-origin sending. At the digest's ~30 emails/month this is a fraction of a
cent, so it doesn't move the cost table, it just trades Resend's free-tier headroom for one shared
AWS bill across both projects.

---

## 9. ZIP download Worker (Workers Paid, $5/mo)

The archive is streamed by a Cloudflare Worker, never by Vercel — a function there is billed for
data transfer and for provisioned memory across the whole download, and dies at `maxDuration` long
before 8 GB finishes. A Worker holding an HTTP response open has **no wall-clock limit** and reads
R2 at zero egress (docs/PLAN.md §7).

**Workers Paid is required.** Verified against the
[limits page](https://developers.cloudflare.com/workers/platform/limits/): Free allows **10 ms CPU**
per request, Paid 30 s (raisable to 5 min). Streaming is mostly I/O, but every chunk enqueued costs
CPU and an 8 GB archive is far past 10 ms.

```bash
cd worker
pnpm install --ignore-workspace          # its own install: Workers types clash with the app's DOM lib
npx wrangler secret put ZIP_SIGNING_SECRET   # must match the app's .env byte for byte
npx wrangler secret put APP_ORIGIN           # https://photos.svatebni-fotograf-cechy.cz
npx wrangler deploy
```

Then set `ZIP_WORKER_URL` in Vercel to the deployed Worker URL. Until both `ZIP_WORKER_URL` and
`ZIP_SIGNING_SECRET` are set, the download buttons return a visible 503 rather than failing silently.

Local development: `cp worker/.dev.vars.example worker/.dev.vars`, paste the app's secret, then
`npx wrangler dev`. The local R2 binding is a simulation, so seed it first:
`npx wrangler r2 object put "g-gallery/<key>" --file <file> --local`.

---

## 10. Post-setup verification

- [ ] `https://photos.svatebni-fotograf-cechy.cz` serves the app; `cdn.` subdomain returns R2 objects
- [ ] Sign in with Google → `/admin` loads (role = admin)
- [ ] Create a gallery, upload 2–3 photos → they reach `CONFIRMED`
- [ ] A `/cdn-cgi/image/...` URL returns a resized AVIF/WebP
- [ ] Publish, create a share link, open it in a private window → grid + lightbox work
- [ ] Admin shows non-zero views / unique viewers after that visit
- [ ] `curl -H "Authorization: Bearer $CRON_SECRET" .../api/cron/keepalive` → `{"ok":true}`
- [ ] Vercel Analytics dashboard shows `/g/[token]` — **never** a real token
- [ ] Daily digest / owner notification email actually lands (check the SES sending domain's
      reputation dashboard too, since it's shared with the 2.0 project)
- [ ] "Stáhnout vše (ZIP)" downloads an archive that opens in Finder/Explorer, with a real
      progress bar (a missing `Content-Length` means the Worker fell back to chunked encoding)
- [ ] Select a few photos → "Stáhnout N fotek" produces an archive with exactly those photos

---

## 11. R2 lifecycle rule (Infrequent Access)

`/api/cron/lifecycle` records which originals are cold (`Photo.storageTier`), but R2 has no API to
change an existing object's storage class — the transition itself is a **bucket lifecycle rule**,
set once in the Cloudflare dashboard:

> R2 → g-gallery → Settings → Object lifecycle rules → _Add rule_
> Prefix `galleries/`, action **Transition to Infrequent Access**, after **180 days**.

Keep the 180 days in step with `IA_AFTER_MONTHS` (default 6). The job's `?dryRun=1` reports what it
would mark without writing. Nothing is ever deleted — a wedding gallery is irreplaceable and the
saving would be cents.

---

## 12. Database backup & restore

`.github/workflows/db-backup.yml` runs daily at 03:20 UTC: `pg_dump --schema=g_gallery` through the
session pooler, restore-verified into a throwaway PostgreSQL 17 container, then stored in R2 under
`backups/` with 30-day pruning. The Supabase free tier takes **no** backups, so this is the only
copy that exists.

The restore is part of the job on purpose — a dump nobody has ever restored is not a backup. The
verification asserts the tables the app cannot start without and prints the row counts, so an
empty-but-valid dump fails loudly instead of passing.

### Restoring

```bash
# 1. Fetch the dump you want (they are named backup-<ISO8601>.dump)
aws s3 ls s3://g-gallery/backups/ --endpoint-url "$R2_ENDPOINT"
aws s3 cp s3://g-gallery/backups/backup-<stamp>.dump . --endpoint-url "$R2_ENDPOINT"

# 2. Prepare the target. The dump carries `CREATE SCHEMA g_gallery`, so a
#    schema left over from a previous restore attempt must go first — a fresh
#    Supabase project or a first restore never has one, so this is a
#    just-in-case, not a step that always does something.
psql "$DIRECT_URL" -c 'drop schema if exists g_gallery cascade;'

# 3. Restore
pg_restore --dbname="$DIRECT_URL" --no-owner --no-privileges --exit-on-error backup-<stamp>.dump
```

If restoring into a fresh Supabase project rather than back into the shared one, redo the
`g_gallery_app` role and grants from `docs/SETUP.md` §6 first — the dump's `--no-owner
--no-privileges` flags mean it does not recreate them.

Two things the backup deliberately does **not** cover:

- **Photo bytes.** Those live in R2 and are not dumped; R2 durability is the protection there. A DB
  restore without the bucket gives you rows pointing at objects that still exist — which is the
  normal disaster shape, since losing the database and the bucket are independent events.
- **Everything outside `g_gallery`** — the `svatebni-fotograf-cechy-20` marketing site's own data in
  `public`, and Supabase-owned schemas (`auth`, `storage`, `realtime`). Not this project's data to
  back up or restore.

A backup that stops running is worse than none, because you stop worrying about it. GitHub emails
the repo owner when a scheduled workflow fails — do not filter those.

---

## Deferred to later phases

- **Workers Paid ($5/mo)** — only when the ZIP download ships (v2).
- **Uptime monitor** on `/api/cron/keepalive` — a silent cron failure starts the 7-day pause clock,
  and a paused DB takes sign-in down with it.
- **Signed image URLs** (docs/PLAN.md §4.1 "v2 hardening") — code is in place
  (`src/lib/image-signing.ts`, the `GET /img/{key}` route in `worker/src/index.ts`) and inert until
  deployed: add a route on the ZIP Worker (or a sibling one) for `/img/*`, set `IMAGE_SIGNING_SECRET`
  and `PHOTOS_ZONE_HOST` on the Worker (`worker/.dev.vars.example`) and `IMAGE_SIGNING_SECRET` +
  `NEXT_PUBLIC_SIGNED_IMAGES_URL` in Vercel (`docs/VERCEL-ENV.md`). Until then every image URL stays
  unsigned, today's behaviour — nothing breaks by deferring this.

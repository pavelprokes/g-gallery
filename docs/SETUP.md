# Phase 0 — infrastructure setup

Everything here is dashboard/CLI work that needs your accounts. Do it in order;
step 2 depends on step 1 (DNS), and step 3's bucket setting is **immutable**.

Domain: `svatebni-fotograf-cechy.cz` (registered at Vedos.cz).

---

## 1. Cloudflare zone + nameserver delegation

1. Cloudflare dashboard → **Add a site** → `svatebni-fotograf-cechy.cz` → **Free** plan.
2. Cloudflare imports existing DNS records. **Check them against Vedos before continuing** —
   especially `MX` records if mail runs on this domain. A missing MX record after delegation
   means mail stops arriving.
3. Cloudflare shows two nameservers (e.g. `xxx.ns.cloudflare.com`). In the Vedos admin, replace
   the current NS records with those two.
   > Free plan requires **full nameserver delegation** — the partial/CNAME setup is Business-only.
4. Wait for the zone to go **Active** (usually minutes, up to 24 h).

### DNS records after activation

| Name        | Type                | Target                      | Proxy                      |
| ----------- | ------------------- | --------------------------- | -------------------------- |
| `@` / `www` | as Vercel instructs | Vercel                      | **DNS only** (grey cloud)  |
| `photos`    | CNAME               | set automatically in step 3 | **Proxied** (orange cloud) |

⚠️ The app domain must stay **DNS-only**. Cloudflare-proxying it silently breaks Vercel Web
Analytics unless `/_vercel/insights/*` is explicitly forwarded.

---

## 2. Vercel project

1. Import the GitHub repo into the **Pro team** (Hobby forbids commercial use).
2. Add the domain `svatebni-fotograf-cechy.cz`, follow Vercel's DNS instructions, and create those
   records in Cloudflare as **DNS only**.
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
        "origins": ["https://svatebni-fotograf-cechy.cz", "http://localhost:3000"],
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

Bucket → **Settings → Public access → Custom domains** → add `photos.svatebni-fotograf-cechy.cz`.
Never use the `r2.dev` URL — it is rate-limited and documented as non-production.

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
https://photos.svatebni-fotograf-cechy.cz/cdn-cgi/image/width=640,quality=82,format=auto/<object-key>
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
   - Authorized JavaScript origins: `https://svatebni-fotograf-cechy.cz`, `http://localhost:3000`
   - Authorized redirect URIs:
     `https://svatebni-fotograf-cechy.cz/api/auth/callback/google`,
     `http://localhost:3000/api/auth/callback/google`
7. Fill `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

---

## 6. Supabase

> This uses your **2nd and last** free project slot. No headroom remains for a staging database.

1. New project, region **eu-central** (Frankfurt) — closest to CZ and matches the R2 EU jurisdiction.
2. **Project Settings → Database → Connection string**, read the actual pooler hostname from the
   dashboard (do not assume `aws-0` vs `aws-1`):
   - `DATABASE_URL` — **Transaction** pooler, port `6543`, append `?pgbouncer=true`
   - `DIRECT_URL` — **Session** pooler, port `5432` (IPv4, works from GitHub Actions; the direct
     `db.<ref>.supabase.co` host is IPv6-only on the free tier)
3. **Project Settings → API**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server-only!), and the
   anon/publishable key for `NEXT_PUBLIC_SUPABASE_ANON_KEY` (needed in Phase 3 for Realtime).
4. Run migrations:
   ```bash
   pnpm db:migrate
   ```
5. Seed the keep-alive row (the cron PATCHes it, it must exist):
   ```sql
   insert into "Keepalive" (id) values (1) on conflict do nothing;
   alter table "Keepalive" enable row level security;
   ```
   No anon policy — only the service role touches it.

---

## 7. Secrets

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

## 8. Post-setup verification

- [ ] `https://svatebni-fotograf-cechy.cz` serves the app; `photos.` subdomain returns R2 objects
- [ ] Sign in with Google → `/admin` loads (role = admin)
- [ ] Create a gallery, upload 2–3 photos → they reach `CONFIRMED`
- [ ] A `/cdn-cgi/image/...` URL returns a resized AVIF/WebP
- [ ] Publish, create a share link, open it in a private window → grid + lightbox work
- [ ] Admin shows non-zero views / unique viewers after that visit
- [ ] `curl -H "Authorization: Bearer $CRON_SECRET" .../api/cron/keepalive` → `{"ok":true}`
- [ ] Vercel Analytics dashboard shows `/g/[token]` — **never** a real token

---

## 9. R2 lifecycle rule (Infrequent Access)

`/api/cron/lifecycle` records which originals are cold (`Photo.storageTier`), but R2 has no API to
change an existing object's storage class — the transition itself is a **bucket lifecycle rule**,
set once in the Cloudflare dashboard:

> R2 → g-gallery → Settings → Object lifecycle rules → _Add rule_
> Prefix `galleries/`, action **Transition to Infrequent Access**, after **180 days**.

Keep the 180 days in step with `IA_AFTER_MONTHS` (default 6). The job's `?dryRun=1` reports what it
would mark without writing. Nothing is ever deleted — a wedding gallery is irreplaceable and the
saving would be cents.

---

## 10. Database backup & restore

`.github/workflows/db-backup.yml` runs daily at 03:20 UTC: `pg_dump --schema=public` through the
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

# 2. Prepare the target. The dump carries `CREATE SCHEMA public`, so the target
#    must not already have one — this step is mandatory, not tidiness.
psql "$DIRECT_URL" -c 'drop schema public cascade;'

# 3. Restore
pg_restore --dbname="$DIRECT_URL" --no-owner --no-privileges --exit-on-error backup-<stamp>.dump
```

Two things the backup deliberately does **not** cover:

- **Photo bytes.** Those live in R2 and are not dumped; R2 durability is the protection there. A DB
  restore without the bucket gives you rows pointing at objects that still exist — which is the
  normal disaster shape, since losing the database and the bucket are independent events.
- **Supabase-owned schemas** (`auth`, `storage`, `realtime`). We do not use them and could not
  restore them anyway; the app's identity data lives in `public` via better-auth.

A backup that stops running is worse than none, because you stop worrying about it. GitHub emails
the repo owner when a scheduled workflow fails — do not filter those.

---

## Deferred to later phases

- **Workers Paid ($5/mo)** — only when the ZIP download ships (v2).
- **Uptime monitor** on `/api/cron/keepalive` — a silent cron failure starts the 7-day pause clock,
  and a paused DB takes sign-in down with it.

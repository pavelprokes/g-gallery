# Local development

The whole stack runs in Docker — no cloud account, no Supabase project, no
Cloudflare zone. Each container stands in for exactly one production
dependency, so the upload → store → transform → deliver path you exercise
locally is the same code path that runs in production.

| Production               | Local container | Host port | Why it substitutes cleanly                |
| ------------------------ | --------------- | --------- | ----------------------------------------- |
| Supabase Postgres        | `postgres`      | **5433**  | Same major version (17)                   |
| Cloudflare R2            | `minio`         | 9000      | S3-compatible: identical SigV4 presigning |
| CF Image Transformations | `imgproxy`      | 8080      | Same Accept-header format negotiation     |
| AWS SES (SMTP)           | `mailpit`       | 1025      | Catches all outgoing mail                 |

Consoles: MinIO <http://localhost:9001> (`gallerydev` / `gallerydev`) ·
Mailpit inbox <http://localhost:8025>.

## First run

```bash
cp .env.docker.example .env   # every value already points at a container
pnpm install
pnpm docker:up                # waits until all services report healthy
pnpm db:migrate               # applies prisma/migrations
pnpm db:seed                  # keepalive singleton row
pnpm dev
```

Google OAuth is the one thing Docker cannot fake — sign-in needs real
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` with `http://localhost:3000` as an
authorized origin (`docs/SETUP.md` §5). Everything else works offline.

## Daily commands

```bash
pnpm docker:up        # start (idempotent)
pnpm docker:down      # stop, keep data
pnpm docker:reset     # destroy volumes and start clean
pnpm docker:logs      # follow all services
pnpm db:migrate       # create/apply a migration after editing schema.prisma
pnpm db:reset         # drop, re-apply every migration, re-seed
pnpm db:studio        # browse the data
pnpm smoke:storage    # presign -> PUT -> public GET -> transform -> DELETE
```

`pnpm smoke:storage` runs against whatever `.env` is loaded, so it is also the
fastest way to verify a real R2 bucket and Cloudflare zone after Phase 0.

## Things that differ from production, on purpose

- **Postgres on 5433, and no pooler.** Port 5432 is usually taken by another
  local Postgres. `DATABASE_URL` and `DIRECT_URL` are the same connection
  locally; in production they are the Supavisor transaction (`:6543`) and
  session (`:5432`) poolers respectively.
- **Public-read bucket.** `minio-init` sets an anonymous download policy so the
  gallery can load images directly, mirroring the R2 custom domain. Production
  R2 uses a locked-down CORS policy (`docs/SETUP.md` §3).
- **Unsigned imgproxy URLs.** `NEXT_PUBLIC_IMAGE_TRANSFORM=imgproxy` switches
  the `next/image` loader to `/insecure/rs:fit:.../plain/{key}`; production
  uses `cloudflare` and builds `/cdn-cgi/image/...`. Both negotiate AVIF/WebP
  from the `Accept` header. Set `none` to bypass transforms entirely.
- **`S3_REGION`.** R2 only accepts `auto`; MinIO signs against a real region
  name (`us-east-1`). Same presigning code, different constant.

## Gotchas

- Container images are **pinned**, not `:latest`. imgproxy silently renamed
  `IMGPROXY_ENABLE_WEBP_DETECTION` to `IMGPROXY_AUTO_WEBP`; the old name is
  ignored without a warning, so a floating tag would quietly stop negotiating
  formats. Bump versions deliberately.
- Scripts that import `src/lib/*` server modules need
  `tsx --conditions=react-server`, otherwise `server-only` resolves to its
  client build and throws.

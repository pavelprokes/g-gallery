# MCP server for Claude

Adopted 2026-10-25. The authority for `/api/mcp`, the "Connect Claude" OAuth flow
(`/oauth/authorize`, `/api/oauth/*`, `/.well-known/oauth-*`), `src/lib/mcp/*` and the shared admin
operations in `src/lib/gallery-admin.ts`.

Claude (claude.ai, Claude Desktop, Cowork, Claude Code) works with the photographer's galleries
through one MCP endpoint, as the photographer: the same Google account and the same `admin` role as
the admin UI. Nobody else can connect — a client who signs in with Google has role `user` and is
refused at consent and at every request.

```
https://photos.svatebni-fotograf-cechy.cz/api/mcp
```

## Connecting

- **claude.ai / Desktop / Cowork:** Settings → Connectors → Add custom connector → the URL above
  (no client ID or secret) → Connect → sign in with Google → **Povolit přístup**.
- **Claude Code:** `claude mcp add --transport http g-gallery https://photos.svatebni-fotograf-cechy.cz/api/mcp`,
  then `/mcp` → g-gallery → Authenticate.

## Protocol

Ported from the MCP server of the Vzdělání budoucnosti admin, where it was verified against the
official SDK clients (v1 legacy, v2 modern) and Claude:

- **Streamable HTTP, stateless.** POST → one `application/json` answer; GET/DELETE → 405;
  notifications and responses → 202. No SSE, no sessions — nothing held open on Vercel
  (CLAUDE.md invariant #6). No batches, body ≤ 2 MB, `Cache-Control: no-store`.
- **Dual-era.** A request whose `params._meta` carries `io.modelcontextprotocol/protocolVersion` is
  MCP **2026-07-28** (`server/discover`, `MCP-Protocol-Version`/`Mcp-Method`/`Mcp-Name` headers
  must agree with the body → else 400 `-32020`; unknown version → 400 `-32022`; `resultType`,
  `ttlMs`, `cacheScope`). Anything else is the `initialize` protocol of **2025-11-25 / 2025-06-18 /
  2025-03-26**.
- **A thin JSON-RPC layer, not `@modelcontextprotocol/sdk`.** We need four methods; the SDK would
  add express/hono and a second protocol implementation to keep in step. No new dependency.
- **Tools are Zod schemas** (`src/lib/mcp/tool.ts`): `z.toJSONSchema` gives the client its
  `inputSchema` and the same schema validates the call, with Czech messages (`z.locales.cs`), so
  the advertised contract and the check cannot drift. A failure the model can act on is an
  `isError` result with a Czech message; a crash is logged, never shown.
- **Origin check** against DNS rebinding: no `Origin`, `https://claude.ai`/`claude.com`, localhost,
  or this site.
- Results are JSON text without indentation (a model reads it) plus the same value as
  `structuredContent`. Every list pages so one answer stays under ~35 k characters: measured in
  production, ~36 k reached the model and ~56 k was cut off into a file. Most of a row is CDN
  addresses, so the page size follows how many each row carries.
- Every `tools/call` logs one line `{"event":"mcp.tool_call","email",…,"tool","ok","durationMs"}`.

## Sign-in (OAuth 2.1)

The app is its own authorization server for this one resource; sign-in itself is the admin's
better-auth + Google.

- `401` from `/api/mcp` carries `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/api/mcp", scope="mcp"`.
  `/.well-known/oauth-protected-resource[/api/mcp]` (RFC 9728) and
  `/.well-known/oauth-authorization-server` (RFC 8414) are App Router routes; `src/proxy.ts` only
  matches `/admin`, so nothing gates them.
- **Clients:** Client ID Metadata Documents only (MCP 2025-11-25), and only the two in
  `TRUSTED_CLIENTS` (`src/lib/mcp/oauth/config.ts`): claude.ai/Desktop/Cowork
  (`https://claude.ai/oauth/mcp-oauth-client-metadata` → only `https://claude.ai|claude.com/api/mcp/auth_callback`)
  and Claude Code (`…/claude-code-client-metadata` → only loopback, any port). Nothing else is ever
  fetched, so there is no SSRF surface; a document listing another return address does not make it
  allowed. If Anthropic moves a document, connecting fails with "Neznámý klient" and the list gets
  the new URL. No dynamic client registration.
- **`/oauth/authorize`** — the consent page. Signed out → `/sign-in?next=…` and back; signed in
  without the admin role → refused. It shows the app, its host, the account, what it may do and
  where it returns (with a warning for localhost). PKCE S256 is required, `resource` must be this
  server, the answer carries `iss` (RFC 9207). Errors about the client or return address are shown
  on the page, never redirected (no open redirect). The decision is a JSON POST to
  `/api/oauth/authorize`, which re-checks the session, the role and its own `Origin`.
- **`/api/oauth/token`** — `authorization_code` and `refresh_token`, form-encoded, public client.
  Code: 2 minutes, once — a second use revokes the whole grant. Access token: 1 hour. Refresh token:
  30 days from last use, never past 90 days from consent, rotated on every use; presenting a rotated
  one revokes the grant (both holders lose it). Every exchange re-checks the admin role and revokes
  the grant if it is gone.
- **Storage:** `McpGrant` — SHA-256 hashes only (`ggc_…`, `gga_…`, `ggr_…` never stored), bound to
  `resource = <origin>/api/mcp`. In production the origin is pinned to `SITE_ORIGIN`, so a forged
  `Host` cannot mint or accept tokens for another one. Every MCP request re-reads the user's role and
  ban. `lastUsedAt` is updated at most every 5 minutes.
- **Revoking:** taking the `admin` role away (or banning) stops every connection at once. One grant:
  `UPDATE g_gallery."McpGrant" SET "revokedAt" = now() WHERE id = '…';`. A page listing connections
  in the admin is the obvious next step.

### Development token

`Authorization: Bearer $MCP_DEV_TOKEN` acts as `MCP_DEV_EMAIL` (still re-checked for the admin
role), for local work, E2E and previews without OAuth. At least 32 characters, compared in constant
time, **ignored whenever `VERCEL_ENV=production`**. A preview runs over production data, so set it
on Preview only if you mean to use it there.

```bash
claude mcp add --transport http g-gallery-local http://localhost:3000/api/mcp \
  --header "Authorization: Bearer $MCP_DEV_TOKEN"
```

### Service token

For a client that cannot do the browser sign-in — an agent on the photographer's own server
(Paperclip on the NAS, a cron job). One long-lived bearer token acting as `MCP_SERVICE_EMAIL`
(still re-checked for the admin role on every request), **valid in production**. Only its SHA-256
is stored, in `MCP_SERVICE_TOKEN_SHA256`; the token itself (≥ 40 characters) lives only on that
server. Compared in constant time.

```bash
TOKEN="ggs_$(openssl rand -base64 36 | tr '+/' '-_' | tr -d '=')"   # keep it on the server only
printf %s "$TOKEN" | shasum -a 256 | cut -d' ' -f1                  # → MCP_SERVICE_TOKEN_SHA256 on Vercel
```

Then any MCP client that can send a header:
`Authorization: Bearer $TOKEN` against `https://photos.svatebni-fotograf-cechy.cz/api/mcp`, e.g.
`claude mcp add --transport http g-gallery https://photos.svatebni-fotograf-cechy.cz/api/mcp --header "Authorization: Bearer $TOKEN"`.
Revoking: remove or change the variable and redeploy. It does not expire on its own — treat it
like a password.

## Tools

Read (`readOnlyHint`):

| Tool               | What                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `overview`         | Galleries by status, weddings, photos/videos, storage, 14-day visits, open corrections, prints                                                    |
| `galleries_list`   | Filter by status, wedding, title, trash; cover thumb, guest link, admin link                                                                      |
| `gallery_get`      | Everything about one gallery: share links (URL, password, expiry, permissions, PIN), chapters, counts, archive                                    |
| `gallery_stats`    | Visits and viewers (all time + per day), downloads, favourites, reactions, prints by viewer, guest uploads, corrections, promo clicks, top photos |
| `weddings_list`    | Weddings with cover, guest URL                                                                                                                    |
| `wedding_get`      | Cards in page order, and whether a guest actually sees each (`isCardVisible`)                                                                     |
| `photos_list`      | Photos in the guests' order (`photoOrderBy`), filters; ≤ 40 full rows or ≤ 60 `compact` ones a page                                               |
| `photo_get`        | One photo or video in full: metadata, Lightroom marks, faces/people, engagement, corrections, full-quality URLs                                   |
| `activity_recent`  | What guests did lately (no view heartbeats)                                                                                                       |
| `corrections_list` | The couple's corrections                                                                                                                          |
| `print_order_get`  | Whole print list, and the 15-minute download links 40 a page                                                                                      |

Write — create or set, all through `src/lib/gallery-admin.ts`, the same code the admin's Server
Actions call: `gallery_create` (draft, or published inside a wedding with its card link),
`gallery_update`, `gallery_publish`, `gallery_unpublish` (`destructiveHint`: every link stops),
`gallery_set_cover`, `share_link_create`, `share_link_set_permissions`, `wedding_create`,
`wedding_update`, `wedding_add_gallery`, `wedding_set_gallery_listed`, `correction_set_resolved`.

### Photo addresses

Results carry addresses, never bytes (CLAUDE.md invariant #1) — `src/lib/mcp/media-urls.ts`
builds them exactly as the image loader does, so each is a variant the gallery already uses, not a
new billable transformation:

- `thumbUrl` — the browser-made thumbnail straight from the bucket, or the 384 px variant;
- `previewUrl` — the lightbox's 1920 px variant;
- `originalUrl` — the stored object on the public CDN host (`NEXT_PUBLIC_PHOTOS_BASE_URL`), full
  quality; on a video row that is the poster, and `videoUrl` is the MP4;
- `downloadUrl` (`photo_get`, `print_order_get`) — a presigned R2 GET that saves under the original
  file name, valid 15 minutes.

Showing a photo _inside_ the conversation (MCP `image` content) would mean fetching its bytes in a
Vercel function — that is the invariant, so it is deliberately not done.

## What it cannot do

Delete anything (photos, galleries, weddings), revoke a link, move to trash, or upload. Deleting and
revoking are one-way for guests who already hold a link and stay a deliberate click in the admin.
Uploading needs the browser: CRC32, EXIF GPS stripping and the presigned PUT (invariant #2).

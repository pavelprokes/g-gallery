# Instagram's own music for reels — the Audio API

**Built 2026-10-28.** The authority for `src/lib/instagram/*`, `InstagramConnection` and
`/api/instagram/*`. Read docs/REELS.md first: this adds one more source of music to its reels
page.

## 1. Decisions (Pavel, 2026-10-28)

| Question             | Decision                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| What it is for       | Choosing a song from **Instagram's own music library** (Meta's Audio API) for a reel: its beat cuts the photos, its sound goes into the file — or not, as Pavel chooses. |
| Publishing           | **None.** "Nechci to nahrávat na mé sítě odsud." The result is an MP4 with sound or without, downloaded; Pavel posts it himself.                                         |
| Priority             | YouTube sound (docs/REELS.md §2, listening to a tab) and this API.                                                                                                       |
| Where the music goes | Into the photographer's browser only (IndexedDB, like every reels track); never to our storage.                                                                          |

Publishing through Meta's Content Publishing API was planned and built the same day, then
removed at Pavel's word; the plan is in this file's git history (`docs/INSTAGRAM-PUBLISH.md`).

## 2. What is known, and from where

Meta's own developer pages could not be opened from the build session (developers.facebook.com
is outside its network); they were read through search results and through code others wrote
against them. **Rows marked "single" or "unverified" are to be re-read on Meta's page.**

| #   | Fact                                                                                                                                                                                                                                                                                                                                       | Sources                                                                                                                                          | Confidence                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| F1  | The Audio API exists only on the **Instagram API with Facebook Login** (a professional Instagram account linked to a Facebook Page), not with Instagram Login.                                                                                                                                                                             | post-for-me #273/#368/#369, ayrshare, bundle.social                                                                                              | confirmed                                 |
| F2  | Facebook Login permissions on that path: `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`; `business_management` too when the Page sits in a business portfolio.                                                                                                                                 | Meta Instagram Platform overview (excerpts), getphyllo, tryadeli                                                                                 | confirmed; which of them search needs: U6 |
| F3  | An app that serves only its owner's own account needs **Standard Access — no App Review**, for people with a role on the app. Development mode is enough: nothing is published, so Live mode's visibility rule does not matter.                                                                                                            | Meta overview ("Standard Access is all your app needs"), blotato, cobrasmash #39                                                                 | confirmed                                 |
| F4  | Sign-in: `https://www.facebook.com/{v}/dialog/oauth` with `client_id`, `redirect_uri`, `state`, `response_type=code` and `scope` (or `config_id` for a Facebook Login for Business configuration); the code is exchanged at `GET /oauth/access_token` with the app secret, server-side.                                                    | Meta "Manually Build a Login Flow" (excerpts), thecodebarbarian, singhamandeep (config_id)                                                       | confirmed                                 |
| F5  | Short-lived user token → `fb_exchange_token` → ~60-day user token → `GET /me/accounts?fields=id,name,access_token,instagram_business_account` → Page tokens without an expiry (invalidated by a password change or a lost Page role).                                                                                                      | Meta "Long-Lived Access Tokens" and IG get-started (excerpts), bundle.social, agoras                                                             | confirmed                                 |
| F6  | Graph API **v26.0** is current (2026-07-29).                                                                                                                                                                                                                                                                                               | Meta version table and Graph API home (excerpts)                                                                                                 | confirmed                                 |
| F7  | Music search: `GET /ig_audio?user_id={ig-user-id}&audio_type=music\|original_sound[&search_query=…]` (no query → trending). Each item: `audio_id`, `title`, `display_artist`, `duration_in_ms`, `download_url` (may be null; expires after ~1.5 days), `cover_artwork_thumbnail_uri`, `on_platform_audio_preview_link`, `is_ads_eligible`. | post-for-me #369 (code + tests, checked against Meta's page 2026-10-06), #368, bundle.social ("preview/download URL when Instagram provides it") | two independent wrappers agree            |

## 3. Design

### 3.1 Connection

- `GET /api/instagram/connect` (admin session re-verified): a random `state` (32 bytes) and the
  return address — only `/admin/reels?g=…` (`safeReturn`) — in httpOnly, SameSite=Lax cookies
  scoped to the callback path, 10 minutes; then Meta's dialog (F4). `META_LOGIN_CONFIG_ID` swaps the
  scope list for a Facebook Login for Business configuration.
- `GET /api/instagram/callback`: session re-verified, `state` compared in constant time, the code
  exchanged and lengthened (F5), the first Page with a linked Instagram account taken.
- **The token is probed, not assumed** — Meta's pages disagree on whether Instagram calls want the
  Page token or the user token: the Page token is tried on the account's own profile first, then
  the user token. `InstagramConnection.tokenKind` records which one worked.
- `InstagramConnection` (one per owner): ids, names, both tokens **only through `encryptToken`**
  (`src/lib/token-cipher.ts`; no key → no connection), the user token's expiry. "Odpojit
  Instagram" deletes the row.

### 3.2 Graph client (`src/lib/instagram/graph.ts`, server-only)

`appsecret_proof` on every call with a token; every response Zod-parsed — an item that does not
parse is dropped, an envelope that does not parse is an error; Meta's error `code` kept, 190
(invalid token) → "connect again". `META_GRAPH_BASE_URL` / `META_DIALOG_BASE_URL` point the client
at a local mock in tests.

### 3.3 In the reels page

"Hudba z Instagramu" (`reel-instagram-music.tsx`): music or original sounds, trending or a search.
"Použít" fetches `download_url` **in the browser**, the beat is found like any track's, and it is
kept in IndexedDB as `kind: "instagram"` with its `audioId`. From there it is a track like a file:
the variants start on the loudest stretch, can be moved by bars, and the file is made **with its
sound or without** — the reels page's "Se zvukem / Bez zvuku".

### 3.4 Where the bytes go

The browser fetches `download_url` from Meta's CDN directly; nothing passes through Vercel
(CLAUDE.md invariant 1 in spirit, and its 4.5 MB body limit). If Meta's CDN refuses a browser
fetch (U3), the fallback is a route on the existing Cloudflare Worker (`worker/`) that copies the
file into a short-lived R2 key — not built until a real account shows it is needed.

## 4. Open — only Pavel's account can answer

| #   | Question                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------- |
| U1  | Is `download_url` the whole track (`duration_in_ms`) or a clip? The track row shows both lengths' effect: a clip decodes shorter. |
| U3  | Does Meta's CDN allow a browser `fetch` of `download_url` (CORS)?                                                                 |
| U4  | What does `/ig_audio` return to a business account — licensed music, or the Sound Collection?                                     |
| U6  | Which permissions does search alone need — is `instagram_content_publish` required?                                               |

(U2 and U5 belonged to publishing and went with it.)

## 5. What Pavel does, and where

1. **Instagram as a business account** — Instagram app → profile → ☰ → Settings → "Account type
   and tools" → switch to professional → Business.
2. **Linked to the Facebook Page** — business.facebook.com → Settings → Accounts → Instagram
   accounts → connect.
3. **Meta app** — developers.facebook.com → log in with the profile that administers the Page →
   register as a developer → My Apps → Create app → use case **"Manage messaging & content on
   Instagram"** → Customize → **"API setup with Facebook login"** (one setup per app; the other,
   Instagram login, has no Audio API). Development mode is enough (F3).
4. **Redirect** — the app → Facebook Login → Settings → Valid OAuth Redirect URIs:
   `https://photos.svatebni-fotograf-cechy.cz/api/instagram/callback`.
5. **Vercel** — vercel.com → g-gallery → Settings → Environment Variables: `META_APP_ID`,
   `META_APP_SECRET` (Production); `META_LOGIN_CONFIG_ID` if the app uses a login configuration.
   The secret never goes into the chat or the repo.

`/smazani-dat` (cs + en) holds the data-deletion instructions Meta's app settings ask for.

## 6. Risks

- **Licensing**: a track's sound in a downloaded file is not Instagram attaching it; whether an
  upload with it gets muted is Meta's call per track (`is_ads_eligible` hints). "Bez zvuku" + the
  same song chosen in the app is always safe.
- **Tokens** die with a password change (F5) — "connect again" in the page.
- **Graph versions** retire after about two years — `META_GRAPH_VERSION`, Meta's changelog.

## 7. Tested (2026-10-28)

Unit: the dialog URL (scope vs `config_id`), `state` and the return address (open redirects
refused), the Graph client against Meta's shapes (fields, `audio`/`data` envelopes, numeric ids,
an item without an id dropped, error 190, an unexpected envelope refused), the search action
(Zod limits, no account, expired token). In the browser against a local mock of Meta's dialog and
Graph API: a forged `state` refused before any call to Meta; connect → back on the same galleries →
the account shown; trending → a track taken → its beat found (126 BPM); disconnect. The database
held both tokens encrypted (`v1.…`), the Page token chosen by the probe. **Not tested — needs
Pavel's account:** the real dialog and permissions, U1–U6.

## Sources

- Meta: Audio API — https://developers.facebook.com/documentation/instagram-platform/content-publishing/audio-api
- Meta: Instagram Platform overview — https://developers.facebook.com/docs/instagram-platform/overview/
- Meta: Manually Build a Login Flow — https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow
- Meta: Long-lived tokens — https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived
- Meta: Instagram API with Facebook Login, get started — https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/get-started
- Meta: Graph API versions — https://developers.facebook.com/docs/graph-api/changelog/versions/
- post-for-me #369 (audio discovery code) — https://github.com/DayMoonDevelopment/post-for-me/pull/369
- post-for-me #368 (audio contract) — https://github.com/DayMoonDevelopment/post-for-me/pull/368
- post-for-me #273 — https://github.com/DayMoonDevelopment/post-for-me/pull/273
- cobrasmash #39 — https://github.com/cobrasmashbc/Cobrasmash/issues/39
- bundle.social Instagram Music API — https://bundle.social/instagram-music-api
- ayrshare Instagram — https://www.ayrshare.com/docs/apis/post/social-networks/instagram
- getphyllo permissions — https://www.getphyllo.com/post/instagram-api-permissions-scopes
- blotato posting API — https://www.blotato.com/blog/instagram-posting-api
- bundle.social Page tokens — https://bundle.social/blog/facebook-page-access-token
- thecodebarbarian, Facebook login without Passport — https://thecodebarbarian.com/passport-free-facebook-login-with-node-js.html
- singhamandeep, config_id — https://singhamandeep.com/?p=1487

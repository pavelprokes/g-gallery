# Publishing reels to Instagram with Instagram's own music — plan

**Status: proposed 2026-10-28, nothing built.** Pavel asked for reels (docs/REELS.md) to carry
Instagram's licensed music, cut on its beat. This is the plan: what is known and from where (§1),
what only a test on his account can answer (§2), the design (§3), the phases (§4), what Pavel has to
do and where (§5), risks (§6). Every Meta fact below was checked against at least two independent
sources where two existed; the confidence column says so. Meta's own developer pages could not be
opened from the build session (developers.facebook.com is outside its network) — they were read
through search results and through code that others wrote against them. **Before phase 1 starts,
each row marked "single" or "unverified" is re-read on Meta's page itself.**

## 1. What is known

| #   | Fact                                                                                                                                                                                                                                                                                                                                                                      | Sources                                                                                                                                    | Confidence                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| F1  | A Reel is published in three calls: `POST /{ig-user-id}/media` (`media_type=REELS`, `video_url`, `caption`) → poll `GET /{container-id}?fields=status_code` until `FINISHED` (`IN_PROGRESS`, `ERROR`, `EXPIRED`, `PUBLISHED` are the others) → `POST /{ig-user-id}/media_publish` with `creation_id`. Meta fetches `video_url` itself.                                    | Meta Content Publishing (search excerpts), postproxy.dev, getphyllo.com, upload-post.com, zernio.com                                       | confirmed                                     |
| F2  | Reel file: MP4/MOV, H.264, AAC ≤ 48 kHz stereo, 23–60 fps, 3 s – 15 min, ≤ 300 MB, `moov` at the front. Reels tab: 9:16, 5–90 s. **Our reels fit** (1080×1920, 30 fps, ≤ 30 s, fast start) — **if H.264**: a VP9 render (Firefox, Playwright's Chromium) cannot be published.                                                                                             | Meta IG User Media reference (excerpts), contentstudio, agorapulse, swat.io, socialync                                                     | confirmed                                     |
| F3  | The music API exists only on the **Instagram API with Facebook Login** (an Instagram professional account linked to a Facebook Page), not with Instagram Login. Permissions on that path: `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`; `ads_management`/`ads_read` only when the Page role comes through Business Manager. | Meta Instagram Platform overview (excerpts), getphyllo, tryadeli; Facebook-Login-only: post-for-me #273/#368/#369, ayrshare, bundle.social | confirmed (`business_management`: unverified) |
| F4  | An app serving only its owner's own account needs **Standard Access only — no App Review**, for people with a role on the app (admin, developer, tester).                                                                                                                                                                                                                 | Meta overview ("Standard Access is all your app needs"), blotato, cobrasmash issue #39 (first-hand, 2026-10-09)                            | confirmed                                     |
| F5  | **In Development mode, what the app publishes is visible only to people with a role on the app.** Live mode fixes it, retroactively, with no App Review; it needs Settings → Basic complete: privacy policy URL, terms URL, data-deletion instructions URL, contact e-mail, icon, category.                                                                               | cobrasmash issue #39 (first-hand), Meta Basic Settings and privacy-policy docs (excerpts), meta.discourse                                  | confirmed                                     |
| F6  | Login gives a short-lived user token → `GET /oauth/access_token?grant_type=fb_exchange_token` (needs the app secret, server-side) → a ~60-day user token → `GET /me/accounts` → Page tokens **without an expiry**, invalidated by a password change or losing the Page role.                                                                                              | Meta "Long-Lived Access Tokens" (excerpts), bundle.social, agoras docs                                                                     | confirmed                                     |
| F7  | Music search: `GET /ig_audio?user_id={ig-user-id}&audio_type=music\|original_sound[&search_query=…]` (no query → trending). Each item: `audio_id`, `title`, `display_artist`, `duration_in_ms`, `download_url` (may be null, expires after ~1.5 days), `cover_artwork_thumbnail_uri`, `on_platform_audio_preview_link`, `is_ads_eligible`.                                | post-for-me #369 (code + tests, checked against Meta's page 2026-10-06), #368 (contract), bundle.social, ayrshare                          | two independent wrappers agree                |
| F8  | Music on a Reel: `audio_configuration = { audio_id (required), audio_volume 0–100, video_volume 0–100 }` on the **container** call, single-video Reels only. Meta does not support Reel previews with attached audio. **No start-time parameter for Instagram** (TikTok has `music_sound_start/end`).                                                                     | post-for-me #368 (contract), #273, bundle.social; no source shows a start field                                                            | likely; absence to confirm on Meta's page     |
| F9  | Published media can be deleted by API since 2025-12-03 ("IG Media Deleting API") — for cleaning up test Reels.                                                                                                                                                                                                                                                            | Meta developer blog 2025-12-03 (excerpt), API Evangelist mirror (`DELETE /{media-id}`); older docs say "not supported"                     | single primary; permission unverified         |
| F10 | `GET /{ig-user-id}/content_publishing_limit` reports the quota; Meta's reference says 50/24 h, a guide quotes 100. Irrelevant at our volume; read at runtime, never hard-coded.                                                                                                                                                                                           | Meta reference (excerpt), adaptlypost, zernio                                                                                              | conflicting number                            |

## 2. What only a test can answer

| #   | Question                                                                                                                                                     | Why it matters                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| U1  | Is `download_url` the whole track (`duration_in_ms`) or a clip?                                                                                              | The beat is found in it.                                                             |
| U2  | **From which point does the attached music play in the published Reel?** 0:00 of the track, 0:00 of `download_url`, or a part Instagram chooses?             | Decides whether cuts can land on its beats at all (F8: there is no start parameter). |
| U3  | Does `download_url` allow a browser `fetch` (CORS)?                                                                                                          | Decides where its bytes go (§3.4).                                                   |
| U4  | What does `/ig_audio` return to a **business** account — licensed music, or the Sound Collection only? What does `is_ads_eligible` mean for an organic post? | Decides whether the feature is worth it.                                             |
| U5  | Does a container accept a video with no audio track at all, with `audio_configuration`?                                                                      | Our renders for Instagram music are silent.                                          |

**Decision gate after the spike (phase 2):** if U2 is a known point (0:00 of `download_url`, or a
reported offset) → the beat-synced flow of §3. If Instagram picks the part itself → no beat sync
with its music: publishing still works, with cuts at the song's tempo but not its phase, and the
synced path stays the one of docs/REELS.md (a file with a licence, or listening + adding the song
in the app).

## 3. Design

### 3.1 Connection (one per photographer)

- `GET /api/instagram/connect` (admin session re-verified) → redirect to Meta's OAuth dialog with
  the F3 scopes and a random `state` in an httpOnly, SameSite=Lax cookie.
- `GET /api/instagram/callback` → `state` checked, `code` exchanged, long-lived user token,
  `/me/accounts?fields=name,access_token,instagram_business_account{id,username}`, the Page whose
  Instagram account is Pavel's chosen → stored.
- **`InstagramConnection`** (additive migration): `ownerId` unique, `igUserId`, `igUsername`,
  `pageId`, `tokenCipher` (the Page token, AES-256-GCM through `src/lib/token-cipher.ts` — the same
  key and module as share links), `scopes`, `connectedAt`, `lastErrorAt`. Never the raw token.
- Disconnect = delete the row. Error 190 (invalid token) → "Připojit znovu" in the admin.
- `META_APP_ID`, `META_APP_SECRET` (runtime, `docs/VERCEL-ENV.md`), Graph version a constant
  (`src/lib/instagram/graph.ts`, read on Meta's changelog at build time, not guessed).

### 3.2 Graph client (`src/lib/instagram/*`, server-only)

Every response Zod-parsed; errors mapped to Meta's `code`/`error_subcode`; a `GRAPH_BASE_URL`
override so E2E runs against a local mock (Playwright cannot intercept server-side calls). Unit
tests on fixtures taken from real responses during the spike.

### 3.3 Music from Instagram in the reels page

A third source in "Hudba" (docs/REELS.md §2): **Z Instagramu** — search box, trending by default,
rows with artwork, title, artist, length. Server Action `searchInstagramAudio` (session
re-verified, Zod input). Choosing a track fetches `download_url` (§3.4), finds its beat, and keeps
it in IndexedDB as `kind: "instagram"` with `audio_id` — expiring with `download_url` (~1.5 days),
re-fetched by id when needed.

### 3.4 Where the music's bytes go

Never through Vercel (CLAUDE.md invariant 1 in spirit; also Vercel's 4.5 MB body limit):

1. **Browser `fetch(download_url)`** if U3 says CORS allows it — nothing of ours in the path.
2. Otherwise **the existing Cloudflare Worker** (`worker/`, already bound to the bucket) gets a
   route that copies one `download_url` (host allow-listed to Meta's CDN, request signed by our
   server like the ZIP links) to `reels/audio/<audio_id>` in R2; the browser reads it from the CDN.

### 3.5 Render and upload

- The cut plan as today, `startBeat` fixed by U2 (the music's own start, not the loudest stretch).
- Rendered **without sound** and **H.264 only** (F2); the publish button says why when the browser
  can only do VP9.
- Upload: presigned PUT to **`reels/<128-bit random>.mp4`** (new presign kind, admin only, ≤ 300 MB,
  `video/mp4`) → public on `NEXT_PUBLIC_PHOTOS_BASE_URL`, which Meta fetches (F1). An **R2
  lifecycle rule deletes `reels/` after 7 days**.

### 3.6 Publishing

- Server Action `createInstagramReel({ objectKey, caption, audioId, audioVolume })` → container
  (`video_volume` 0 — the file is silent anyway).
- The page polls `instagramReelStatus(containerId)` every 10 s, at most 5 minutes (Meta's
  guidance as relayed: once a minute for five minutes; ours is a person waiting), then
  `publishInstagramReel` → media id → `permalink` shown with "Otevřít na Instagramu".
- No preview with the attached music exists (F8): the page's own preview plays `download_url`
  from the point U2 established — the closest honest preview.
- Caption: a text field, prefilled from the wedding's title and venue, never a couple's names
  unless typed.

### 3.7 Privacy and Meta's requirements

- Only Pavel's own account and Page; no guest or viewer data reaches Meta.
- Live mode (F5) needs a **data-deletion instructions page** — added to this site
  (`/smazani-dat`, cs + en): what the integration stores (the token, the account id) and that
  "Odpojit Instagram" or removing the app in Facebook settings deletes it.
- Privacy policy and terms: the main site's, if they exist (Pavel to give the URLs).

## 4. Phases (each its own pull request, tested, mergeable alone)

| Phase | Content                                                                                                                                                                                                                                            | Needs from Pavel |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 0     | Read Meta's pages for every row of §1 not "confirmed"; fix this plan.                                                                                                                                                                              | §5 step 1        |
| 1     | Connection (§3.1), Graph client (§3.2), `/smazani-dat`, `InstagramConnection` migration, docs. "Připojit Instagram" on `/admin/reels`.                                                                                                             | §5 steps 2–6     |
| 2     | **Spike** — an admin-only test button: search, fetch one `download_url`, render a 10 s marker video (a white flash on each beat assuming the music starts at 0:00), publish it with that `audio_id`. Answers U1–U5. Throwaway code, removed after. | §5 step 7        |
| 3     | Decision gate (§2). If green: §3.3–§3.6 in the reels page, E2E against the Graph mock.                                                                                                                                                             | approval         |
| 4     | Live mode (§5 step 8), first real Reel, docs/REELS.md and CLAUDE.md updated.                                                                                                                                                                       | §5 step 8        |

## 5. What Pavel does, and where

1. **Let the build session read Meta's docs** — one of: Claude Code → this environment's settings →
   Network access → Allowed domains: `developers.facebook.com`, `graph.facebook.com`
   (https://code.claude.com/docs/en/cloud-environments#network-access); or connect the Claude in
   Chrome extension to this session.
2. **Instagram as a business account**: Instagram app → profile → ☰ → Settings → "Account type and
   tools" → switch to professional → **Business**.
3. **Linked to the Facebook Page**: Meta Business Suite (business.facebook.com) → Settings →
   Accounts → Instagram accounts → connect; or Instagram app → Edit profile → Page.
4. **Meta developer account and app**: developers.facebook.com → log in with the Facebook profile
   that administers the Page → register as a developer → My Apps → Create app (business type, the
   Instagram use case with Facebook Login — exact menu names to be confirmed in phase 0).
5. **OAuth redirect**: in the app, Facebook Login → Settings → Valid OAuth Redirect URIs:
   `https://photos.svatebni-fotograf-cechy.cz/api/instagram/callback`.
6. **Secrets into Vercel, never into the chat**: vercel.com → project g-gallery → Settings →
   Environment Variables → `META_APP_ID`, `META_APP_SECRET` (Production and Preview). The app ID
   alone may be sent in the chat.
7. **The spike, ~30 minutes together**: at the Mac in Chrome, the Instagram app on the phone.
   Decide: test on the main account (and delete the test Reel after) or on a separate test
   business account with its own Page.
8. **Live mode** (before real use): app → Settings → Basic → privacy policy URL, terms URL, data
   deletion URL (`/smazani-dat`, from phase 1), contact e-mail, icon, category → switch to Live.
9. **R2 lifecycle**: Cloudflare → R2 → g-gallery → Settings → Object lifecycle rules → delete
   `reels/` after 7 days (docs/SETUP.md §12 shows the screen).

## 6. Risks

- **U2 kills beat sync** — the gate in §2; the existing flows stay.
- **Development mode hides posts** (F5) — phase 4 is not optional.
- **Licensing**: Instagram's music on a business account is Meta's call per track (`is_ads_eligible`,
  U4); a track may vanish from the catalogue — the page re-checks by id before publishing.
- **Tokens** die on a password change (F6) — the reconnect banner.
- **Graph versions** retire after about two years — one constant, Meta's changelog.
- **Publishing is public and immediate** — a confirmation step with the caption and the account's
  name before the call; deletion (F9) only if verified in phase 0.

## Sources

- Meta: Content Publishing — https://developers.facebook.com/docs/instagram-platform/content-publishing
- Meta: Audio API — https://developers.facebook.com/documentation/instagram-platform/content-publishing/audio-api
- Meta: IG User Media — https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media
- Meta: content_publishing_limit — https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit
- Meta: Instagram Platform overview — https://developers.facebook.com/docs/instagram-platform/overview/
- Meta: Long-lived tokens — https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived
- Meta: Instagram API updates (2025-12-03) — https://developers.facebook.com/blog/post/2025/12/03/instragram-api-updates/
- Meta: Privacy policy expectations — https://developers.facebook.com/documentation/development/terms-and-policies/privacy-policy.md
- post-for-me #369 (audio discovery code) — https://github.com/DayMoonDevelopment/post-for-me/pull/369
- post-for-me #368 (audio contract) — https://github.com/DayMoonDevelopment/post-for-me/pull/368
- post-for-me #273 (audio_configuration) — https://github.com/DayMoonDevelopment/post-for-me/pull/273
- cobrasmash #39 (development mode hides posts) — https://github.com/cobrasmashbc/Cobrasmash/issues/39
- bundle.social Instagram Music API — https://bundle.social/instagram-music-api
- ayrshare Instagram — https://www.ayrshare.com/docs/apis/post/social-networks/instagram
- getphyllo permissions — https://www.getphyllo.com/post/instagram-api-permissions-scopes
- postproxy Reels guide — https://postproxy.dev/blog/instagram-reels-api-publishing-guide/
- blotato posting API — https://www.blotato.com/blog/instagram-posting-api
- bundle.social Page tokens — https://bundle.social/blog/facebook-page-access-token
- agorapulse limits — https://support.agorapulse.com/en/articles/8769640-technical-limits-of-instagram-direct-publishing
- contentstudio requirements — https://docs.contentstudio.io/article/830-what-are-the-requirements-to-directly-publish-images-and-videos-to-instagram
- adaptlypost publishing limit — https://adaptlypost.com/blog/content-publishing-limit-instagram-api

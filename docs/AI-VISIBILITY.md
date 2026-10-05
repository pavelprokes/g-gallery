# AI visibility (GEO) — how assistants find Pavel, and what we do about it

Audit and decisions from 2026-09-28. Covers both properties: the main site
`svatebni-fotograf-cechy.cz` (separate repo, `svatebni-fotograf-cechy-2.0`) and this app
(`photos.svatebni-fotograf-cechy.cz`). What the main site should change lives in
[`HANDOFF-MAIN-SITE.md` §15](HANDOFF-MAIN-SITE.md#15-viditelnost-v-ai-asistentech-geo), the one
document its agent reads. This file holds the evidence, the decisions for this repo, the off-site
checklist and the monthly test.

## Terms

**GEO** (Generative Engine Optimization) is the common name in 2026; **AEO** (Answer Engine
Optimization) and **LLMO** are used interchangeably; Czech sources say "GEO", "optimalizace pro AI
vyhledávače" or "AI SEO". Google's own guide says optimizing for its generative features "is still
SEO" ([Google][g-ai-guide]).

The line this work holds, taken from Anthropic's `seo-ai-visibility` skill: **make the sites
readable, and their facts unambiguous and consistent. Never try to influence what an assistant
recommends** — no hidden text, no instructions to AI inside page content, no invented reviews,
credentials or numbers. Nobody can make an assistant recommend a business.

## Where assistants get local answers

| Assistant                                                | Source                                                                                                                                                                   |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Google AI Overviews / AI Mode (Czech since Oct 2025)     | Google's normal index; indexable + snippet-eligible is the only requirement ([Google][g-ai-features]). Business Profile explicitly recommended ([Google][g-succeeding]). |
| Gemini                                                   | Google; Maps grounding exists in the API, consumer use undocumented.                                                                                                     |
| ChatGPT search                                           | Third-party search providers (Bing originally) + `OAI-SearchBot`; business cards mostly from Yelp ([Axios][yelp]) — weak in Czechia, Czech source unverified.            |
| Perplexity                                               | Own index (`PerplexityBot`), Yelp, maps.                                                                                                                                 |
| Claude                                                   | Brave Search ([Willison][brave]).                                                                                                                                        |
| Copilot                                                  | Bing, Bing Places.                                                                                                                                                       |
| **Seznam Asistent** (all logged-in users since May 2026) | **Firmy.cz** ([Seznam][seznam]).                                                                                                                                         |

## What moves it (evidence as of 2026-09)

Supported:

1. **Being crawlable and indexable** — the bar Google states.
2. **Mentions on other sites** — directories, rankings, articles. Across 75k brands, web mentions
   correlated with AI Overview visibility at ρ 0.66 vs 0.22 for backlinks ([Ahrefs][ahrefs-mentions]);
   correlation, not proof.
3. **Business listings and reviews**, with name/address/phone identical everywhere.
4. **Freshness** — AI-cited pages are ~26 % fresher than organic results ([Ahrefs][ahrefs-fresh]).

Weak or disproven — do them for accuracy, not as levers:

- **schema.org**: no measurable citation lift in a 2026 difference-in-differences study
  ([Ahrefs][ahrefs-schema]); Google needs no special schema for AI features.
- **llms.txt**: Google does not use it; ~97 % of 137k files got no requests in a month
  ([Ahrefs][ahrefs-llms]).

**Crawlers that matter for citations**: `Googlebot`, `Bingbot`, `OAI-SearchBot`, `PerplexityBot`,
`Claude-SearchBot`. Training-only bots (`GPTBot`, `ClaudeBot`, `Google-Extended`, `CCBot`) do not
affect citations. Cloudflare's 2025–26 AI-crawler controls can block multi-purpose crawlers
(Googlebot, Bingbot) when "Training" is blocked ([Help Net Security][cf]) — relevant to the main
site if it is proxied; `photos` is DNS-only to Vercel (`docs/SETUP.md`), so Cloudflare cannot
block this host.

## Audit, 2026-09-28

Evidence: web search (not live assistant answers — see [the monthly test](#monthly-test)),
directory listings, this repo's code. The main site itself could not be fetched from the audit
environment, so its `robots.txt`, Cloudflare settings, schema and renderability are **unverified**.

Strong:

- **Brand queries** find the main site (/, /portfolio, /kontakt, /cenik, /benesov) and listings on
  [Firmy.cz][firmy], [Svatební asistentka][sa], [Budemesvoji][bs], [Photographs.cz][ph], Facebook,
  with quotable facts (14 years, 200+ weddings, 5★ Google, drone, within 100 km of Prague without
  travel fee).
- **Town pages rank**: "svatební fotograf Benešov" → `/benesov` third, after two directories.
- `/cenik` shows up for "galerie pro hosty".

Weak:

- **Generic intent queries** — "nejlepší svatební fotograf střední Čechy", "kolik stojí svatební
  fotograf celý den Praha", "svatební fotograf s dronem", "žebříček svatebních fotografů 2026":
  absent. Directories and rankings win ([mywed][mywed], [fotoprofici][fp]), plus competitors with
  their own content.
- **English**: absent for "wedding photographer Czech Republic castle" and "English speaking
  wedding photographer Prague" ([Tov Studio guide][tov], [expats.cz][expats], mywed, foreign
  photographers).
- **Guest-gallery category** ("svatební galerie pro hosty QR"): specialised services only
  (weddApp, FotoDrop, Snapshare, MomentsForLove).
- **Address**: Firmy.cz and this app's footer give the registered address "Křižíkova 424/127,
  186 00 Praha 8 – Karlín" (with IČO — legally required on the website, § 435 občanský
  zákoník); the main site gives "Roudnická 450/16, 182 00 Praha 8 – Střížkov", and search
  summaries of a brand query repeat that one. Assistants therefore state two addresses.
  **Decided 2026-09-29 (Pavel): Karlín is the one address everywhere**; Střížkov goes.

This app:

- `robots.txt` allows everything; non-public routes carry their own `noindex` (the reasoning is in
  `src/app/robots.ts`). The root (`/`) is the only indexable page, with `FAQPage` data.
- The root was not found in the index. First step: Search Console URL Inspection. The re-run
  below shows what that costs: asked about the domain, a search summary _guessed_ it is "likely a
  photo gallery or portfolio section" — with nothing indexed to quote, an assistant makes it up.
- Crawlers send no `Accept-Language`, so they get the English render (`DEFAULT_LOCALE`,
  `docs/I18N.md`). **Accepted on purpose**, see below.
- The projector claim "in real time" was false (the slideshow polls every 30 s) — fixed to
  "within about half a minute" in all three catalogs.

### Re-run, same day (after #42 merged)

Same queries, same results — expected: #42 changed documentation and one line of copy, and
search and assistants take 30+ days to reflect anything. New detail it surfaced:

- **The second address is concrete**: Roudnická 450/16, Praha 8 – Střížkov (above; since
  decided: Karlín only).
- **The unindexed root gets guessed at** (above).
- **More directories cited for generic queries**: [Svatební katalog][katalog] and
  [PojdFotit.cz][pojdfotit] for "nejlepší svatební fotograf střední Čechy"; [WPJA][wpja] for
  "wedding photographer Czech Republic castle". Two more guest-gallery services: Share love,
  Svatbaa.
- **Price queries go to pages that state a price as text** — "24 900 Kč za 10 hodin"
  ([FotoEmotion][fotoemotion]), fotoprofici's "cena 2026" guide. `/cenik` did not appear for
  "svatební fotograf Praha cena celodenní".

## Decisions for this repo

| Proposal                                      | Decision        | Why                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fix the projector claim                       | Done            | An assistant repeats what the page says; a wrong fact is the costliest finding.                                                                                                                                                                                                                                                                                     |
| Per-locale URLs for `/` (`?lang=` + hreflang) | Not done        | The root is guest help; the sales page is the main site's `/galerie-pro-hosty` (`HANDOFF-MAIN-SITE.md` §10 — the two must not compete). Would break "the URL never carries the locale" (`docs/I18N.md`), needs a proxy branch and a switcher fix, and Google lists parameter URLs as "not recommended". Revisit only if Pavel wants the help page to rank in Czech. |
| `ProfessionalService` JSON-LD on `/`          | Done 2026-10-05 | By reference only: the main site now publishes `#organization` and `#person` `@id`s, and `/` points `publisher`/`author` at them (`src/lib/landing-jsonld.ts`) with just `name` and `url` — address, phone and `sameAs` stay on the main site so the two cannot disagree.                                                                                           |
| Photographer's name in the title of `/`       | Done 2026-10-05 | "Wedding gallery help" named nobody; an assistant asked about the domain had nothing to attribute it to. The title stays help, not sales (`HANDOFF-MAIN-SITE.md` §10), and adds "· Pavel Prokeš, svatební fotograf" (per language) in each catalog.                                                                                                                 |
| Named groups per AI bot in `robots.txt`       | Not done        | A crawler obeys only its most specific group (RFC 9309): `Googlebot: Allow /` changes nothing today, and a later `Disallow` under `*` would silently not apply to the named bots.                                                                                                                                                                                   |
| `llms.txt` on `photos`                        | Done 2026-10-05 | Cheap and static (`public/llms.txt`), so done despite little evidence it is read (Ahrefs above). It repeats the FAQ's facts and points to the main site.                                                                                                                                                                                                            |
| Numbers in the FAQ answers                    | Done 2026-10-05 | "For a while" gave an assistant nothing to quote. Now: 15-minute lockout (`UNLOCK_LOCKOUT_MS`, pinned by `messages.test.ts`), galleries never expire on their own, ZIP usually within an hour of the last upload (`QUIET_PERIOD_MS` + the 15-minute cron).                                                                                                          |
| `lastmod` in the sitemap                      | Done 2026-10-05 | A hand-bumped date in `src/app/sitemap.ts`, never the build time — a `lastmod` that moves on every deploy is ignored.                                                                                                                                                                                                                                               |

## Off-site checklist (Pavel)

1. **Address — decided 2026-09-29: "Křižíkova 424/127, 186 00 Praha 8 – Karlín" everywhere.**
   Replace "Roudnická 450/16, Praha 8 – Střížkov" on the main site (HANDOFF-MAIN-SITE.md §15.2)
   and in every listing that has it; Firmy.cz and this app's footer already match. Google
   Business Profile: this address, or a service-area business with the address hidden — never
   Střížkov.
2. **Google Business Profile**: categories, service area by town, services with prices, photos;
   ask recent couples for reviews.
3. **Bing Places** (Bing, Copilot; ChatGPT search partly uses Bing) and **Apple Business** (Maps,
   Siri).
4. **Firmy.cz** — the source for Seznam Asistent: complete it, reviews, same facts.
5. **Directories assistants cite**: mywed, fotoprofici, fotografove.info, Svatební katalog
   (svatebni-katalog.cz), PojdFotit.cz; in English the expats.cz directory and WPJA; venue
   "recommended vendors" pages for castles he has shot at.
6. **Rankings and guides**: ask to be considered for country guides (e.g. Tov Studio) and Czech
   wedding blogs; real mentions, never paid fake reviews.
7. **Search Console** on both domains: URL Inspection of `https://photos.svatebni-fotograf-cechy.cz/`
   (not indexed, so assistants guess what it is),
   Performance → Generative AI (impressions only, since June 2026 —
   [Google][gsc-ai]). **Bing Webmaster Tools** → AI Performance (Copilot citations —
   [Bing][bing-ai]).
8. **Vercel Firewall** → Bot Management → "AI Bots" ruleset for the g-gallery project: Log or
   Allow, not Deny.

## Monthly test

Once a month, logged out or in a private window, ask each assistant — ChatGPT (search on),
Perplexity, Gemini, Google AI Mode, Claude, Copilot, Seznam Asistent — each prompt below. Answers
vary between runs: ask each twice. Record verbatim; **never compute a score** — direction over
months is the signal.

Czech:

1. Kdo je dobrý svatební fotograf ve středních Čechách?
2. Doporuč mi svatebního fotografa na celý den v Praze. Kolik to stojí?
3. Svatební fotograf s dronem v Čechách
4. Svatební fotograf na zámek Konopiště / Benešov
5. Jak udělat na svatbě galerii, kam hosté nahrají fotky přes QR kód?
6. Pavel Prokeš svatební fotograf — ceny, recenze, kontakt _(accuracy check: are the facts right?)_

English:

7. Recommend a wedding photographer for a castle wedding in the Czech Republic.
8. English-speaking wedding photographer in Prague, full-day price?
9. Who is Pavel Prokeš, the wedding photographer? _(accuracy check)_

Record per answer: date · assistant · prompt · mentioned (yes/no) · linked/cited URL · facts
stated and whether correct · others named · sources cited. A wrong fact (price, address, "real
time") is worth more than a missing mention: it is specific and fixable.

[g-ai-guide]: https://developers.google.com/search/docs/fundamentals/ai-optimization-guide
[g-ai-features]: https://developers.google.com/search/docs/appearance/ai-features
[g-succeeding]: https://developers.google.com/search/blog/2025/05/succeeding-in-ai-search
[yelp]: https://www.axios.com/2026/07/23/yelp-reviews-chatgpt-geo-partnership
[brave]: https://simonwillison.net/2025/Mar/21/anthropic-use-brave/
[seznam]: https://blog.seznam.cz/2026/05/seznam-asistent-je-dostupny-vsem-prihlasenym-uzivatelum/
[ahrefs-mentions]: https://ahrefs.com/blog/ai-overview-brand-correlation/
[ahrefs-fresh]: https://ahrefs.com/blog/do-ai-assistants-prefer-to-cite-fresh-content
[ahrefs-schema]: https://ahrefs.com/blog/schema-ai-citations/
[ahrefs-llms]: https://ahrefs.com/blog/llmstxt-study/
[cf]: https://www.helpnetsecurity.com/2026/07/02/cloudflare-ai-crawler-controls/
[firmy]: https://en.firmy.cz/company/2641547-svatebni-fotograf-pavel-prokes-praha-karlin.html
[sa]: https://www.svatebniasistentka.cz/dodavatel/pavel-prokes-svatebni-fotograf
[bs]: https://www.budemesvoji.cz/listing/svatebni-fotograf-pavel-prokes/
[ph]: https://photographs.cz/fotograf/svatebni-fotograf-pavel-prokes
[mywed]: https://mywed.com/cs/Czech-Republic-wedding-photographers/
[katalog]: https://www.svatebni-katalog.cz/svatebni-katalog/svatebni-fotograf-video/stredocesky-kraj
[pojdfotit]: https://pojdfotit.cz/fotograf/fotograf-stredni-cechy/
[wpja]: https://www.wpja.com/wedding-venues/Czech%20Republic
[fotoemotion]: https://fotoemotion.cz/svatebni-fotograf-cenik/
[fp]: https://fotoprofici.cz/fotografove/svatebni-fotograf/pruvodce/kolik-stoji-svatebni-fotograf/
[tov]: https://tovstudiophoto.com/best-wedding-photographers-in-czech-republic/
[expats]: https://www.expats.cz/directory/listing/best-wedding-photographer-bcrqe
[gsc-ai]: https://developers.google.com/search/blog/2026/06/gen-ai-performance-reports
[bing-ai]: https://blogs.bing.com/webmaster/February-2026/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview

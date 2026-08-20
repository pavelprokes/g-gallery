export const meta = {
  name: "plan-revision-g-gallery",
  description:
    "Verify every pillar of the g-gallery architecture plan against current official docs, then run a completeness critic",
  phases: [
    {
      title: "Verify",
      detail:
        "7 parallel doc-verification agents (R2, Transformations, Vercel, Supabase+Prisma, Auth, Next 16, ZIP)",
    },
    { title: "Critique", detail: "completeness critic over all findings" },
  ],
};

const CONTEXT =
  "PROJECT CONTEXT (today: 2026-08-20): Photographer client-delivery web gallery (like Pixieset/Pic-Time) with Google-Photos-style UI. Already scaffolded: Next.js 16.3.1 (App Router, TS strict, src dir), React 19.2.8, Tailwind 4, pnpm 11, Prisma 7.9.1, Vitest + Playwright. Deploy: Vercel (user has a PAID Vercel account but wants to stay within included quotas). Volume: ~20 galleries per YEAR, 500 photos each, ~12MB JPEG exports (no RAW) => ~120GB/year, ~10k photos/year. Traffic modest (client galleries shared via private links). Budget goal: a few USD/month. PLANNED ARCHITECTURE: originals in Cloudflare R2 (zero egress) served via R2 custom domain; on-the-fly variants via Cloudflare Image Transformations (free tier 5k unique/month); uploads browser->R2 via presigned PUT (bypassing Vercel 4.5MB function body limit); Supabase free-tier Postgres via Prisma (this would be the user 2nd and last free project; daily Vercel cron keep-alive to prevent pausing); Auth.js v5 + Google OAuth only; features: expiring/password share links, client favorites, whole-gallery ZIP download, optional watermark.\n\nYOUR TASK: ";

const FOOTER =
  '\n\nMETHOD: You may not have web tools preloaded — first call ToolSearch with query "select:WebFetch,WebSearch". Prefer OFFICIAL documentation (developers.cloudflare.com, vercel.com/docs, supabase.com/docs, nextjs.org/docs, authjs.dev, better-auth.com, prisma.io/docs, GitHub repos); use WebSearch only to locate pages, then WebFetch the official page and cite it. Every verdict MUST cite at least one URL you actually fetched; official docs beat blog posts. Convert every claim into a verdict with status confirmed | needs_change | wrong | unverified, the current fact, and the concrete impact on the plan. Be terse but complete. Return ONLY the structured output.';

const FINDINGS = {
  type: "object",
  required: ["pillar", "verdicts", "risks", "recommendation"],
  properties: {
    pillar: { type: "string" },
    verdicts: {
      type: "array",
      items: {
        type: "object",
        required: ["claim", "status", "current_fact", "source_urls", "plan_impact"],
        properties: {
          claim: { type: "string" },
          status: { type: "string", enum: ["confirmed", "needs_change", "wrong", "unverified"] },
          current_fact: { type: "string" },
          source_urls: { type: "array", items: { type: "string" } },
          plan_impact: { type: "string" },
        },
      },
    },
    risks: { type: "array", items: { type: "string" } },
    recommendation: { type: "string" },
  },
};

const CRITIQUE = {
  type: "object",
  required: ["gaps", "disagreements", "top_risks"],
  properties: {
    gaps: { type: "array", items: { type: "string" } },
    disagreements: { type: "array", items: { type: "string" } },
    top_risks: { type: "array", items: { type: "string" } },
  },
};

const VERIFIERS = [
  {
    key: "r2",
    prompt:
      "PILLAR: Cloudflare R2 as origin store + browser presigned uploads. Verify: (1) Pricing: Standard $0.015/GB-month; free tier 10GB-month + 1M Class A + 10M Class B per month; zero egress. Also note Infrequent Access pricing + minimum storage duration. (2) Browser uploads: a Next.js server route generates an S3-compatible presigned PUT URL (aws4fetch or @aws-sdk/s3-request-presigner) and the browser PUTs a ~12MB JPEG directly to R2 — confirm supported, confirm max single-PUT object size (multipart unnecessary at 12MB), and document the EXACT bucket CORS configuration needed for browser PUT (origins, methods, headers, exposeHeaders) with a concrete JSON example from docs. (3) Public delivery: r2.dev is rate-limited/not for production; production requires a custom domain attached to the bucket on a Cloudflare zone, which enables Cache and Image Transformations — verify. (4) EU jurisdiction / location hints (user is in Czechia). (5) Compute expected monthly cost for our profile: ~120GB/year growth of 12MB objects, ~10k uploads/year, modest reads.",
  },
  {
    key: "transform",
    prompt:
      'PILLAR: Cloudflare Image Transformations for on-the-fly variants of R2-hosted photos. Verify: (1) Free allowance: 5,000 unique transformations/month then $0.50/1,000 — define precisely what counts as one unique transformation, confirm cached repeats do not recount, and confirm availability on the Free zone plan. (2) Setup: enabled per-zone; URL format /cdn-cgi/image/OPTIONS/SOURCE-URL; confirm a source image served from an R2 bucket custom domain on the SAME zone works; explain the "resize from any origin" setting. (3) Options we need: width, quality, format=auto (AVIF/WebP), fit, dpr; metadata options (strip EXIF vs keep copyright) and ICC color profile behavior (wide-gamut -> sRGB conversion correctness). (4) next/image integration via custom loaderFile — include the canonical Cloudflare loader snippet for Next.js from official docs. (5) Edge caching of transformed responses and TTL. (6) Sanity math: publishing one gallery = 500 photos x ~4 variants = 2,000 uniques in that month; steady state ~2 galleries/month worst case — do we stay under 5,000/month, and what does an overage month cost?',
  },
  {
    key: "vercel",
    prompt:
      "PILLAR: Vercel hosting for the Next.js 16 app (paid account, goal: stay within included quotas). Verify: (1) Cron Jobs current limits per plan (Hobby: count + granularity; Pro: count) — we need ONE daily cron hitting an API route. (2) Functions: 4.5MB request/response body limit still current (uploads must bypass Vercel); whether streaming responses are exempt; default/max duration with Fluid Compute for a trivial presign endpoint. (3) Image Optimization billing: confirm images.loaderFile (custom Cloudflare loader) or images.unoptimized fully avoids Vercel image transformation charges. (4) Included Pro quotas relevant here (fast data transfer, function invocations, edge requests) — sanity-check an HTML/JSON-only app (all images served by Cloudflare) stays far below. (5) Next.js 16 support on Vercel: Node runtime version, caveats. (6) Hobby plan commercial-use restriction — note briefly.",
  },
  {
    key: "supabase",
    prompt:
      "PILLAR: Supabase free-tier Postgres via Prisma 7 + keep-alive against pausing. CRITICAL QUESTION 1 — pause semantics: free projects pause after ~7 days of inactivity. Find the OFFICIAL current definition of activity: does traffic over the direct Postgres connection / Supavisor pooler (e.g. Prisma queries) count as activity, or only Supabase platform API (PostgREST/Auth/Storage/dashboard) requests? Dig into supabase.com/docs, official GitHub discussions, changelog. This decides whether the daily Vercel cron should run a Prisma query or MUST call the Supabase REST API. Give a definitive keep-alive design. (2) Free plan limits: 2 active projects (this would be the 2nd), 500MB database, 5GB egress, 50k MAU, automated backups NOT included — verify; if no backups, recommend an external pg_dump scheme. (3) Prisma 7 + Supabase best practice in 2026: connection strings (transaction pooler :6543 vs session :5432, pgbouncer=true, connection_limit, directUrl for migrations), Prisma 7 architecture changes (driver adapters / @prisma/adapter-pg, Rust-engine removal?) and the officially recommended setup for serverless (Vercel Fluid Compute). (4) pgvector available on the free tier?",
  },
  {
    key: "auth",
    prompt:
      "PILLAR: Authentication for Next.js 16 App Router — Auth.js (next-auth v5) vs better-auth, Google OAuth only. Verify with current sources: (1) Auth.js v5 status as of Aug 2026: released or still beta? Maintenance/commit activity? Confirmed compatibility with Next.js 16 (async cookies/headers, middleware/proxy changes)? Known open Next-16 issues? (2) better-auth: current version, Next.js 16 support, Prisma adapter quality, Google OAuth provider, maturity/adoption signals. (3) Recommend ONE for this project (small admin + client gallery, Google login, role field, sessions in Postgres via Prisma) with concrete justification and the canonical setup doc URL of the winner. (4) Google Cloud OAuth consent screen: with only basic scopes (openid, email, profile), confirm no verification review is needed; note Testing-mode 100-user cap vs Production publishing.",
  },
  {
    key: "next16",
    prompt:
      'PILLAR: Next.js 16 specifics so we write correct code the first time (installed: next 16.3.1, react 19.2.8, tailwind 4). From official nextjs.org docs/blog verify and summarize what affects this project: (1) Async request APIs (params/searchParams/cookies()/headers() as Promises) — canonical 16.x patterns. (2) Caching in 16.3: status/defaults of "use cache", cacheComponents, dynamicIO; recommended pattern for a mostly-dynamic gallery with some cacheable public pages; is classic ISR/revalidate still fine? (3) middleware.ts vs proxy.ts in Next 16 — current file name and semantics (matters for auth route protection). (4) next/image in 16: remotePatterns requirement, images.qualities config, custom loaderFile mechanics, minimumCacheTTL default. (5) Turbopack: default for dev AND build? Caveats with Vitest/Playwright. (6) Route Handlers vs Server Actions: recommended choice for (a) presign-upload endpoint, (b) admin mutations. (7) Minimum Node.js version. Cite exact doc pages.',
  },
  {
    key: "zip",
    prompt:
      "PILLAR: whole-gallery ZIP download — 500 photos x 12MB ~= 6GB per gallery, originals in Cloudflare R2, rare usage (maybe 20-60 gallery-downloads/year), budget a few USD/month. Evaluate THREE architectures with current official limits, then recommend one primary + one fallback: (A) Cloudflare Worker streaming a store-only ZIP (JPEGs, no compression) from R2 via bucket binding: verify Workers Free vs Paid ($5/mo) CPU-time limits (10ms free / 30s default paid — configurable up to how much?), whether wall-clock streaming duration is limited, whether streamed response size is limited, whether R2->Worker->client egress is free, and which ZIP libs run on Workers (client-zip, zip.js, littlezipper). IMPORTANT: 6GB > 4GB so ZIP64 is required — verify which libs support streaming ZIP64. Also assess this optimization: precompute CRC32 per file in the browser AT UPLOAD time, store it in the DB, and have the Worker emit ZIP entries with known CRCs so it never hashes the 6GB itself — near-zero CPU; feasibility of a minimal custom ZIP64 writer. (B) Client-side ZIP in the browser: fetch each original from the R2 custom domain and stream into a ZIP written to disk (File System Access API / streamsaver + zip.js or client-zip). Verify 6GB feasibility, memory behavior, Safari/iOS support in 2026. (C) Pre-generated ZIP stored in R2 at publish time (storage roughly doubles per gallery — compute the added cost) — what generates it (Worker + Queues, multipart upload assembly? verify multipart part-size/count limits allow 6GB).",
  },
];

phase("Verify");
log("Verifying 7 architecture pillars against current official docs...");
const results = await parallel(
  VERIFIERS.map(
    (v) => () =>
      agent(CONTEXT + v.prompt + FOOTER, {
        label: "verify:" + v.key,
        phase: "Verify",
        schema: FINDINGS,
      }),
  ),
);
const found = results.filter(Boolean);
log("Verification done: " + found.length + "/7 pillars returned findings");

phase("Critique");
const critique = await agent(
  CONTEXT +
    "You are the completeness critic for this architecture plan revision. Below are verification findings from 7 doc-verification agents. Identify: (1) gaps — important concerns neither the plan nor the findings cover; think about: R2 backup/versioning & disaster recovery, Supabase-to-R2 referential consistency (orphan objects, failed uploads), EXIF GPS privacy stripping on shared photos, watermarking approach, hotlink protection & abuse of public variant URLs, share-link token entropy + server-side expiry enforcement, domain prerequisite (the plan silently assumes a domain with DNS on Cloudflare — the user never confirmed owning one), cost alarms/budget caps, observability, GDPR for client photos (EU user), migration path off free tiers, upload resilience (500 x 12MB from a browser: retries, resume, partial failure UX). (2) disagreements — findings that contradict each other or the plan. (3) top_risks — ranked, concrete, each with a one-line mitigation. Do NOT invent facts; ground everything in the findings or in explicitly-labeled reasoning. FINDINGS JSON: " +
    JSON.stringify(found),
  { label: "critic", phase: "Critique", schema: CRITIQUE, effort: "high" },
);

return { found, critique };

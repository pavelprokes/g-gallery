import {
  buildZipLayout,
  partCount,
  planPart,
  type ChunkEntry,
} from "../../src/lib/zip-chunk-layout";
import { verifyBuildManifest, type BuildManifestEntry } from "../../src/lib/zip-build-manifest";

/**
 * Background "download all" ZIP builder (docs/TODO.md §7) — deliberately a
 * separate deployment from `../worker/` (the live streaming ZIP), because
 * that one needs Workers Paid ([limits] cpu_ms above the Free default) and
 * this one is specifically designed not to. Mixing them into one script
 * would make this one need Paid too, defeating the point.
 *
 * Every part is computed **independently** — `zip-chunk-layout.ts`'s whole
 * reason to exist is that the archive's byte layout is knowable before any
 * file data is read, so there is no rolling state carried between Queue
 * messages, no ordering requirement, and no per-gallery coordination needed
 * beyond counting how many part markers have shown up.
 *
 * Holds no session and talks to no database, same principle as the live
 * Worker — the app owns Gallery.zipStatus; this only ever reports outcomes
 * back to it over one authenticated HTTP call.
 */

interface Env {
  PHOTOS: R2Bucket;
  PARTS: Queue<PartMessage>;
  ZIP_BUILD_SIGNING_SECRET: string;
  ZIP_BUILD_CALLBACK_SECRET: string;
  /** Full URL of `/api/internal/zip-callback` on the app. */
  APP_CALLBACK_URL: string;
}

interface PartMessage {
  galleryId: string;
  partIndex: number;
}

interface TrackingManifest {
  galleryId: string;
  uploadId: string;
  objectKey: string;
  entries: BuildManifestEntry[];
  partSize: number;
  totalSize: number;
  expectedParts: number;
  startedAt: number;
}

const TRACKING_PREFIX = "_zip-builds/";
const PART_SIZE = 6 * 1024 * 1024;
/** A build that hasn't finished after this long is treated as dead, not slow — see resetStaleZipBuilds on the app side for the matching state-machine half of this. */
const STALE_MS = 60 * 60 * 1000;

function trackingKey(galleryId: string): string {
  return `${TRACKING_PREFIX}${galleryId}.json`;
}

function partMarkerKey(galleryId: string, partNumber: number): string {
  // Zero-padded so a lexicographic R2 list comes back in part order — not
  // load-bearing for correctness (every part is read regardless of order),
  // just makes debugging listings readable.
  return `${TRACKING_PREFIX}${galleryId}/parts/${String(partNumber).padStart(6, "0")}`;
}

/** Written the moment `completeMultipartUpload` succeeds — the one bit of
 * state that must survive a callback/cleanup failure, so a retry never calls
 * `complete()` a second time on an upload id R2 already considers finished. */
function completedMarkerKey(galleryId: string): string {
  return `${TRACKING_PREFIX}${galleryId}/completed`;
}

function toChunkEntries(entries: readonly BuildManifestEntry[]): ChunkEntry[] {
  return entries.map((e) => ({
    key: e.key,
    name: e.name,
    size: e.size,
    crc32: Number.parseInt(e.crc32, 16) >>> 0,
  }));
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/build-start") {
      return handleBuildStart(request, env);
    }
    return new Response("Not found", { status: 404 });
  },

  async queue(batch: MessageBatch<PartMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        await buildOnePart(message.body, env);
        message.ack();
      } catch (error) {
        console.error("part build failed", message.body, error);
        message.retry();
      }
    }
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(sweepBuilds(env));
  },
} satisfies ExportedHandler<Env, PartMessage>;

async function handleBuildStart(request: Request, env: Env): Promise<Response> {
  let body: { token?: string };
  try {
    body = await request.json();
  } catch {
    return new Response("Malformed request", { status: 400 });
  }
  if (!body.token) return new Response("Missing token", { status: 400 });

  const verified = await verifyBuildManifest(body.token, env.ZIP_BUILD_SIGNING_SECRET);
  if (!verified.ok) {
    const status = verified.reason === "expired" ? 410 : 403;
    return new Response(verified.reason, { status });
  }
  const { galleryId, objectKey, archiveName, entries } = verified.manifest;

  const chunkEntries = toChunkEntries(entries);
  const layout = buildZipLayout(chunkEntries);
  const expectedParts = partCount(layout.totalSize, PART_SIZE);

  // Set once, on the finished object itself — the whole point of a pre-built
  // archive is that downloading it later needs no Worker at all, so the
  // headers that make it download-as-a-file have to live on the object.
  const upload = await env.PHOTOS.createMultipartUpload(objectKey, {
    httpMetadata: {
      contentType: "application/zip",
      contentDisposition: `attachment; filename="${archiveName.replace(/"/g, "")}"`,
    },
  });

  const tracking: TrackingManifest = {
    galleryId,
    uploadId: upload.uploadId,
    objectKey,
    entries,
    partSize: PART_SIZE,
    totalSize: layout.totalSize,
    expectedParts,
    startedAt: Date.now(),
  };
  await env.PHOTOS.put(trackingKey(galleryId), JSON.stringify(tracking));

  // Queued in one batch, not chained — every part is independent, so there
  // is nothing to sequence. sendBatch caps at 100 messages; a gallery large
  // enough to need more parts than that is far beyond this project's scale
  // (docs/PLAN.md: ~500 photos/gallery), so the simple path is enough.
  const messages: PartMessage[] = Array.from({ length: expectedParts }, (_, partIndex) => ({
    body: { galleryId, partIndex },
  })).map((m) => m.body);
  for (let i = 0; i < messages.length; i += 100) {
    await env.PARTS.sendBatch(messages.slice(i, i + 100).map((body) => ({ body })));
  }

  return new Response(JSON.stringify({ uploadId: upload.uploadId, expectedParts }), {
    status: 202,
    headers: { "Content-Type": "application/json" },
  });
}

async function buildOnePart(message: PartMessage, env: Env): Promise<void> {
  const trackingObj = await env.PHOTOS.get(trackingKey(message.galleryId));
  if (!trackingObj) {
    // The build was invalidated (tracking object deleted by a sweep) after
    // this message was enqueued but before it was processed — nothing to do.
    return;
  }
  const tracking = JSON.parse(await trackingObj.text()) as TrackingManifest;

  const layout = buildZipLayout(toChunkEntries(tracking.entries));
  const plan = planPart(layout, message.partIndex, tracking.partSize);

  const pieces = await Promise.all(
    plan.pieces.map(async (piece) => {
      if ("bytes" in piece) return piece.bytes;
      const object = await env.PHOTOS.get(piece.key, {
        range: { offset: piece.rangeStart, length: piece.rangeLength },
      });
      if (!object) throw new Error(`source object missing: ${piece.key}`);
      return readAll(object.body);
    }),
  );

  const content = new Uint8Array(plan.rangeLength);
  let at = 0;
  for (const piece of pieces) {
    content.set(piece, at);
    at += piece.length;
  }

  const upload = env.PHOTOS.resumeMultipartUpload(tracking.objectKey, tracking.uploadId);
  const uploaded = await upload.uploadPart(plan.partNumber, content);
  await env.PHOTOS.put(partMarkerKey(message.galleryId, plan.partNumber), uploaded.etag);
}

async function sweepBuilds(env: Env): Promise<void> {
  const listed = await env.PHOTOS.list({ prefix: TRACKING_PREFIX });
  const trackingKeys = listed.objects
    .map((o) => o.key)
    .filter((key) => key.endsWith(".json") && !key.slice(TRACKING_PREFIX.length).includes("/"));

  // One gallery's failure (a bad callback, a transient R2 error) must not
  // stop the sweep from checking the rest.
  for (const key of trackingKeys) {
    await checkOneBuild(key, env).catch((error) => console.error("sweep step failed", key, error));
  }
}

async function checkOneBuild(key: string, env: Env): Promise<void> {
  const trackingObj = await env.PHOTOS.get(key);
  if (!trackingObj) return;
  const tracking = JSON.parse(await trackingObj.text()) as TrackingManifest;

  // The R2 object may already be complete and durable with only the
  // callback/cleanup left to retry — `complete()` must never be called
  // twice on the same upload id, so this branch is checked first and
  // unconditionally, before touching the multipart upload at all.
  const completedMarker = await env.PHOTOS.get(completedMarkerKey(tracking.galleryId));
  if (completedMarker) {
    await reportReadyAndCleanup(tracking, Number(await completedMarker.text()), env);
    return;
  }

  const partsPrefix = `${TRACKING_PREFIX}${tracking.galleryId}/parts/`;
  const parts = await env.PHOTOS.list({ prefix: partsPrefix });

  if (parts.objects.length >= tracking.expectedParts) {
    await finalizeBuild(
      tracking,
      parts.objects.map((o) => o.key),
      env,
    );
    return;
  }

  if (Date.now() - tracking.startedAt > STALE_MS) {
    await abandonBuild(tracking, env, "stale");
  }
}

async function finalizeBuild(
  tracking: TrackingManifest,
  partKeys: string[],
  env: Env,
): Promise<void> {
  try {
    const uploadedParts = await Promise.all(
      partKeys.map(async (key) => {
        const marker = await env.PHOTOS.get(key);
        if (!marker) throw new Error(`part marker vanished: ${key}`);
        const partNumber = Number(key.slice(key.lastIndexOf("/") + 1));
        return { partNumber, etag: await marker.text() };
      }),
    );
    uploadedParts.sort((a, b) => a.partNumber - b.partNumber);

    const upload = env.PHOTOS.resumeMultipartUpload(tracking.objectKey, tracking.uploadId);
    await upload.complete(uploadedParts);
  } catch (error) {
    // Nothing durable exists yet — safe to abort and report failed.
    console.error("finalize (complete) failed", tracking.galleryId, error);
    await abandonBuild(tracking, env, "finalize_error");
    return;
  }

  // The archive is real and durable in R2 from this point on. Every step
  // after this must be retryable without ever touching the multipart
  // upload again — hence writing this marker before anything that can fail.
  await env.PHOTOS.put(completedMarkerKey(tracking.galleryId), String(tracking.totalSize));
  await reportReadyAndCleanup(tracking, tracking.totalSize, env);
}

async function reportReadyAndCleanup(
  tracking: TrackingManifest,
  sizeBytes: number,
  env: Env,
): Promise<void> {
  try {
    await callback(env, {
      galleryId: tracking.galleryId,
      uploadId: tracking.uploadId,
      status: "ready",
      objectKey: tracking.objectKey,
      sizeBytes,
    });
  } catch {
    // Next sweep tick retries just this — the completed marker keeps it
    // from ever re-entering finalizeBuild.
    return;
  }
  await cleanupBuild(tracking, env);
}

async function abandonBuild(tracking: TrackingManifest, env: Env, reason: string): Promise<void> {
  try {
    await env.PHOTOS.resumeMultipartUpload(tracking.objectKey, tracking.uploadId).abort();
  } catch (error) {
    // Already aborted, or never had any parts — not worth failing over.
    console.error("abort failed (continuing)", tracking.galleryId, reason, error);
  }
  try {
    await callback(env, {
      galleryId: tracking.galleryId,
      uploadId: tracking.uploadId,
      status: "failed",
    });
  } catch {
    return; // next sweep tick retries the whole abandon path — idempotent
  }
  await cleanupBuild(tracking, env);
}

async function cleanupBuild(tracking: TrackingManifest, env: Env): Promise<void> {
  const partsPrefix = `${TRACKING_PREFIX}${tracking.galleryId}/parts/`;
  const parts = await env.PHOTOS.list({ prefix: partsPrefix });
  await Promise.all(parts.objects.map((o) => env.PHOTOS.delete(o.key)));
  await env.PHOTOS.delete(completedMarkerKey(tracking.galleryId));
  await env.PHOTOS.delete(trackingKey(tracking.galleryId));
}

async function callback(
  env: Env,
  payload: {
    galleryId: string;
    uploadId: string;
    status: "ready" | "failed";
    objectKey?: string;
    sizeBytes?: number;
  },
): Promise<void> {
  const response = await fetch(env.APP_CALLBACK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.ZIP_BUILD_CALLBACK_SECRET}`,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`callback rejected: ${response.status}`);
}

import {
  buildZipLayout,
  partCount,
  planPart,
  type ChunkEntry,
} from "../../src/lib/zip-chunk-layout";
import { verifyBuildManifest, type BuildManifestEntry } from "../../src/lib/zip-build-manifest";
import { assemblePart } from "../../src/lib/zip-part-assembly";

/**
 * Background "download all" ZIP builder (docs/TODO.md §7) — deliberately a
 * separate deployment from `../worker/` (the live streaming ZIP), which raises
 * its CPU limit with a [limits] override this one has no need of.
 *
 * The constraint that actually governs this Worker is **memory**: 128 MB per
 * isolate, shared by every consumer invocation Cloudflare chooses to run
 * concurrently. Everything here is written to hold one part's worth of bytes
 * at a time and no more (see `assemblePart`), and `wrangler.toml` caps batch
 * size and concurrency to match. Ignoring that is what took the archive down
 * on 2026-09-01.
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
  /** Names this build's bookkeeping. Per build, never per gallery — two builds
   * of one gallery overlap whenever an admin edit supersedes a running one. */
  buildId: string;
  partIndex: number;
}

interface TrackingManifest {
  galleryId: string;
  buildId: string;
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
/** A build that hasn't finished after this long is treated as dead, not slow — see failStaleZipBuilds on the app side for the matching state-machine half of this. */
const STALE_MS = 60 * 60 * 1000;

/**
 * Every key below is named by the build's own random id, never by the gallery.
 * Two reasons, both learned the hard way: this bucket is served publicly and
 * the tracking manifest lists every photo's key, so the name must be
 * unguessable; and two builds of one gallery overlap whenever an admin edit
 * supersedes a running build, so a per-gallery name made them share their
 * manifest and part markers — finalize could then complete one multipart
 * upload with etags belonging to the other.
 */
function trackingKey(buildId: string): string {
  return `${TRACKING_PREFIX}${buildId}.json`;
}

function partMarkerKey(buildId: string, partNumber: number): string {
  // Zero-padded so a lexicographic R2 list comes back in part order — not
  // load-bearing for correctness (every part is read regardless of order),
  // just makes debugging listings readable.
  return `${partsPrefix(buildId)}${String(partNumber).padStart(6, "0")}`;
}

/** Written the moment `completeMultipartUpload` succeeds — the one bit of
 * state that must survive a callback/cleanup failure, so a retry never calls
 * `complete()` a second time on an upload id R2 already considers finished. */
function completedMarkerKey(buildId: string): string {
  return `${TRACKING_PREFIX}${buildId}/completed`;
}

function partsPrefix(buildId: string): string {
  return `${TRACKING_PREFIX}${buildId}/parts/`;
}

/** How many part markers to read at once during finalize. */
const MARKER_READ_BATCH = 50;
/** R2 accepts up to 1000 keys in one delete. */
const DELETE_BATCH = 1000;

function toChunkEntries(entries: readonly BuildManifestEntry[]): ChunkEntry[] {
  return entries.map((e) => ({
    key: e.key,
    name: e.name,
    size: e.size,
    crc32: Number.parseInt(e.crc32, 16) >>> 0,
  }));
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
  const { galleryId, buildId, objectKey, archiveName, entries } = verified.manifest;

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
    buildId,
    uploadId: upload.uploadId,
    objectKey,
    entries,
    partSize: PART_SIZE,
    totalSize: layout.totalSize,
    expectedParts,
    startedAt: Date.now(),
  };
  await env.PHOTOS.put(trackingKey(buildId), JSON.stringify(tracking));

  // Queued in one batch, not chained — every part is independent, so there
  // is nothing to sequence. sendBatch caps at 100 messages; a gallery large
  // enough to need more parts than that is far beyond this project's scale
  // (docs/PLAN.md: ~500 photos/gallery), so the simple path is enough.
  const messages: PartMessage[] = Array.from({ length: expectedParts }, (_, partIndex) => ({
    galleryId,
    buildId,
    partIndex,
  }));
  for (let i = 0; i < messages.length; i += 100) {
    await env.PARTS.sendBatch(messages.slice(i, i + 100).map((body) => ({ body })));
  }

  return new Response(JSON.stringify({ uploadId: upload.uploadId, expectedParts }), {
    status: 202,
    headers: { "Content-Type": "application/json" },
  });
}

async function buildOnePart(message: PartMessage, env: Env): Promise<void> {
  const trackingObj = await env.PHOTOS.get(trackingKey(message.buildId));
  if (!trackingObj) {
    // This build was invalidated after the message was enqueued: either a
    // sweep cleaned it up, or the app deleted the tracking object because an
    // admin changed the gallery's photos and superseded it. Either way the
    // result would be thrown away, so stop rather than spend the read.
    return;
  }
  const tracking = JSON.parse(await trackingObj.text()) as TrackingManifest;

  const layout = buildZipLayout(toChunkEntries(tracking.entries));
  const plan = planPart(layout, message.partIndex, tracking.partSize);

  // One buffer, one source range in flight at a time (zip-part-assembly.ts).
  // Buffering each piece first and concatenating afterwards is what put ~3x the
  // part size on the heap and killed the isolate; see that module's header.
  const content = await assemblePart(plan, async (ref) => {
    const object = await env.PHOTOS.get(ref.key, {
      range: { offset: ref.rangeStart, length: ref.rangeLength },
    });
    if (!object) throw new Error(`source object missing: ${ref.key}`);
    return object.body;
  });

  const upload = env.PHOTOS.resumeMultipartUpload(tracking.objectKey, tracking.uploadId);
  const uploaded = await upload.uploadPart(plan.partNumber, content);
  await env.PHOTOS.put(partMarkerKey(message.buildId, plan.partNumber), uploaded.etag);
}

/**
 * Every key under `prefix`, following R2's cursor. `list` caps a page at 1000,
 * and a gallery big enough to need more than 1000 parts would otherwise look
 * to the sweep like a build that is permanently one part short — it would
 * never finalize, and would be abandoned an hour later, forever.
 */
async function listAllKeys(env: Env, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.PHOTOS.list({ prefix, cursor });
    for (const object of page.objects) keys.push(object.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys;
}

async function sweepBuilds(env: Env): Promise<void> {
  const trackingKeys = (await listAllKeys(env, TRACKING_PREFIX)).filter(
    (key) => key.endsWith(".json") && !key.slice(TRACKING_PREFIX.length).includes("/"),
  );

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
  const completedMarker = await env.PHOTOS.get(completedMarkerKey(tracking.buildId));
  if (completedMarker) {
    await reportReadyAndCleanup(tracking, Number(await completedMarker.text()), env);
    return;
  }

  const partKeys = await listAllKeys(env, partsPrefix(tracking.buildId));

  if (partKeys.length >= tracking.expectedParts) {
    await finalizeBuild(tracking, partKeys, env);
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
    // In bounded batches rather than one `Promise.all` over every key: a large
    // gallery has hundreds of markers, and firing hundreds of concurrent R2
    // reads is both a subrequest-burst and a pile of live response objects in
    // the same 128 MB isolate this Worker is otherwise careful about.
    const uploadedParts: { partNumber: number; etag: string }[] = [];
    for (let i = 0; i < partKeys.length; i += MARKER_READ_BATCH) {
      const batch = await Promise.all(
        partKeys.slice(i, i + MARKER_READ_BATCH).map(async (key) => {
          const marker = await env.PHOTOS.get(key);
          if (!marker) throw new Error(`part marker vanished: ${key}`);
          const partNumber = Number(key.slice(key.lastIndexOf("/") + 1));
          return { partNumber, etag: await marker.text() };
        }),
      );
      uploadedParts.push(...batch);
    }
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
  await env.PHOTOS.put(completedMarkerKey(tracking.buildId), String(tracking.totalSize));
  await reportReadyAndCleanup(tracking, tracking.totalSize, env);
}

async function reportReadyAndCleanup(
  tracking: TrackingManifest,
  sizeBytes: number,
  env: Env,
): Promise<void> {
  let applied: boolean;
  try {
    applied = await callback(env, {
      galleryId: tracking.galleryId,
      buildId: tracking.buildId,
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

  // Superseded: an admin changed the gallery's photos while this was building,
  // so the app is no longer naming this build and nothing will ever point at
  // the object. Each build writes its own key, so deleting it is safe — the
  // archive the gallery is actually serving is a different object entirely.
  if (!applied) {
    console.log("build superseded, discarding its archive", tracking.buildId, tracking.objectKey);
    await env.PHOTOS.delete(tracking.objectKey).catch((error) =>
      console.error("could not delete superseded archive", tracking.objectKey, error),
    );
  }
  await cleanupBuild(tracking, env);
}

async function abandonBuild(tracking: TrackingManifest, env: Env, reason: string): Promise<void> {
  // An abort that does not stick leaves an incomplete multipart upload in R2
  // holding every part already written (698 MB, in the 2026-09-01 case) and
  // billed as stored data — and once the tracking object below is deleted,
  // nothing in this Worker knows the upload exists any more. So: retry it, and
  // if it still will not go, say so in a form that can be grepped for. The
  // bucket's lifecycle rule (docs/SETUP.md §10) is the backstop that actually
  // guarantees these get reaped.
  let aborted = false;
  for (let attempt = 0; attempt < 2 && !aborted; attempt += 1) {
    try {
      await env.PHOTOS.resumeMultipartUpload(tracking.objectKey, tracking.uploadId).abort();
      aborted = true;
    } catch (error) {
      console.error("abort failed", tracking.galleryId, reason, attempt, error);
    }
  }
  if (!aborted) {
    console.error("ORPHANED MULTIPART UPLOAD", tracking.objectKey, tracking.uploadId);
  }
  try {
    await callback(env, {
      galleryId: tracking.galleryId,
      buildId: tracking.buildId,
      uploadId: tracking.uploadId,
      status: "failed",
    });
  } catch {
    return; // next sweep tick retries the whole abandon path — idempotent
  }
  await cleanupBuild(tracking, env);
}

async function cleanupBuild(tracking: TrackingManifest, env: Env): Promise<void> {
  // R2's delete takes up to 1000 keys per call — one subrequest per marker
  // would be hundreds of them for a large gallery, in an invocation that has
  // other work to do. The tracking object goes last, and on its own: while it
  // exists this whole path is retryable, and once it is gone the build is
  // forgotten.
  const keys = await listAllKeys(env, partsPrefix(tracking.buildId));
  keys.push(completedMarkerKey(tracking.buildId));
  for (let i = 0; i < keys.length; i += DELETE_BATCH) {
    await env.PHOTOS.delete(keys.slice(i, i + DELETE_BATCH));
  }
  await env.PHOTOS.delete(trackingKey(tracking.buildId));
}

/** Returns whether the app accepted this build, or false if it was superseded. */
async function callback(
  env: Env,
  payload: {
    galleryId: string;
    buildId: string;
    uploadId: string;
    status: "ready" | "failed";
    objectKey?: string;
    sizeBytes?: number;
  },
): Promise<boolean> {
  const response = await fetch(env.APP_CALLBACK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.ZIP_BUILD_CALLBACK_SECRET}`,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`callback rejected: ${response.status}`);
  const body = (await response.json()) as { applied?: boolean };
  return body.applied === true;
}

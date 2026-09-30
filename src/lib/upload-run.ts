"use client";

import { classifyContentType } from "@/lib/upload-content-types";
import { makeThumbnail } from "@/lib/thumbnail";
import { prepareUploadOffMainThread } from "@/lib/upload-prepare-client";

/**
 * The browser half of the upload pipeline, shared by the photographer's
 * uploader and the guest one (docs/GUEST-GALLERIES.md §6).
 *
 * Both go browser -> R2 by presigned PUT; Vercel only signs, because it has a
 * hard 4.5 MB body limit and image bytes never pass through it (invariant 1).
 * The only thing that differs between the two callers is what authorises the
 * presign call, which is why that is the one parameter here.
 *
 * Presigning is just-in-time in small batches: presigned URLs expire in ~15
 * minutes while a 500-photo session runs far longer (docs/PLAN.md §5).
 */
const PRESIGN_BATCH = 8;
// Four parallel PUTs saturate a home uplink; more only slows every file down
// and makes each failure costlier (browsers cap HTTP/1.1 at ~6 per host, and
// the thumbnail PUTs share that host).
const CONCURRENCY = 4;
const MAX_RETRIES = 3;

export type UploadCredentials =
  | { kind: "owner"; galleryId: string }
  | {
      kind: "guest";
      shareToken: string;
      anonKey: string | null;
      /** Sent with presign only — see `resolveGuestUpload`. */
      displayName?: string | null;
    };

export type UploadItemState = "pending" | "uploading" | "done" | "error";

/**
 * A refusal the server gave a reason for, kept as a code so the UI can say
 * something true in the viewer's language instead of showing an HTTP status.
 */
export class UploadRejection extends Error {
  constructor(
    readonly code:
      | "unsupported_type"
      | "quota_exceeded"
      | "file_too_large"
      | "upload_denied"
      | "unauthorized"
      | "rate_limited"
      | "size_mismatch"
      | "network",
    readonly detail: {
      reason?: string;
      fileName?: string;
      remaining?: number;
      maxBytes?: number;
      status?: number;
      retryAfterSeconds?: number;
    } = {},
  ) {
    super(code);
    this.name = "UploadRejection";
  }
}

/** Codes that end the whole run: retrying the next batch would fail identically. */
// `rate_limited` belongs here even though the ceiling clears on its own: the
// retry backoff tops out around three seconds against a sixty-second window,
// so retrying only burns the remaining files against a limit that has not
// moved. Ending the run and saying so is the honest outcome — the guest picks
// the photos again in a minute. `size_mismatch` is deliberately NOT fatal: a
// truncated PUT is exactly what a retry fixes.
const FATAL_CODES = new Set(["quota_exceeded", "upload_denied", "unauthorized", "rate_limited"]);

export interface PresignedUpload {
  photoId: string;
  objectKey: string;
  url: string;
  headers: Record<string, string>;
  /** Where a grid thumbnail may go, one signed target per format. */
  thumbTargets?: Partial<Record<"webp" | "jpeg", { url: string; headers: Record<string, string> }>>;
}

function credentialFields(credentials: UploadCredentials): Record<string, unknown> {
  return credentials.kind === "owner"
    ? { galleryId: credentials.galleryId }
    : { shareToken: credentials.shareToken, anonKey: credentials.anonKey };
}

/**
 * Rows left behind by an interrupted upload (docs/PLAN.md §5). Resolves to an
 * empty list on any failure: resume is an affordance, not a requirement, and a
 * guest on a bad connection must not see an error for it.
 */
export function fetchPendingUploads(
  credentials: UploadCredentials,
  signal?: AbortSignal,
): Promise<PendingRow[]> {
  return fetch(`/api/uploads/pending?${pendingQuery(credentials)}`, { signal })
    .then((response) => (response.ok ? response.json() : { pending: [] }))
    .then((data: { pending: PendingRow[] }) => data.pending)
    .catch(() => []);
}

/** Mirrors `PendingUpload` in src/lib/upload-resume.ts. */
interface PendingRow {
  id: string;
  fileName: string;
  sizeBytes: number | null;
}

/** Query string for the pending-uploads lookup, which is a GET. */
export function pendingQuery(credentials: UploadCredentials): string {
  const params = new URLSearchParams();
  if (credentials.kind === "owner") params.set("galleryId", credentials.galleryId);
  else {
    params.set("shareToken", credentials.shareToken);
    if (credentials.anonKey) params.set("anonKey", credentials.anonKey);
  }
  return params.toString();
}

async function rejectionFrom(response: Response): Promise<UploadRejection> {
  const body = (await response.json().catch(() => null)) as {
    error?: string;
    reason?: string;
    fileName?: string;
    remaining?: number;
    maxBytes?: number;
    retryAfterSeconds?: number;
  } | null;

  const code = body?.error;
  if (
    code === "unsupported_type" ||
    code === "quota_exceeded" ||
    code === "file_too_large" ||
    code === "upload_denied" ||
    code === "unauthorized" ||
    code === "rate_limited" ||
    code === "size_mismatch"
  ) {
    return new UploadRejection(code, { ...body, status: response.status });
  }
  return new UploadRejection("network", { status: response.status });
}

async function presign(
  credentials: UploadCredentials,
  files: File[],
  resumeIds: (string | undefined)[],
  signal?: AbortSignal,
): Promise<PresignedUpload[]> {
  const response = await fetch("/api/uploads/presign", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...credentialFields(credentials),
      ...(credentials.kind === "guest" && credentials.displayName
        ? { displayName: credentials.displayName }
        : {}),
      files: files.map((f, i) => ({
        fileName: f.name,
        contentType: f.type || "image/jpeg",
        sizeBytes: f.size,
        resumePhotoId: resumeIds[i],
      })),
    }),
  });
  if (!response.ok) throw await rejectionFrom(response);
  const data = (await response.json()) as { uploads: PresignedUpload[] };
  return data.uploads;
}

/**
 * The original goes up by XHR, not fetch: `upload.onprogress` is the only
 * byte-level upload progress every browser has. Streaming fetch bodies
 * (`duplex: "half"`) are Chromium-only and report what was buffered, not what
 * was sent. Headers must match what was signed, byte for byte; the browser
 * sets Content-Length from the Blob.
 */
function putWithProgress(
  url: string,
  headers: Record<string, string>,
  body: Blob,
  signal: AbortSignal | undefined,
  onProgress: (sent: number) => void,
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const xhr = new XMLHttpRequest();
    // Listener before open()/send(), or some engines never fire it.
    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    const onAbort = () => xhr.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const settle = () => signal?.removeEventListener("abort", onAbort);
    xhr.onload = () => {
      settle();
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.getResponseHeader("etag"));
      else if (xhr.status === 403) reject(new SignatureExpired());
      else reject(new Error(`R2 PUT failed (${xhr.status})`));
    };
    xhr.onerror = () => {
      settle();
      reject(new Error("R2 PUT failed (network)"));
    };
    xhr.onabort = () => {
      settle();
      reject(abortError());
    };
    xhr.send(body);
  });
}

/**
 * R2 answers 403 once a presigned URL is past its 15 minutes. Retrying the same
 * URL cannot help; the caller signs the file again (see `runUploads`).
 */
class SignatureExpired extends Error {
  constructor() {
    super("R2 PUT failed (403)");
    this.name = "SignatureExpired";
  }
}

const sleep = (ms: number, signal: AbortSignal | undefined) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(abortError());
      },
      { once: true },
    );
  });

function abortError(): DOMException {
  return new DOMException("Upload cancelled", "AbortError");
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function uploadOne(
  file: File,
  target: PresignedUpload,
  credentials: UploadCredentials,
  signal: AbortSignal | undefined,
  onBytes: (sent: number) => void,
): Promise<void> {
  // GPS strip, capture time, CRC32, dimensions and placeholder colour — off
  // the main thread where a worker can run (src/lib/upload-prepare-client.ts).
  const { body, crc32, takenAt, width, height, placeholder, picks } =
    await prepareUploadOffMainThread(file);
  // Null on any device that cannot produce one — the grid then falls back to a
  // Cloudflare transformation of the original, exactly as before.
  //
  // `credentials.kind` is already the owner/guest split this whole module turns
  // on — the same branch the presign route uses to stamp `Photo.source` — so
  // the thumbnail profile rides on it rather than on a second flag that could
  // disagree with it. Owner uploads land in a desktop grid and get a bigger,
  // slightly less compressed tile; guest uploads are unchanged.
  const thumbnail = target.thumbTargets ? await makeThumbnail(body, credentials.kind) : null;
  if (signal?.aborted) throw abortError();

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (signal?.aborted) throw abortError();
    try {
      // A retry starts the file from zero; the overall bar must not count the
      // failed attempt's bytes twice.
      onBytes(0);
      const etag = await putWithProgress(target.url, target.headers, body, signal, onBytes);

      // Best-effort and deliberately after the original: the photo is what
      // matters, and a failed thumbnail must never cost someone their upload.
      // From here on the file finishes even if the run is cancelled — the
      // original is already in R2, and dropping the confirm would mean sending
      // all of it again on retry.
      let thumbStored: "webp" | "jpeg" | null = null;
      const thumbTarget = thumbnail && target.thumbTargets?.[thumbnail.format];
      if (thumbnail && thumbTarget) {
        try {
          const thumbPut = await fetch(thumbTarget.url, {
            method: "PUT",
            headers: thumbTarget.headers,
            body: thumbnail.blob,
          });
          if (thumbPut.ok) thumbStored = thumbnail.format;
        } catch {
          thumbStored = null;
        }
      }

      const confirm = await fetch("/api/uploads/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...credentialFields(credentials),
          photoId: target.photoId,
          etag: etag ?? "unknown",
          crc32,
          sizeBytes: body.size,
          width: width ?? undefined,
          height: height ?? undefined,
          placeholder,
          thumb: thumbStored,
          takenAt: takenAt?.toISOString(),
          // A packet without a rating is 0★; no packet at all stays unknown.
          xmpRating: picks?.rating,
          xmpLabel: picks?.label ?? undefined,
          xmpHighlight: picks?.tagged || undefined,
        }),
      });
      if (!confirm.ok) throw await rejectionFrom(confirm);
      return;
    } catch (error) {
      lastError = error;
      if (isAbort(error) || error instanceof SignatureExpired) throw error;
      // A refusal with a reason will not become an acceptance on retry.
      if (error instanceof UploadRejection && FATAL_CODES.has(error.code)) throw error;
      await sleep(2 ** attempt * 500, signal);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("upload failed");
}

/** Error string for a file stopped by `signal` — lets the UI offer it for retry. */
export const CANCELLED = "cancelled";

export interface UploadRunOptions {
  files: File[];
  credentials: UploadCredentials;
  /** Per-file id of a PENDING row to re-use, from `matchResumeTargets`. */
  resumeIds: (string | undefined)[];
  onItem: (index: number, patch: { state: UploadItemState; error?: string }) => void;
  /** A refusal that ends the run — quota, revoked link, lost session. */
  onFatal: (rejection: UploadRejection) => void;
  /** Files skipped before the run started. The rest still upload. */
  onSkipped?: (rejection: UploadRejection, count: number) => void;
  /**
   * Bytes of the original sent so far, many times a second. Keep it out of
   * React state — a ref repainted on a timer — or 2 000 files will jank.
   */
  onBytes?: (index: number, sent: number) => void;
  /** Aborts in-flight PUTs; everything unfinished ends as `error` / `CANCELLED`. */
  signal?: AbortSignal;
}

interface Job {
  index: number;
  target: PresignedUpload;
}

/** Resolves when every file has reached `done` or `error`, or the run was cut short. */
export async function runUploads({
  files,
  credentials,
  resumeIds,
  onItem,
  onFatal,
  onSkipped,
  onBytes,
  signal,
}: UploadRunOptions): Promise<void> {
  // Unsupported files are dropped here rather than left for the server, which
  // validates a presign batch as a whole: one HEIC among eight photos would
  // otherwise fail all eight. Somebody picking forty shots off an iPhone can
  // easily have three of them in a format we cannot store, and losing the
  // other thirty-seven to that is not a trade anyone would accept at 11pm.
  // The server still checks — this is a better failure, not the only one.
  const queue: number[] = [];
  let firstSkip: UploadRejection | null = null;
  let skipped = 0;

  files.forEach((file, index) => {
    const verdict = classifyContentType(file.type || "image/jpeg");
    if (verdict.ok) {
      queue.push(index);
      return;
    }
    skipped += 1;
    const rejection = new UploadRejection("unsupported_type", {
      reason: verdict.reason,
      fileName: file.name,
    });
    firstSkip ??= rejection;
    onItem(index, { state: "error", error: `unsupported_type:${verdict.reason}` });
  });

  if (firstSkip) onSkipped?.(firstSkip, skipped);
  if (queue.length === 0) return;

  // Rolling pool: workers pull the next signed file the moment they are free,
  // and the next presign starts in the background while signed targets are
  // still queued. The old "sign 8, upload 8, wait for the slowest" loop left
  // slots idle at the tail of every batch and during every presign round-trip.
  // At most CONCURRENCY - 1 + CONCURRENCY signed files wait (under two upload
  // rounds); on a very slow uplink a URL can still expire, and that file is
  // simply signed again.
  const settled = new Set<number>();
  const settle = (index: number, patch: { state: UploadItemState; error?: string }) => {
    if (patch.state === "done" || patch.state === "error") settled.add(index);
    onItem(index, patch);
  };

  const toSign = [...queue];
  const signed: Job[] = [];
  let signing: Promise<void> | null = null;
  let fatal: UploadRejection | null = null;

  const topUp = () => {
    if (signing || fatal || signal?.aborted || toSign.length === 0) return;
    if (signed.length >= CONCURRENCY) return;
    const indices = toSign.splice(0, Math.min(PRESIGN_BATCH, CONCURRENCY));
    signing = presign(
      credentials,
      indices.map((index) => files[index]!),
      indices.map((index) => resumeIds[index]),
      signal,
    )
      .then((targets) =>
        indices.forEach((index, position) => {
          const target = targets[position];
          if (target) signed.push({ index, target });
          else settle(index, { state: "error", error: "no presigned target" });
        }),
      )
      .catch((error: unknown) => {
        // Cancelled: the leftover pass below marks these files CANCELLED.
        if (isAbort(error)) return;
        if (error instanceof UploadRejection && FATAL_CODES.has(error.code)) {
          fatal = error;
          return;
        }
        const message = error instanceof UploadRejection ? error.code : (error as Error).message;
        indices.forEach((index) => settle(index, { state: "error", error: message }));
        if (error instanceof UploadRejection) onFatal(error);
      })
      .finally(() => {
        signing = null;
      });
  };

  const next = async (): Promise<Job | null> => {
    for (;;) {
      if (fatal || signal?.aborted) return null;
      topUp();
      const job = signed.shift();
      if (job) {
        topUp();
        return job;
      }
      if (!signing) return null;
      await signing;
    }
  };

  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let job = await next(); job; job = await next()) {
      const { index } = job;
      let { target } = job;
      settle(index, { state: "uploading" });
      try {
        const progress = (sent: number) => onBytes?.(index, sent);
        try {
          await uploadOne(files[index]!, target, credentials, signal, progress);
        } catch (error) {
          if (!(error instanceof SignatureExpired)) throw error;
          // Re-sign the same row (resumePhotoId) — no duplicate photo is created.
          const [fresh] = await presign(credentials, [files[index]!], [target.photoId], signal);
          if (!fresh) throw error;
          target = fresh;
          await uploadOne(files[index]!, target, credentials, signal, progress);
        }
        settle(index, { state: "done" });
      } catch (error) {
        if (error instanceof UploadRejection && FATAL_CODES.has(error.code)) fatal ??= error;
        settle(index, {
          state: "error",
          error: isAbort(error)
            ? CANCELLED
            : error instanceof UploadRejection
              ? error.code
              : (error as Error).message,
        });
      }
    }
  });
  await Promise.all(workers);
  // A presign still in flight would otherwise report into a run that has
  // already ended — or into the next one, which reuses the same indices.
  while (signing) await signing;

  // Everything that never started is marked so the list does not sit on
  // "pending" forever with no explanation.
  const leftover = fatal ? undefined : signal?.aborted ? CANCELLED : undefined;
  for (const index of queue)
    if (!settled.has(index)) settle(index, { state: "error", error: leftover });
  if (fatal) onFatal(fatal);
}

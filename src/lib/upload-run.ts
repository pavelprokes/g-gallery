"use client";

import { crc32HexOfBlob } from "@/lib/crc32";
import { classifyContentType } from "@/lib/upload-content-types";
import { stripGpsFromFile } from "@/lib/exif-gps";
import { averageColorOf } from "@/lib/placeholder";

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
const CONCURRENCY = 3;
const MAX_RETRIES = 3;

export type UploadCredentials =
  | { kind: "owner"; galleryId: string }
  | { kind: "guest"; shareToken: string; anonKey: string | null };

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
      | "network",
    readonly detail: {
      reason?: string;
      fileName?: string;
      remaining?: number;
      maxBytes?: number;
      status?: number;
    } = {},
  ) {
    super(code);
    this.name = "UploadRejection";
  }
}

/** Codes that end the whole run: retrying the next batch would fail identically. */
const FATAL_CODES = new Set(["quota_exceeded", "upload_denied", "unauthorized"]);

export interface PresignedUpload {
  photoId: string;
  objectKey: string;
  url: string;
  headers: Record<string, string>;
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
  } | null;

  const code = body?.error;
  if (
    code === "unsupported_type" ||
    code === "quota_exceeded" ||
    code === "file_too_large" ||
    code === "upload_denied" ||
    code === "unauthorized"
  ) {
    return new UploadRejection(code, { ...body, status: response.status });
  }
  return new UploadRejection("network", { status: response.status });
}

async function presign(
  credentials: UploadCredentials,
  files: File[],
  resumeIds: (string | undefined)[],
): Promise<PresignedUpload[]> {
  const response = await fetch("/api/uploads/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...credentialFields(credentials),
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

/** Dimensions drive the justified gallery layout; failure is non-fatal. */
async function readDimensions(blob: Blob): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

async function uploadOne(
  file: File,
  target: PresignedUpload,
  credentials: UploadCredentials,
): Promise<void> {
  // GPS is stripped before the bytes ever leave the browser, and the CRC32 is
  // computed on the exact bytes that get stored so the ZIP writer can trust it.
  const body = await stripGpsFromFile(file);
  const crc32 = await crc32HexOfBlob(body);
  const dimensions = await readDimensions(body);
  // Cosmetic, so a failure here never blocks the upload.
  const placeholder = await averageColorOf(body);

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const put = await fetch(target.url, {
        method: "PUT",
        // Headers must match what was signed, byte for byte.
        headers: target.headers,
        body,
      });
      if (!put.ok) throw new Error(`R2 PUT failed (${put.status})`);

      const confirm = await fetch("/api/uploads/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...credentialFields(credentials),
          photoId: target.photoId,
          etag: put.headers.get("etag") ?? "unknown",
          crc32,
          sizeBytes: body.size,
          width: dimensions?.width,
          height: dimensions?.height,
          placeholder,
        }),
      });
      if (!confirm.ok) throw await rejectionFrom(confirm);
      return;
    } catch (error) {
      lastError = error;
      // A refusal with a reason will not become an acceptance on retry.
      if (error instanceof UploadRejection && FATAL_CODES.has(error.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 500));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("upload failed");
}

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
}

/** Resolves when every file has reached `done` or `error`, or the run was cut short. */
export async function runUploads({
  files,
  credentials,
  resumeIds,
  onItem,
  onFatal,
  onSkipped,
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

  for (let offset = 0; offset < queue.length; offset += PRESIGN_BATCH) {
    const indices = queue.slice(offset, offset + PRESIGN_BATCH);
    const batch = indices.map((index) => files[index]!);
    let targets: PresignedUpload[];
    try {
      targets = await presign(
        credentials,
        batch,
        indices.map((index) => resumeIds[index]),
      );
    } catch (error) {
      if (error instanceof UploadRejection && FATAL_CODES.has(error.code)) {
        onFatal(error);
        // Everything still queued is marked so the list does not sit on
        // "pending" forever with no explanation.
        for (const index of queue.slice(offset)) onItem(index, { state: "error" });
        return;
      }
      const message = error instanceof UploadRejection ? error.code : (error as Error).message;
      indices.forEach((index) => onItem(index, { state: "error", error: message }));
      if (error instanceof UploadRejection) onFatal(error);
      continue;
    }

    // Bounded concurrency: a shared cursor over this batch.
    let cursor = 0;
    let fatal: UploadRejection | null = null;
    const workers = Array.from({ length: Math.min(CONCURRENCY, batch.length) }, async () => {
      for (;;) {
        if (fatal) return;
        const local = cursor++;
        if (local >= batch.length) return;
        const index = indices[local]!;
        const file = batch[local]!;
        const target = targets[local];
        if (!target) {
          onItem(index, { state: "error", error: "no presigned target" });
          continue;
        }
        onItem(index, { state: "uploading" });
        try {
          await uploadOne(file, target, credentials);
          onItem(index, { state: "done" });
        } catch (error) {
          if (error instanceof UploadRejection && FATAL_CODES.has(error.code)) fatal = error;
          onItem(index, {
            state: "error",
            error: error instanceof UploadRejection ? error.code : (error as Error).message,
          });
        }
      }
    });
    await Promise.all(workers);

    if (fatal) {
      onFatal(fatal);
      for (const index of queue.slice(offset + batch.length)) onItem(index, { state: "error" });
      return;
    }
  }
}

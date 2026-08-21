"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { crc32HexOfBlob } from "@/lib/crc32";
import { stripGpsFromFile } from "@/lib/exif-gps";
import { matchResumeTargets, type PendingUpload } from "@/lib/upload-resume";
import { FORMS, pluralize } from "@/lib/czech-plural";

// Uploads go browser -> R2 directly; Vercel only signs (4.5MB body limit).
// Presigning is just-in-time in small batches because presigned URLs expire in
// ~15 minutes while a 500-photo session runs far longer (docs/PLAN.md §5).
const PRESIGN_BATCH = 8;
const CONCURRENCY = 3;
const MAX_RETRIES = 3;

type FileState = "pending" | "uploading" | "done" | "error";

interface Item {
  file: File;
  state: FileState;
  error?: string;
}

interface PresignedUpload {
  photoId: string;
  objectKey: string;
  url: string;
  headers: Record<string, string>;
}

async function presign(
  galleryId: string,
  files: File[],
  resumeIds: (string | undefined)[],
): Promise<PresignedUpload[]> {
  const response = await fetch("/api/uploads/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      galleryId,
      files: files.map((f, i) => ({
        fileName: f.name,
        contentType: f.type || "image/jpeg",
        sizeBytes: f.size,
        resumePhotoId: resumeIds[i],
      })),
    }),
  });
  if (!response.ok) throw new Error(`presign failed (${response.status})`);
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

async function uploadOne(file: File, target: PresignedUpload): Promise<void> {
  // GPS is stripped before the bytes ever leave the browser, and the CRC32 is
  // computed on the exact bytes that get stored so the future ZIP writer can
  // trust it.
  const body = await stripGpsFromFile(file);
  const crc32 = await crc32HexOfBlob(body);
  const dimensions = await readDimensions(body);

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
          photoId: target.photoId,
          etag: put.headers.get("etag") ?? "unknown",
          crc32,
          sizeBytes: body.size,
          width: dimensions?.width,
          height: dimensions?.height,
        }),
      });
      if (!confirm.ok) throw new Error(`confirm failed (${confirm.status})`);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 500));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("upload failed");
}

export function Uploader({ galleryId }: { galleryId: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [pendingRows, setPendingRows] = useState<PendingUpload[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Rows left behind by an interrupted upload. Re-picking those exact files
  // reuses the rows instead of creating a second set (src/lib/upload-resume.ts).
  const loadPending = useCallback(async () => {
    try {
      const response = await fetch(`/api/uploads/pending?galleryId=${galleryId}`);
      if (!response.ok) return;
      const data = (await response.json()) as { pending: PendingUpload[] };
      setPendingRows(data.pending);
    } catch {
      // Resume is an affordance, not a requirement — a failure here is silent.
    }
  }, [galleryId]);

  useEffect(() => {
    void loadPending();
  }, [loadPending]);

  const update = useCallback((index: number, patch: Partial<Item>) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }, []);

  const start = useCallback(
    async (files: File[]) => {
      setItems(files.map((file) => ({ file, state: "pending" as const })));
      setRunning(true);

      // Computed once for the whole selection: each pending row may be claimed
      // by only one file, which a per-batch match could not guarantee.
      const resumeIds = matchResumeTargets(files, pendingRows);

      for (let offset = 0; offset < files.length; offset += PRESIGN_BATCH) {
        const batch = files.slice(offset, offset + PRESIGN_BATCH);
        let targets: PresignedUpload[];
        try {
          targets = await presign(
            galleryId,
            batch,
            resumeIds.slice(offset, offset + PRESIGN_BATCH),
          );
        } catch (error) {
          batch.forEach((_, i) =>
            update(offset + i, { state: "error", error: (error as Error).message }),
          );
          continue;
        }

        // Bounded concurrency: a shared cursor over this batch.
        let cursor = 0;
        const workers = Array.from({ length: Math.min(CONCURRENCY, batch.length) }, async () => {
          for (;;) {
            const local = cursor++;
            if (local >= batch.length) return;
            const index = offset + local;
            const file = batch[local]!;
            const target = targets[local];
            if (!target) {
              update(index, { state: "error", error: "no presigned target" });
              continue;
            }
            update(index, { state: "uploading" });
            try {
              await uploadOne(file, target);
              update(index, { state: "done" });
            } catch (error) {
              update(index, { state: "error", error: (error as Error).message });
            }
          }
        });
        await Promise.all(workers);
      }

      setRunning(false);
      // Photos only become visible once the server flips them to CONFIRMED, so
      // the grid above is stale until the Server Component re-renders.
      router.refresh();
      void loadPending();
    },
    [galleryId, loadPending, pendingRows, router, update],
  );

  const done = items.filter((i) => i.state === "done").length;
  const failed = items.filter((i) => i.state === "error").length;

  return (
    <section className="rounded-lg border p-4">
      <h2 className="text-sm font-medium">Nahrát fotky</h2>

      {pendingRows.length > 0 && !running && (
        <div className="mt-3 rounded border border-amber-400 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
          <p className="font-medium">{pluralize(pendingRows.length, FORMS.upload)}</p>
          <p className="mt-1 text-xs">
            Vyber ty samé soubory znovu — naváže se na ně a nevzniknou duplicity. Neobnovené zbytky
            se po 24 hodinách uklidí samy.
          </p>
          <ul className="mt-2 max-h-24 overflow-y-auto text-xs text-neutral-600 dark:text-neutral-400">
            {pendingRows.map((row) => (
              <li key={row.id}>
                {row.fileName}
                {row.sizeBytes !== null && ` · ${(row.sizeBytes / 1024 / 1024).toFixed(1)} MB`}
              </li>
            ))}
          </ul>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        disabled={running}
        className="mt-3 block w-full text-sm"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length > 0) void start(files);
        }}
      />

      {items.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-neutral-500">
            {done}/{items.length} nahráno
            {failed > 0 && <span className="text-red-600"> · {failed} selhalo</span>}
          </p>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
            <div
              className="h-full bg-neutral-900 transition-all dark:bg-neutral-100"
              style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }}
            />
          </div>
          {failed > 0 && (
            <ul className="max-h-32 overflow-y-auto text-xs text-red-600">
              {items
                .map((item, index) => ({ item, index }))
                .filter(({ item }) => item.state === "error")
                .map(({ item, index }) => (
                  <li key={index}>
                    {item.file.name}: {item.error}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

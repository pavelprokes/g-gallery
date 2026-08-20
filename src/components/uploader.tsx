"use client";

import { useCallback, useRef, useState } from "react";
import { crc32HexOfBlob } from "@/lib/crc32";
import { stripGpsFromFile } from "@/lib/exif-gps";

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

async function presign(galleryId: string, files: File[]): Promise<PresignedUpload[]> {
  const response = await fetch("/api/uploads/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      galleryId,
      files: files.map((f) => ({
        fileName: f.name,
        contentType: f.type || "image/jpeg",
        sizeBytes: f.size,
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
  const inputRef = useRef<HTMLInputElement>(null);

  const update = useCallback((index: number, patch: Partial<Item>) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }, []);

  const start = useCallback(
    async (files: File[]) => {
      setItems(files.map((file) => ({ file, state: "pending" as const })));
      setRunning(true);

      for (let offset = 0; offset < files.length; offset += PRESIGN_BATCH) {
        const batch = files.slice(offset, offset + PRESIGN_BATCH);
        let targets: PresignedUpload[];
        try {
          targets = await presign(galleryId, batch);
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
    },
    [galleryId, update],
  );

  const done = items.filter((i) => i.state === "done").length;
  const failed = items.filter((i) => i.state === "error").length;

  return (
    <section className="rounded-lg border p-4">
      <h2 className="text-sm font-medium">Nahrát fotky</h2>

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

"use client";

// The page's side of the face worker (face-worker.ts, docs/SOCIAL-VIDEO.md §4).
// The worker — and the ~30 MB of WASM and models behind it — is started on the
// first photo and lives until `close`.

import type { PhotoFaces } from "@/lib/social-video/faces";

export interface FaceRequest {
  id: number;
  /** The photo's compressed bytes, as fetched — the worker decodes them. */
  photo: Blob;
}

export type FaceReply = { id: number; faces: PhotoFaces } | { id: number; error: string };

export interface FaceFinder {
  /** The faces in a photo, ready to store. Photos are searched one at a time,
   * in the order asked. */
  find(photo: Blob): Promise<PhotoFaces>;
  close(): void;
}

export function createFaceFinder(): FaceFinder {
  const pending = new Map<number, { resolve(faces: PhotoFaces): void; reject(e: Error): void }>();
  let next = 0;
  let worker: Worker | null = null;

  const failAll = (error: Error) => {
    for (const p of pending.values()) p.reject(error);
    pending.clear();
  };
  const start = () => {
    // Turbopack bundles the worker from this URL and starts it as a classic
    // worker — its bootstrap loads the chunks with importScripts.
    const w = new Worker(new URL("./face-worker.ts", import.meta.url));
    w.onmessage = ({ data }: MessageEvent<FaceReply>) => {
      const request = pending.get(data.id);
      if (!request) return;
      pending.delete(data.id);
      if ("error" in data) request.reject(new Error(data.error));
      else request.resolve(data.faces);
    };
    // The worker's script did not load or threw outside a request.
    w.onerror = (event) => failAll(new Error(event.message || "FACE_WORKER"));
    return w;
  };

  return {
    find(photo) {
      worker ??= start();
      const id = next++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker!.postMessage({ id, photo } satisfies FaceRequest);
      });
    },
    close() {
      worker?.terminate();
      worker = null;
      failAll(new Error("CLOSED"));
    },
  };
}

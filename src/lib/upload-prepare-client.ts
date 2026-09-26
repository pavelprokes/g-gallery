"use client";

import type { PreparedUpload } from "@/lib/upload-prepare";

/**
 * Runs `prepareUpload` in a Web Worker where one can start, and on the main
 * thread otherwise — the outcome is identical, only which thread is busy
 * differs (docs/AUDIT.md §3.6).
 *
 * One worker for the whole session, created on the first file: most people who
 * open a gallery never upload anything, so nobody else pays for it. Files go
 * to it **one at a time** — the uploads themselves still run three abreast,
 * but a phone never holds three full-resolution decodes at once, and a file's
 * timeout measures that file's work, not its wait in the queue.
 *
 * Two kinds of failure, handled differently:
 *   - The worker itself is broken (cannot be created, its script will not load,
 *     a reply cannot be read, or it goes quiet): it is dropped for the rest of
 *     the session and every file is prepared on the main thread instead. A
 *     guest's upload never depends on the worker.
 *   - The worker ran and the *file* failed (unreadable, revoked by the OS):
 *     that error goes to the caller as it always did. Retrying on the main
 *     thread would read the whole file again only to fail the same way.
 *
 * Next 16's Turbopack recognises `new Worker(new URL(…, import.meta.url))` and
 * bundles the worker as a classic one that loads its chunks with
 * importScripts (vercel/next.js#98841) — so no `type: "module"` here: were it
 * ever honoured, importScripts would throw inside a module worker.
 */

/** Far longer than any real photo takes; past it the worker is presumed stuck. */
const WORKER_TIMEOUT_MS = 60_000;

type Reply =
  { id: number; ok: true; result: PreparedUpload } | { id: number; ok: false; message: string };

/** The worker cannot be used; the caller falls back to the main thread. */
class WorkerUnavailable extends Error {}

let worker: Worker | null | undefined; // undefined: not tried yet; null: unavailable
let nextId = 0;
let current: {
  id: number;
  resolve: (result: PreparedUpload) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
} | null = null;
/** Files waiting their turn; each entry starts its file when called. */
const queue: (() => void)[] = [];

function disable(reason: string): void {
  console.warn(`[g-gallery/upload] preparing on the main thread from now on: ${reason}`);
  worker?.terminate();
  worker = null;
  if (current) {
    clearTimeout(current.timer);
    current.reject(new WorkerUnavailable(reason));
    current = null;
  }
  // Whatever was still queued starts now and finds no worker.
  for (const start of queue.splice(0)) start();
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL("./upload-prepare.worker.ts", import.meta.url));
  } catch (error) {
    // No Worker at all (very old browsers, tests), or the script was refused.
    console.warn("[g-gallery/upload] preparing on the main thread: no worker", error);
    worker = null;
    return null;
  }
  worker.onmessage = (event: MessageEvent<Reply>) => {
    const reply = event.data;
    if (!current || current.id !== reply.id) return;
    const { resolve, reject, timer } = current;
    clearTimeout(timer);
    current = null;
    if (reply.ok) resolve(reply.result);
    else reject(new Error(reply.message));
    queue.shift()?.();
  };
  // A reply that cannot be deserialised never reaches onmessage; without this
  // the file would sit until the timeout.
  worker.onmessageerror = () => disable("a reply could not be read");
  // A worker whose script failed to load reports it here and never answers.
  worker.onerror = (event) => {
    event.preventDefault();
    disable(event.message || "worker failed to start");
  };
  return worker;
}

function prepareInWorker(file: File): Promise<PreparedUpload> {
  return new Promise<PreparedUpload>((resolve, reject) => {
    const start = () => {
      const target = worker;
      if (!target) return reject(new WorkerUnavailable("worker unavailable"));
      const id = nextId++;
      current = {
        id,
        resolve,
        reject,
        timer: setTimeout(() => disable("worker timed out"), WORKER_TIMEOUT_MS),
      };
      target.postMessage({ id, file });
    };
    if (current) queue.push(start);
    else start();
  });
}

export async function prepareUploadOffMainThread(file: File): Promise<PreparedUpload> {
  if (getWorker()) {
    try {
      return await prepareInWorker(file);
    } catch (error) {
      if (!(error instanceof WorkerUnavailable)) throw error;
    }
  }
  // Loaded only when needed: with a working worker this code lives in the
  // worker's chunk and never in the page's.
  const { prepareUpload } = await import("@/lib/upload-prepare");
  return prepareUpload(file);
}

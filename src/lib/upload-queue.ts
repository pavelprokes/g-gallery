"use client";

/**
 * A guest's pending uploads, kept in IndexedDB so they survive the page being
 * discarded (docs/GUEST-GALLERIES.md §11, F3).
 *
 * What this does and does not promise. On iOS, JavaScript is suspended when the
 * screen locks or the browser goes to the background, and the page itself can
 * be evicted from memory — there is no API that keeps bytes flowing in that
 * state, and pretending otherwise would be the kind of copy that gets found out
 * on a wedding night. What is possible is that **nothing is lost**: the files
 * are stored (File is structured-cloneable, so the bytes really are persisted,
 * not just the names), and returning to the page finishes the job without
 * anyone re-picking anything.
 *
 * Everything degrades to a no-op without IndexedDB — private modes and old
 * browsers still upload, they just cannot resume after a discard.
 */
import { randomId } from "@/lib/random-id";
import { withTimeout } from "@/lib/with-timeout";

const DB_NAME = "gg-uploads";
const DB_VERSION = 1;
const STORE = "queue";

/** Older than this and it is somebody's abandoned intent, not a pending job. */
export const QUEUE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface QueuedUpload {
  id: string;
  /** Which gallery this belongs to — a phone can hold queues for two weddings. */
  token: string;
  file: File;
  addedAt: number;
}

/** Pure, so the expiry rule is testable without a database. */
export function isStale(addedAt: number, now: number, maxAgeMs = QUEUE_MAX_AGE_MS): boolean {
  // A clock that moved backwards (timezone change, manual set) must not make
  // every entry look like it came from the future and live forever.
  return now - addedAt > maxAgeMs || addedAt > now + maxAgeMs;
}

/** IndexedDB can simply not answer — Safari in particular. Never wait forever. */
const OPEN_TIMEOUT_MS = 5_000;

function openDb(): Promise<IDBDatabase | null> {
  return withTimeout(openDbRaw(), OPEN_TIMEOUT_MS, "IndexedDB open").catch(() => null);
}

function openDbRaw(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);

  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function tx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Stores the files and returns them with the ids the queue knows them by. */
export async function enqueueUploads(token: string, files: File[]): Promise<QueuedUpload[]> {
  const entries: QueuedUpload[] = files.map((file) => ({
    id: randomId(),
    token,
    file,
    addedAt: Date.now(),
  }));

  const db = await openDb();
  if (!db) return entries; // No storage: the run still happens, it just cannot resume.

  for (const entry of entries) await tx(db, "readwrite", (store) => store.put(entry));
  db.close();
  return entries;
}

/** This gallery's pending entries, oldest first. Expired ones are swept here. */
export async function listQueuedUploads(token: string): Promise<QueuedUpload[]> {
  const db = await openDb();
  if (!db) return [];

  const all = (await tx<QueuedUpload[]>(db, "readonly", (store) => store.getAll())) ?? [];
  const now = Date.now();

  const stale = all.filter((entry) => isStale(entry.addedAt, now));
  for (const entry of stale) await tx(db, "readwrite", (store) => store.delete(entry.id));

  db.close();
  return all
    .filter((entry) => entry.token === token && !isStale(entry.addedAt, now))
    .sort((a, b) => a.addedAt - b.addedAt);
}

export async function dequeueUpload(id: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await tx(db, "readwrite", (store) => store.delete(id));
  db.close();
}

export async function clearQueuedUploads(token: string): Promise<void> {
  for (const entry of await listQueuedUploads(token)) await dequeueUpload(entry.id);
}

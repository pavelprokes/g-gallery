"use client";

// The photographer's music for reels, kept in this browser's IndexedDB
// (docs/REELS.md §2): the file as added — or a song only listened to — and its
// beat, found once. Nothing is uploaded — a licence covers the photographer's
// use, not a copy on our storage — so another computer starts with an empty list.

import { BEATS_VERSION, type BeatAnalysis } from "@/lib/reels/beats";

export interface MusicTrack {
  id: string;
  /** The file's name without its extension, as the photographer named it. */
  name: string;
  /** Where it is from and under what licence — the photographer's note. */
  source: string;
  addedAt: number;
  blob: Blob;
  analysis: BeatAnalysis;
  /** "file": added from the computer, and its sound goes into the video.
   * "listened": heard through the microphone or a shared tab, for its beat
   * only — the video is made without sound and the song is added in
   * Instagram (docs/REELS.md §2). Absent on tracks from before listening. */
  kind?: TrackKind;
  /** Where a listened song played — a YouTube address, when it was one. */
  origin?: string;
}

export type TrackKind = "file" | "listened";

export function kindOf(track: MusicTrack): TrackKind {
  return track.kind ?? "file";
}

const DB_NAME = "g-gallery-music";
const STORE = "tracks";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = act(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

/** Newest first. */
export async function listTracks(): Promise<MusicTrack[]> {
  const all = await run<MusicTrack[]>("readonly", (store) => store.getAll());
  return all.sort((a, b) => b.addedAt - a.addedAt);
}

/** Analysed by this build — an older one's beat is found again before use. */
export function isCurrent(track: MusicTrack): boolean {
  return track.analysis?.v === BEATS_VERSION;
}

export function saveTrack(track: MusicTrack): Promise<IDBValidKey> {
  return run("readwrite", (store) => store.put(track));
}

export function deleteTrack(id: string): Promise<undefined> {
  return run("readwrite", (store) => store.delete(id));
}

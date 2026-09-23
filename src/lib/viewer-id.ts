"use client";

// First-party viewer identity (docs/PLAN.md §8). This is NOT an analytics
// tracker: it is what lets an anonymous client keep their own favorites and
// what dedupes "viewed" state. Single site, never cross-referenced, cleared by
// the opt-out control in the gallery footer.

import { randomId } from "@/lib/random-id";

const STORAGE_KEY = "gg.viewer";
const OPT_OUT_KEY = "gg.viewer.optout";
const NAME_KEY = "gg.viewer.name";
const NAME_ASKED_KEY = "gg.viewer.nameAsked";
/**
 * Separate from NAME_ASKED_KEY on purpose. Skipping "Komu za ně poděkovat?" on a
 * heart says nothing about wanting to be credited for photos you add — and the
 * shared flag is exactly why someone who had once skipped the heart prompt was
 * never asked before uploading at all.
 */
const UPLOAD_NAME_ASKED_KEY = "gg.viewer.uploadNameAsked";

// The name is read by more than one component at once (the upload bar says
// "adding as …" while the heart prompt may set it), so they subscribe rather
// than each keeping a copy that goes stale.
const nameListeners = new Set<() => void>();

function notifyName(): void {
  for (const listener of nameListeners) listener();
}

export function subscribeViewerName(onChange: () => void): () => void {
  nameListeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    nameListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Server render never knows a name; the client corrects on hydration. */
export const getViewerNameServerSnapshot = () => null;

/** The name the viewer volunteered, shown to others in the gallery. */
export function getViewerName(): string | null {
  try {
    return window.localStorage.getItem(NAME_KEY);
  } catch {
    return null;
  }
}

export function setViewerName(name: string): void {
  try {
    window.localStorage.setItem(NAME_KEY, name);
    window.localStorage.setItem(NAME_ASKED_KEY, "1");
  } catch {
    /* storage unavailable */
  }
  notifyName();
}

/** True once the viewer has answered or dismissed the name prompt. */
export function hasAnsweredNamePrompt(): boolean {
  try {
    return window.localStorage.getItem(NAME_ASKED_KEY) === "1";
  } catch {
    return true; // no storage -> never nag
  }
}

/** Takes a name back. Still counts as answered — nobody is asked again. */
export function clearViewerName(): void {
  try {
    window.localStorage.removeItem(NAME_KEY);
  } catch {
    /* storage unavailable */
  }
  notifyName();
}

/** True once the guest has named themselves or chosen to add photos without a name. */
export function hasAnsweredUploadName(): boolean {
  try {
    return window.localStorage.getItem(UPLOAD_NAME_ASKED_KEY) === "1";
  } catch {
    return true; // no storage -> nowhere to remember the answer, so never ask
  }
}

export function markUploadNameAnswered(): void {
  try {
    window.localStorage.setItem(UPLOAD_NAME_ASKED_KEY, "1");
  } catch {
    /* storage unavailable */
  }
}

export function dismissNamePrompt(): void {
  try {
    window.localStorage.setItem(NAME_ASKED_KEY, "1");
  } catch {
    /* storage unavailable */
  }
}

export function hasOptedOut(): boolean {
  try {
    return window.localStorage.getItem(OPT_OUT_KEY) === "1";
  } catch {
    return false;
  }
}

// localStorage is an external store, so components read it through
// useSyncExternalStore rather than syncing it into state from an effect.
const listeners = new Set<() => void>();

export function subscribeOptOut(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

export const getOptOutSnapshot = hasOptedOut;

/** Server render always assumes opted-in; the client corrects on hydration. */
export const getOptOutServerSnapshot = () => false;

export function optOut(): void {
  try {
    window.localStorage.setItem(OPT_OUT_KEY, "1");
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable — nothing to clear */
  }
  for (const listener of listeners) listener();
}

/**
 * Adopts an identity handed over from another device (docs/PLAN.md §8a).
 *
 * This overwrites the `anonKey`, which is the whole point: the marks live on
 * the server against the *old* key, so the second device has to become that
 * viewer rather than merge into it. Anything this device had marked on its own
 * key is left behind — in practice that is nothing, since a viewer only
 * redeems a code on a device where their marks are missing, which is exactly
 * the complaint that sends them here.
 *
 * Returns false when storage is unavailable or the viewer has opted out, so
 * the caller can say so rather than silently appearing to succeed.
 */
export function adoptViewerId(anonKey: string, displayName: string | null): boolean {
  if (hasOptedOut()) return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, anonKey);
    // The name travels with the identity — being asked "who's watching?" again
    // on the laptop, having already answered on the phone, reads as the
    // transfer not having worked.
    if (displayName) {
      window.localStorage.setItem(NAME_KEY, displayName);
      window.localStorage.setItem(NAME_ASKED_KEY, "1");
      notifyName();
    }
    return true;
  } catch {
    return false;
  }
}

/** Returns null when the viewer opted out or storage is unavailable. */
export function getViewerId(): string | null {
  if (hasOptedOut()) return null;
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const created = randomId();
    window.localStorage.setItem(STORAGE_KEY, created);
    return created;
  } catch {
    return null;
  }
}

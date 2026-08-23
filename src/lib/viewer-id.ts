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
}

/** True once the viewer has answered or dismissed the name prompt. */
export function hasAnsweredNamePrompt(): boolean {
  try {
    return window.localStorage.getItem(NAME_ASKED_KEY) === "1";
  } catch {
    return true; // no storage -> never nag
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

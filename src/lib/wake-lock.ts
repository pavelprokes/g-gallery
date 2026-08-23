"use client";

/**
 * Keeps the screen on while an upload runs.
 *
 * This is the cheapest fix for the problem it addresses. The usual reason an
 * upload dies at a wedding is not that someone deliberately locked the phone —
 * it is that they put it down and the display timed out after thirty seconds.
 * A screen wake lock removes that case entirely.
 *
 * It does not survive the page being hidden: the browser drops the lock when
 * the tab goes to the background, which is why it is re-acquired on
 * `visibilitychange`. And it is best-effort — Safari has supported it since
 * 16.4, older iOS simply will not, so nothing may depend on it working.
 */
export interface HeldWakeLock {
  release: () => void;
}

export async function holdScreenAwake(): Promise<HeldWakeLock | null> {
  if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return null;

  let sentinel: WakeLockSentinel | null = null;
  let released = false;

  async function acquire() {
    if (released || document.visibilityState !== "visible") return;
    try {
      sentinel = await navigator.wakeLock.request("screen");
    } catch {
      // Denied (low battery, unsupported, not a user gesture) — not an error
      // the guest should ever hear about.
    }
  }

  function onVisibility() {
    if (document.visibilityState === "visible") void acquire();
  }

  await acquire();
  document.addEventListener("visibilitychange", onVisibility);

  return {
    release() {
      released = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release().catch(() => undefined);
      sentinel = null;
    },
  };
}

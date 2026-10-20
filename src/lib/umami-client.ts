"use client";

// Custom events from the visitor's browser into the same Umami website the
// page views go to (src/components/umami.tsx). The tracker owns the session,
// so events from one visit are grouped with its page views.
//
// Identifiers, counts and choices only — never file names, photo data or
// anything typed. A missing tracker (ad blocker, Umami off) is a no-op.

type SimpleValue = string | number | boolean;

const EVENT_NAME = /^[a-z0-9][a-z0-9-]{0,49}$/;

declare global {
  interface Window {
    umami?: { track(name: string, data?: Record<string, SimpleValue>): void };
  }
}

export function trackEvent(name: string, data?: Record<string, SimpleValue>): void {
  if (!EVENT_NAME.test(name)) return;
  try {
    window.umami?.track(name, data);
  } catch {
    // Analytics never breaks the page.
  }
}

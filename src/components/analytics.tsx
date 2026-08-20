"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";

// Share tokens must NEVER reach Vercel Analytics (CLAUDE.md invariant #7).
// The full URL path is stored with every pageview, so /g/<128-bit-token>
// would otherwise land verbatim in the dashboard.
function scrub(event: BeforeSendEvent): BeforeSendEvent | null {
  const url = new URL(event.url);

  // Redact the share-link token path segment.
  url.pathname = url.pathname.replace(/^\/g\/[A-Za-z0-9_-]{16,}/, "/g/[token]");

  // Defensively drop any secret-bearing query params.
  for (const param of ["token", "pw", "password"]) {
    url.searchParams.delete(param);
  }

  return { ...event, url: url.toString() };
}

export function AppAnalytics() {
  return <Analytics beforeSend={scrub} />;
}

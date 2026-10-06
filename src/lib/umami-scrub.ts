// Share tokens must NEVER reach analytics (CLAUDE.md invariant #7). Umami stores
// the full URL path with every pageview and event, so /g/<token> and /s/<token>
// would land verbatim in its dashboard. Shared by the client script's
// `data-before-send` hook (src/components/umami.tsx) and the server events
// (src/lib/umami.ts) so both redact identically.
const TOKEN_PATH = /^\/(api\/)?(g|s)\/[A-Za-z0-9_-]{16,}/;

/** Path only: redacts the token segment and drops the query string and hash. */
export function scrubPath(path: string): string {
  const pathname = path.split(/[?#]/)[0] ?? "";
  return pathname.replace(TOKEN_PATH, "/$1$2/[token]");
}

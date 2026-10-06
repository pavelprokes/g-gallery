import "server-only";
import { after } from "next/server";
import { SITE_ORIGIN } from "@/lib/site-url";
import { UMAMI_URL, UMAMI_WEBSITE_ID, umamiEnabled } from "@/lib/umami-config";
import { scrubPath } from "@/lib/umami-scrub";

// Short kebab-case; Umami rejects names over 50 chars, and a leading = + - @
// is a spreadsheet-injection vector in its CSV export.
const EVENT_NAME = /^[a-z0-9][a-z0-9-]{0,49}$/;

type SimpleValue = string | number | boolean;

export type ServerEvent = {
  name: string;
  /** Identifiers, numbers and flags only — never e-mail, names or addresses. */
  data?: Record<string, SimpleValue>;
  /** The visitor's request. Without it (cron, webhook) pass `id` instead. */
  request?: Request;
  /** Stable distinct id for events with no visitor request. */
  id?: string;
};

function visitorIp(headers: Headers): string | undefined {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip") || undefined;
}

async function send({ name, data, request, id }: ServerEvent): Promise<void> {
  const payload: Record<string, unknown> = {
    website: UMAMI_WEBSITE_ID,
    hostname: new URL(SITE_ORIGIN).hostname,
    name,
    data,
  };
  if (request) {
    const headers = request.headers;
    payload.url = scrubPath(new URL(request.url).pathname);
    payload.ip = visitorIp(headers);
    payload.userAgent = headers.get("user-agent") ?? undefined;
    payload.language =
      headers.get("accept-language")?.split(",")[0]?.split(";")[0]?.trim() || undefined;
  } else {
    payload.url = "/";
    if (id) payload.id = id;
  }

  const endpoint = process.env.UMAMI_COLLECT_ENDPOINT || "/api/e";
  const res = await fetch(`${UMAMI_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Umami's bot filter rejects requests without a browser-like UA.
      ...(request ? {} : { "User-Agent": "g-gallery-server" }),
    },
    body: JSON.stringify({ type: "event", payload }),
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) console.error(`[umami] ${name}: collect returned ${res.status}`);
}

/**
 * Fire-and-forget server event. Never throws and never delays the response:
 * the POST runs in `after()`. Pageviews are the client script's job — not this.
 */
export function trackServerEvent(event: ServerEvent): void {
  try {
    if (!umamiEnabled()) return;
    if (!EVENT_NAME.test(event.name)) {
      console.error(`[umami] invalid event name: ${event.name}`);
      return;
    }
    const run = () =>
      send(event).catch((err: unknown) => console.error("[umami] send failed", err));
    try {
      after(run);
    } catch {
      // Outside a request scope `after` throws; fall back to a plain detached promise.
      void run();
    }
  } catch (err) {
    console.error("[umami] trackServerEvent failed", err);
  }
}

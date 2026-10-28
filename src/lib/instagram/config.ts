// Where the Meta API is and what the app asks for (docs/INSTAGRAM-AUDIO.md
// §3.1). One version for every call; overridable so a test can point the whole
// client at a local mock, and so a retired version is one variable away.

/** Graph API v26.0, current since 2026-07-29 (Meta's version table). */
export const DEFAULT_GRAPH_VERSION = "v26.0";

/**
 * The Instagram API with Facebook Login — the only path with the music API
 * (docs/INSTAGRAM-AUDIO.md): the professional account through the Page it is
 * linked to. `instagram_content_publish` although nothing is published: the
 * Audio API is part of Content Publishing; whether search alone needs it is
 * still to be read on Meta's page (U6). `business_management` because a Page
 * held in a business portfolio is otherwise missing from `/me/accounts`.
 */
export const INSTAGRAM_SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "pages_show_list",
  "pages_read_engagement",
  "business_management",
] as const;

export function graphVersion(): string {
  return process.env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION;
}

/** `https://graph.facebook.com/v26.0`, or the mock a test runs. */
export function graphBase(): string {
  const base = process.env.META_GRAPH_BASE_URL || "https://graph.facebook.com";
  return `${base.replace(/\/$/, "")}/${graphVersion()}`;
}

/** Where the person signs in to Facebook and grants the scopes. */
export function dialogBase(): string {
  const base = process.env.META_DIALOG_BASE_URL || "https://www.facebook.com";
  return `${base.replace(/\/$/, "")}/${graphVersion()}/dialog/oauth`;
}

export function metaConfigured(): boolean {
  return Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET);
}

export function metaApp(): { id: string; secret: string } {
  const id = process.env.META_APP_ID;
  const secret = process.env.META_APP_SECRET;
  if (!id || !secret) throw new Error("META_NOT_CONFIGURED");
  return { id, secret };
}

/**
 * The sign-in dialog's address. With a Facebook Login for Business
 * configuration (`META_LOGIN_CONFIG_ID`) the configuration names the
 * permissions; without one, the classic `scope` list does.
 */
export function authorizeUrl({
  appId,
  redirectUri,
  state,
  configId,
}: {
  appId: string;
  redirectUri: string;
  state: string;
  configId?: string;
}): string {
  const url = new URL(dialogBase());
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  if (configId) url.searchParams.set("config_id", configId);
  else url.searchParams.set("scope", INSTAGRAM_SCOPES.join(","));
  return url.toString();
}

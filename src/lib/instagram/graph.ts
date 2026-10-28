import "server-only";

// The Graph API calls the Instagram publishing needs (docs/INSTAGRAM-PUBLISH.md
// §3.2): sign-in, the account, the music search, and a Reel's three steps.
// Every response is Zod-parsed — Meta's shapes are read, never trusted — and
// every error keeps Meta's code, so the admin can say "connect again" for an
// expired token and the real message otherwise.

import { createHmac } from "node:crypto";
import { z } from "zod";
import { graphBase, metaApp } from "@/lib/instagram/config";

export class GraphError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly subcode: number | null,
    readonly status: number,
  ) {
    super(message);
    this.name = "GraphError";
  }

  /** The token is gone: expired, revoked, or the password changed (code 190). */
  get tokenInvalid(): boolean {
    return this.code === 190;
  }
}

const errorEnvelope = z.object({
  error: z.object({
    message: z.string(),
    code: z.number().optional(),
    error_subcode: z.number().optional(),
  }),
});

/** Proves the call comes from the app's server: Meta checks it when the app
 * requires it, and ignores it otherwise. */
function appSecretProof(token: string): string {
  return createHmac("sha256", metaApp().secret).update(token).digest("hex");
}

async function call<T>(
  method: "GET" | "POST",
  path: string,
  params: Record<string, string | undefined>,
  schema: z.ZodType<T>,
  token?: string,
): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, value);
  }
  if (token) {
    query.set("access_token", token);
    query.set("appsecret_proof", appSecretProof(token));
  }
  const url = `${graphBase()}${path}`;
  const response =
    method === "GET"
      ? await fetch(`${url}?${query}`, { cache: "no-store" })
      : await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: query,
          cache: "no-store",
        });
  const body: unknown = await response.json().catch(() => null);
  const failure = errorEnvelope.safeParse(body);
  if (!response.ok || failure.success) {
    const error = failure.success ? failure.data.error : null;
    throw new GraphError(
      error?.message ?? `Graph ${response.status}`,
      error?.code ?? null,
      error?.error_subcode ?? null,
      response.status,
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new GraphError(`Unexpected Graph response for ${path}`, null, null, response.status);
  }
  return parsed.data;
}

// ---- Sign-in ----

const tokenResponse = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().optional(),
});

/** The code from the sign-in dialog → a short-lived user token. */
export function exchangeCode(code: string, redirectUri: string) {
  const app = metaApp();
  return call(
    "GET",
    "/oauth/access_token",
    { client_id: app.id, client_secret: app.secret, redirect_uri: redirectUri, code },
    tokenResponse,
  );
}

/** A short-lived user token → a long-lived one (about 60 days). */
export function longLivedToken(shortLived: string) {
  const app = metaApp();
  return call(
    "GET",
    "/oauth/access_token",
    {
      grant_type: "fb_exchange_token",
      client_id: app.id,
      client_secret: app.secret,
      fb_exchange_token: shortLived,
    },
    tokenResponse,
  );
}

const pagesResponse = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      access_token: z.string().optional(),
      instagram_business_account: z
        .object({ id: z.string(), username: z.string().optional() })
        .optional(),
    }),
  ),
});

export type PageWithInstagram = z.infer<typeof pagesResponse>["data"][number];

/** The Pages the person manages, each with its token and linked Instagram account. */
export async function pagesOf(userToken: string): Promise<PageWithInstagram[]> {
  const result = await call(
    "GET",
    "/me/accounts",
    { fields: "id,name,access_token,instagram_business_account{id,username}", limit: "100" },
    pagesResponse,
    userToken,
  );
  return result.data;
}

const profileResponse = z.object({ id: z.string(), username: z.string() });

export function instagramProfile(igUserId: string, token: string) {
  return call(
    "GET",
    `/${encodeURIComponent(igUserId)}`,
    { fields: "id,username" },
    profileResponse,
    token,
  );
}

// ---- Music (the Audio API, docs/INSTAGRAM-PUBLISH.md F7) ----

const audioItem = z.object({
  audio_id: z.union([z.string(), z.number()]).transform(String),
  // Meta's own table types it as an integer while its examples are strings.
  audio_type: z.union([z.string(), z.number()]).transform(String).nullish(),
  title: z.string().nullish(),
  display_artist: z.string().nullish(),
  duration_in_ms: z.number().nullish(),
  download_url: z.string().url().nullish(),
  cover_artwork_thumbnail_uri: z.string().url().nullish(),
  on_platform_audio_preview_link: z.string().url().nullish(),
  is_ads_eligible: z.boolean().nullish(),
  ig_username: z.string().nullish(),
});

// The list sits under `audio`; `data` is accepted too, in case Meta wraps it
// like every other edge.
const audioResponse = z
  .object({ audio: z.array(z.unknown()).optional(), data: z.array(z.unknown()).optional() })
  .transform((r) => r.audio ?? r.data ?? []);

export interface InstagramAudio {
  audioId: string;
  type: string | null;
  title: string;
  artist: string | null;
  durationMs: number | null;
  downloadUrl: string | null;
  coverUrl: string | null;
  instagramUrl: string | null;
  adsEligible: boolean | null;
}

export type AudioKind = "music" | "original_sound";

/** Music Instagram allows on a Reel; no query → what is trending. Items that
 * do not parse are left out, not fatal. */
export async function searchAudio(
  igUserId: string,
  token: string,
  { kind, query }: { kind: AudioKind; query?: string },
): Promise<InstagramAudio[]> {
  const items = await call(
    "GET",
    "/ig_audio",
    { user_id: igUserId, audio_type: kind, search_query: query?.trim() || undefined },
    audioResponse,
    token,
  );
  return items.flatMap((raw) => {
    const item = audioItem.safeParse(raw);
    if (!item.success) return [];
    const a = item.data;
    return [
      {
        audioId: a.audio_id,
        type: a.audio_type ?? null,
        title: a.title ?? a.ig_username ?? "Bez názvu",
        artist: a.display_artist ?? null,
        durationMs: a.duration_in_ms ?? null,
        downloadUrl: a.download_url ?? null,
        coverUrl: a.cover_artwork_thumbnail_uri ?? null,
        instagramUrl: a.on_platform_audio_preview_link ?? null,
        adsEligible: a.is_ads_eligible ?? null,
      },
    ];
  });
}

// ---- A Reel: container → status → publish (F1, F8) ----

export interface AudioConfiguration {
  audioId: string;
  /** 0–100. */
  audioVolume: number;
  /** 0–100; 0 for a silent render. */
  videoVolume: number;
}

const idResponse = z.object({ id: z.string() });

export function createReelContainer(
  igUserId: string,
  token: string,
  { videoUrl, caption, audio }: { videoUrl: string; caption: string; audio?: AudioConfiguration },
) {
  return call(
    "POST",
    `/${encodeURIComponent(igUserId)}/media`,
    {
      media_type: "REELS",
      video_url: videoUrl,
      caption,
      // Meta's examples send the object as JSON in a form field.
      audio_configuration: audio
        ? JSON.stringify({
            audio_id: audio.audioId,
            audio_volume: audio.audioVolume,
            video_volume: audio.videoVolume,
          })
        : undefined,
    },
    idResponse,
    token,
  );
}

export const CONTAINER_STATUSES = [
  "IN_PROGRESS",
  "FINISHED",
  "ERROR",
  "EXPIRED",
  "PUBLISHED",
] as const;

const statusResponse = z.object({
  id: z.string(),
  status_code: z.enum(CONTAINER_STATUSES),
  status: z.string().optional(),
});

export function containerStatus(containerId: string, token: string) {
  return call(
    "GET",
    `/${encodeURIComponent(containerId)}`,
    { fields: "id,status_code,status" },
    statusResponse,
    token,
  );
}

export function publishContainer(igUserId: string, token: string, containerId: string) {
  return call(
    "POST",
    `/${encodeURIComponent(igUserId)}/media_publish`,
    { creation_id: containerId },
    idResponse,
    token,
  );
}

const permalinkResponse = z.object({ id: z.string(), permalink: z.string().url().optional() });

export function mediaPermalink(mediaId: string, token: string) {
  return call(
    "GET",
    `/${encodeURIComponent(mediaId)}`,
    { fields: "id,permalink" },
    permalinkResponse,
    token,
  );
}

"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth-guard";
import { disconnect, instagramAccount } from "@/lib/instagram/connection";
import {
  containerStatus,
  createReelContainer,
  GraphError,
  mediaPermalink,
  publishContainer,
  searchAudio,
  type InstagramAudio,
} from "@/lib/instagram/graph";
import { headObject, presignedPutHeaders, presignPut } from "@/lib/r2";
import { VIDEO_CONTENT_TYPE } from "@/lib/upload-content-types";
import { videoSrc } from "@/lib/video";

// Publishing a reel to the photographer's own Instagram, with Instagram's own
// music (docs/INSTAGRAM-PUBLISH.md §3.3–§3.6). The rendered MP4 goes from the
// browser straight to R2 (invariant 1) under a key this server minted; Meta
// fetches it from the public bucket host. Every action re-verifies the
// session (invariant 3) and Zod-checks what the page sends.

/** Meta's ceiling for a Reel file (docs/INSTAGRAM-PUBLISH.md F2). */
const REEL_MAX_BYTES = 300 * 1024 * 1024;

const nameSchema = z.uuid();
const reelKey = (name: string) => `reels/${name}.mp4`;

export type ActionResult<T> =
  ({ ok: true } & T) | { ok: false; error: string; reconnect?: boolean };

async function account() {
  const session = await requireAdmin();
  return instagramAccount(session.user.id);
}

function failure(error: unknown): { ok: false; error: string; reconnect?: boolean } {
  if (error instanceof GraphError) {
    if (error.tokenInvalid) {
      return {
        ok: false,
        error: "Přihlášení k Instagramu vypršelo nebo bylo zrušené — připoj ho znovu.",
        reconnect: true,
      };
    }
    console.warn("[g-gallery/instagram]", error.code, error.subcode, error.message);
    return { ok: false, error: `Instagram odmítl: ${error.message}` };
  }
  throw error;
}

const NOT_CONNECTED = { ok: false as const, error: "Instagram není připojený.", reconnect: true };

export async function disconnectInstagram(): Promise<void> {
  const session = await requireAdmin();
  await disconnect(session.user.id);
  revalidatePath("/admin/reels");
}

const searchSchema = z.object({
  kind: z.enum(["music", "original_sound"]),
  query: z.string().max(100).optional(),
});

export async function searchInstagramAudio(
  input: z.input<typeof searchSchema>,
): Promise<ActionResult<{ items: InstagramAudio[] }>> {
  const { kind, query } = searchSchema.parse(input);
  const ig = await account();
  if (!ig) return NOT_CONNECTED;
  try {
    return { ok: true, items: await searchAudio(ig.igUserId, ig.token, { kind, query }) };
  } catch (error) {
    return failure(error);
  }
}

/** A presigned PUT for the rendered reel; the page echoes `name` back. */
export async function prepareReelUpload(): Promise<{
  name: string;
  url: string;
  headers: Record<string, string>;
}> {
  await requireAdmin();
  const name = randomUUID();
  return {
    name,
    url: await presignPut(reelKey(name), VIDEO_CONTENT_TYPE),
    headers: presignedPutHeaders(VIDEO_CONTENT_TYPE),
  };
}

const createSchema = z.object({
  name: nameSchema,
  caption: z.string().max(2200),
  audio: z
    .object({
      audioId: z.string().regex(/^[\w-]{1,64}$/),
      audioVolume: z.number().int().min(0).max(100),
      videoVolume: z.number().int().min(0).max(100),
    })
    .optional(),
});

export async function createInstagramReel(
  input: z.input<typeof createSchema>,
): Promise<ActionResult<{ containerId: string }>> {
  const { name, caption, audio } = createSchema.parse(input);
  const ig = await account();
  if (!ig) return NOT_CONNECTED;
  const key = reelKey(name);
  const stored = await headObject(key);
  if (!stored) return { ok: false, error: "Video se do úložiště nenahrálo." };
  if (stored.sizeBytes > REEL_MAX_BYTES) {
    return { ok: false, error: "Video je větší než 300 MB, které Instagram přijme." };
  }
  const videoUrl = videoSrc(key);
  if (!videoUrl)
    return {
      ok: false,
      error: "Úložiště nemá veřejnou adresu, ze které by si Instagram video stáhl.",
    };
  try {
    const container = await createReelContainer(ig.igUserId, ig.token, {
      videoUrl,
      caption,
      audio,
    });
    return { ok: true, containerId: container.id };
  } catch (error) {
    return failure(error);
  }
}

const containerSchema = z.string().regex(/^\d{1,32}$/);

export async function instagramReelStatus(
  containerId: string,
): Promise<ActionResult<{ status: string; detail: string | null }>> {
  const id = containerSchema.parse(containerId);
  const ig = await account();
  if (!ig) return NOT_CONNECTED;
  try {
    const status = await containerStatus(id, ig.token);
    return { ok: true, status: status.status_code, detail: status.status ?? null };
  } catch (error) {
    return failure(error);
  }
}

export async function publishInstagramReel(
  containerId: string,
): Promise<ActionResult<{ mediaId: string; permalink: string | null }>> {
  const id = containerSchema.parse(containerId);
  const ig = await account();
  if (!ig) return NOT_CONNECTED;
  try {
    const media = await publishContainer(ig.igUserId, ig.token, id);
    // The link is a nicety: a published reel without it is still published.
    const permalink = await mediaPermalink(media.id, ig.token)
      .then((m) => m.permalink ?? null)
      .catch(() => null);
    return { ok: true, mediaId: media.id, permalink };
  } catch (error) {
    return failure(error);
  }
}

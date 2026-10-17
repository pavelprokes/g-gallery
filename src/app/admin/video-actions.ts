"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-guard";
import { idSchema } from "@/lib/id-schema";
import { deleteObject, headObject, presignedPutHeaders, presignPut } from "@/lib/r2";
import { THUMB_CONTENT_TYPES, thumbKeyFor } from "@/lib/thumbnail";
import { VIDEO_CONTENT_TYPE } from "@/lib/upload-content-types";
import { loopKeyFor, POSTER_CONTENT_TYPE, POSTER_EXTENSION } from "@/lib/video";

// The admin's "choose the poster" for a video (docs/VIDEO.md). The browser
// draws the frame and records the loop; these two actions only sign the PUTs
// and then point the row at what arrived. Bytes never touch Vercel (invariant 1).
//
// Every object gets a NEW key: R2 objects are served `immutable` for a year,
// so overwriting the old poster would keep showing it from every cache.

const thumbSchema = z.enum(["webp", "jpeg"]).nullable();
const nameSchema = z.uuid();

export interface PutTarget {
  url: string;
  headers: Record<string, string>;
}

async function ownedVideo(photoId: string) {
  const session = await requireAdmin();
  const photo = await prisma.photo.findFirst({
    where: {
      id: idSchema.parse(photoId),
      gallery: { ownerId: session.user.id },
      videoObjectKey: { not: null },
      status: "CONFIRMED",
    },
    select: {
      id: true,
      galleryId: true,
      objectKey: true,
      thumbObjectKey: true,
      loopObjectKey: true,
      gallery: { select: { storagePrefix: true } },
    },
  });
  if (!photo) throw new Error("NOT_FOUND");
  return photo;
}

/** Keys derive from a server-minted name; the client only ever echoes the name back. */
function keysFor(storagePrefix: string, name: string) {
  const poster = `${storagePrefix}/${name}${POSTER_EXTENSION}`;
  return { poster, loop: loopKeyFor(poster) };
}

export async function presignVideoPoster(
  photoId: string,
  thumb: "webp" | "jpeg" | null,
  withLoop: boolean,
): Promise<{ name: string; poster: PutTarget; thumb: PutTarget | null; loop: PutTarget | null }> {
  const photo = await ownedVideo(photoId);
  const format = thumbSchema.parse(thumb);
  const name = randomUUID();
  const keys = keysFor(photo.gallery.storagePrefix, name);

  const target = async (key: string, contentType: string): Promise<PutTarget> => ({
    url: await presignPut(key, contentType),
    headers: presignedPutHeaders(contentType),
  });
  const [poster, thumbTarget, loop] = await Promise.all([
    target(keys.poster, POSTER_CONTENT_TYPE),
    format ? target(thumbKeyFor(keys.poster, format), THUMB_CONTENT_TYPES[format]) : null,
    withLoop ? target(keys.loop, VIDEO_CONTENT_TYPE) : null,
  ]);
  return { name, poster, thumb: thumbTarget, loop };
}

const commitSchema = z.object({
  name: nameSchema,
  thumb: thumbSchema,
  loop: z.boolean(),
  placeholder: z
    .string()
    .regex(/^#[0-9a-f]{6}$/)
    .nullable(),
});

export async function commitVideoPoster(
  photoId: string,
  input: z.input<typeof commitSchema>,
): Promise<void> {
  const photo = await ownedVideo(photoId);
  const { name, thumb, loop, placeholder } = commitSchema.parse(input);
  const keys = keysFor(photo.gallery.storagePrefix, name);

  // Only what actually landed is recorded — a row pointing at a missing
  // poster would be an empty tile on every surface.
  const thumbKey = thumb ? thumbKeyFor(keys.poster, thumb) : null;
  const [poster, thumbStored, loopStored] = await Promise.all([
    headObject(keys.poster),
    thumbKey ? headObject(thumbKey) : null,
    loop ? headObject(keys.loop) : null,
  ]);
  if (!poster) throw new Error("POSTER_MISSING");

  await prisma.photo.update({
    where: { id: photo.id },
    data: {
      objectKey: keys.poster,
      thumbObjectKey: thumbStored ? thumbKey : null,
      loopObjectKey: loopStored ? keys.loop : null,
      placeholder: placeholder ?? undefined,
    },
  });

  // The old poster shares the MP4's stem after the first pick, so the orphan
  // sweep would keep it forever; it goes here. A failure only leaves debris.
  // Never one the row now points at: a replayed `name` makes them equal.
  const current = new Set([keys.poster, thumbKey, keys.loop]);
  const stale = [photo.objectKey, photo.thumbObjectKey, photo.loopObjectKey].filter(
    (key): key is string => key !== null && !current.has(key),
  );
  await Promise.allSettled(stale.map((key) => deleteObject(key)));

  revalidatePath(`/admin/g/${photo.galleryId}`);
}

"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-guard";
import { idSchema } from "@/lib/id-schema";
import { MAX_PERSON_NAME, TAG_MATCH_IOU } from "@/lib/social-video/face-tags";
import { iou } from "@/lib/social-video/faces";

// Server Actions are publicly reachable POST endpoints — every one of them
// re-verifies the session internally (CLAUDE.md invariant #3), and every write
// is scoped by the gallery's `ownerId`. docs/SOCIAL-VIDEO.md §4 ("Who is who")
// is the authority.

/** People one gallery can hold — the couple, family, the bridal party. */
const MAX_PEOPLE = 50;

const nameSchema = z.string().trim().min(1).max(MAX_PERSON_NAME);
const unit = z.number().min(0).max(1);
const boxSchema = z.object({ x: unit, y: unit, w: unit.positive(), h: unit.positive() });

export interface PersonResult {
  id: string;
  name: string;
  couple: boolean;
}

/** Adds someone to name faces with. */
export async function createPerson(
  galleryId: string,
  name: string,
  couple: boolean,
): Promise<PersonResult> {
  const session = await requireAdmin();

  const input = z
    .object({ galleryId: idSchema, name: nameSchema, couple: z.boolean() })
    .safeParse({ galleryId, name, couple });
  if (!input.success) throw new Error("INVALID_INPUT");

  const gallery = await prisma.gallery.findFirst({
    where: { id: input.data.galleryId, ownerId: session.user.id },
    select: { id: true, _count: { select: { people: true } } },
  });
  if (!gallery) throw new Error("NOT_FOUND");
  if (gallery._count.people >= MAX_PEOPLE) throw new Error("TOO_MANY");

  return prisma.galleryPerson.create({
    data: { galleryId: gallery.id, name: input.data.name, couple: input.data.couple },
    select: { id: true, name: true, couple: true },
  });
}

/** Renames someone, or makes them one of the couple (or not). */
export async function updatePerson(personId: string, name: string, couple: boolean): Promise<void> {
  const session = await requireAdmin();

  const input = z
    .object({ personId: idSchema, name: nameSchema, couple: z.boolean() })
    .safeParse({ personId, name, couple });
  if (!input.success) throw new Error("INVALID_INPUT");

  const { count } = await prisma.galleryPerson.updateMany({
    where: { id: input.data.personId, gallery: { ownerId: session.user.id } },
    data: { name: input.data.name, couple: input.data.couple },
  });
  if (count === 0) throw new Error("NOT_FOUND");
}

/** Removes someone and every face named after them. */
export async function deletePerson(personId: string): Promise<void> {
  const session = await requireAdmin();

  const id = idSchema.safeParse(personId);
  if (!id.success) throw new Error("INVALID_INPUT");

  const { count } = await prisma.galleryPerson.deleteMany({
    where: { id: id.data, gallery: { ownerId: session.user.id } },
  });
  if (count === 0) throw new Error("NOT_FOUND");
}

/** Faces one call names — a series is a handful of shots, a burst a few dozen. */
const MAX_BATCH = 100;

const tagInput = z.object({
  personId: idSchema,
  entries: z
    .array(z.object({ photoId: idSchema, box: boxSchema }))
    .min(1)
    .max(MAX_BATCH),
});

/**
 * Names the face at `box` on each photo after someone. A face holds one name,
 * and someone is on a photo once: the face's previous name and the person's
 * previous face on that photo are both let go. Photos of another gallery are
 * skipped; returns how many were named.
 */
export async function tagFaces(
  personId: string,
  entries: { photoId: string; box: { x: number; y: number; w: number; h: number } }[],
): Promise<number> {
  const session = await requireAdmin();

  const input = tagInput.safeParse({ personId, entries });
  if (!input.success) throw new Error("INVALID_INPUT");

  const person = await prisma.galleryPerson.findFirst({
    where: { id: input.data.personId, gallery: { ownerId: session.user.id } },
    select: { id: true, galleryId: true },
  });
  if (!person) throw new Error("NOT_FOUND");
  // Someone from another gallery cannot be named on this one's faces.
  const photos = await prisma.photo.findMany({
    where: {
      id: { in: input.data.entries.map((e) => e.photoId) },
      galleryId: person.galleryId,
    },
    select: { id: true, faceTags: { select: { id: true, x: true, y: true, w: true, h: true } } },
  });
  const byId = new Map(photos.map((p) => [p.id, p]));

  const writes = input.data.entries.flatMap(({ photoId, box }) => {
    const photo = byId.get(photoId);
    if (!photo) return [];
    const sameFace = photo.faceTags.filter((t) => iou(t, box) >= TAG_MATCH_IOU).map((t) => t.id);
    const { x, y, w, h } = box;
    return [
      prisma.faceTag.deleteMany({ where: { id: { in: sameFace } } }),
      prisma.faceTag.upsert({
        where: { photoId_personId: { photoId, personId: person.id } },
        create: { photoId, personId: person.id, x, y, w, h },
        update: { x, y, w, h },
      }),
    ];
  });
  await prisma.$transaction(writes);
  return writes.length / 2;
}

/** Names one face — `tagFaces` for a single photo. */
export async function tagFace(
  photoId: string,
  personId: string,
  box: { x: number; y: number; w: number; h: number },
): Promise<void> {
  const named = await tagFaces(personId, [{ photoId, box }]);
  if (named === 0) throw new Error("NOT_FOUND");
}

/** Takes someone's name off a photo. */
export async function untagFace(photoId: string, personId: string): Promise<void> {
  const session = await requireAdmin();

  const input = z
    .object({ photoId: idSchema, personId: idSchema })
    .safeParse({ photoId, personId });
  if (!input.success) throw new Error("INVALID_INPUT");

  await prisma.faceTag.deleteMany({
    where: {
      photoId: input.data.photoId,
      personId: input.data.personId,
      photo: { gallery: { ownerId: session.user.id } },
    },
  });
}

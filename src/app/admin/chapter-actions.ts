"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-guard";
import type { Prisma } from "@/generated/prisma/client";
import {
  readTranslationsFromForm,
  TRANSLATED_LOCALES,
  type ContentTranslations,
} from "@/lib/content-translations";
import { chapterSlug, MAX_CHAPTER_TITLE, presetTranslations } from "@/lib/gallery-chapters";

// Server Actions are publicly reachable POST endpoints — every one of them
// re-verifies the session internally (CLAUDE.md invariant #3), and every write
// is scoped by the gallery's `ownerId` so a guessed id cannot reach another
// owner's row. docs/CHAPTERS.md is the authority for what a chapter is.

const idSchema = z.string().min(1).max(64);
const titleSchema = z.string().trim().min(1).max(MAX_CHAPTER_TITLE);

/**
 * A preset title ("Obřad") brings its own EN/FR, so the common case needs no
 * translating — but only where the photographer left a language empty: a
 * translation they typed always wins.
 */
function withPresetTranslations(
  title: string,
  typed: ContentTranslations<"title">,
): ContentTranslations<"title"> {
  const preset = presetTranslations(title);
  if (!preset) return typed;
  const result = { ...typed };
  for (const locale of TRANSLATED_LOCALES) {
    if (!result[locale]?.title) result[locale] = { title: preset[locale] };
  }
  return result;
}

/**
 * Starts a chapter at a photo. Stored as that photo's timeline position, not
 * as a reference to it (docs/CHAPTERS.md) — so deleting the photo later moves
 * nothing. Starting a second chapter at the same photo renames the first.
 */
export async function startChapter(galleryId: string, photoId: string, formData: FormData) {
  const session = await requireAdmin();

  const ids = z
    .object({ galleryId: idSchema, photoId: idSchema })
    .safeParse({ galleryId, photoId });
  const title = titleSchema.safeParse(formData.get("title"));
  if (!ids.success || !title.success) throw new Error("INVALID_INPUT");

  const photo = await prisma.photo.findFirst({
    where: {
      id: ids.data.photoId,
      galleryId: ids.data.galleryId,
      status: "CONFIRMED",
      gallery: { ownerId: session.user.id },
    },
    select: { id: true, takenAt: true, createdAt: true, fileOrderKey: true },
  });
  if (!photo) throw new Error("NOT_FOUND");

  // The same fallback the photo cursor uses, so the chapter starts exactly
  // where this photo sits on the guests' timeline.
  const startTakenAt = photo.takenAt ?? photo.createdAt;
  const translations = withPresetTranslations(title.data, {}) as Prisma.InputJsonObject;
  const at = { galleryId: ids.data.galleryId, startTakenAt, startPhotoId: photo.id };

  // A chapter already starting here is renamed; its slug stays frozen.
  const renamed = await prisma.galleryChapter.updateMany({
    where: at,
    data: { title: title.data, translations },
  });

  // Otherwise a new one, with the next free anchor. Two creates racing for the
  // same title both see it free and one loses on the unique index — it simply
  // looks again and takes `-2`. Racing for the same *photo* is a double
  // submit: the retry finds the winner's row and renames it instead.
  for (let attempt = 0; renamed.count === 0 && attempt < 3; attempt += 1) {
    const taken = await prisma.galleryChapter.findMany({
      where: { galleryId: ids.data.galleryId, slug: { not: null } },
      select: { slug: true },
    });
    const slug = chapterSlug(
      title.data,
      taken.flatMap((row) => (row.slug ? [row.slug] : [])),
    );
    try {
      await prisma.galleryChapter.create({
        // Both keys, so the chapter keeps this photo as its start whichever
        // order the gallery is shown in (src/lib/photo-order.ts).
        data: {
          ...at,
          startFileOrderKey: photo.fileOrderKey,
          title: title.data,
          translations,
          slug,
        },
      });
      break;
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002" || attempt === 2) throw error;
      const raced = await prisma.galleryChapter.updateMany({
        where: at,
        data: { title: title.data, translations },
      });
      if (raced.count > 0) break;
    }
  }

  revalidatePath(`/admin/g/${ids.data.galleryId}`);
}

/** Renames a chapter and saves its guest-facing translations. */
export async function updateChapter(chapterId: string, formData: FormData) {
  const session = await requireAdmin();

  const id = idSchema.safeParse(chapterId);
  const title = titleSchema.safeParse(formData.get("title"));
  const typed = readTranslationsFromForm(formData, { title: MAX_CHAPTER_TITLE });
  if (!id.success || !title.success || !typed.success) throw new Error("INVALID_INPUT");

  const chapter = await prisma.galleryChapter.findFirst({
    where: { id: id.data, gallery: { ownerId: session.user.id } },
    select: { id: true, galleryId: true, title: true },
  });
  if (!chapter) throw new Error("NOT_FOUND");

  // Renaming "Obřad" to "Přípravy" submits the form with "Ceremony" still in
  // the EN field — put there by the old preset, not typed. Drop what the old
  // preset supplied so the new one can fill in; keep anything else.
  const oldPreset = presetTranslations(chapter.title);
  const kept: ContentTranslations<"title"> = {};
  for (const locale of TRANSLATED_LOCALES) {
    const value = typed.data[locale]?.title;
    if (value && value !== oldPreset?.[locale]) kept[locale] = { title: value };
  }

  await prisma.galleryChapter.update({
    where: { id: chapter.id },
    data: {
      title: title.data,
      translations: withPresetTranslations(title.data, kept) as Prisma.InputJsonObject,
    },
  });

  revalidatePath(`/admin/g/${chapter.galleryId}`);
}

/** Removes a chapter; its photos join the chapter before it. */
export async function deleteChapter(chapterId: string) {
  const session = await requireAdmin();

  const id = idSchema.safeParse(chapterId);
  if (!id.success) throw new Error("INVALID_INPUT");

  const chapter = await prisma.galleryChapter.findFirst({
    where: { id: id.data, gallery: { ownerId: session.user.id } },
    select: { id: true, galleryId: true },
  });
  if (!chapter) throw new Error("NOT_FOUND");

  await prisma.galleryChapter.delete({ where: { id: chapter.id } });
  revalidatePath(`/admin/g/${chapter.galleryId}`);
}

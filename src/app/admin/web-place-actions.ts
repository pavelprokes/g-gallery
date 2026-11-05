"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth-guard";
import { idSchema } from "@/lib/id-schema";
import { WEB_PLACE_PATTERN } from "@/lib/web-gallery";
import { assignWebPlaceFor, createWebPlaceGalleryFor } from "@/lib/web-places";

// Server Actions are publicly reachable POST endpoints (CLAUDE.md invariant #3).

const placeKeySchema = z.string().max(120).regex(WEB_PLACE_PATTERN);

/** Puts the gallery chosen in the form into a place (docs/WEB-GALLERIES.md). */
export async function assignWebPlace(placeKey: string, formData: FormData) {
  const session = await requireAdmin();
  const key = placeKeySchema.safeParse(placeKey);
  const galleryId = idSchema.safeParse(formData.get("galleryId"));
  if (!key.success || !galleryId.success) throw new Error("INVALID_INPUT");

  await assignWebPlaceFor(session.user.id, key.data, galleryId.data);
  revalidatePath("/admin/web");
}

/** Empties a place. The gallery keeps its photos and the website goes back to its old ones. */
export async function clearWebPlace(placeKey: string) {
  const session = await requireAdmin();
  const key = placeKeySchema.safeParse(placeKey);
  if (!key.success) throw new Error("INVALID_INPUT");

  await assignWebPlaceFor(session.user.id, key.data, null);
  revalidatePath("/admin/web");
}

const labelSchema = z.string().min(1).max(190);

/** A new draft gallery for a place, and straight to it to fill it. */
export async function createWebPlaceGallery(placeKey: string, label: string) {
  const session = await requireAdmin();
  const key = placeKeySchema.safeParse(placeKey);
  const title = labelSchema.safeParse(label);
  if (!key.success || !title.success) throw new Error("INVALID_INPUT");

  const id = await createWebPlaceGalleryFor(session.user.id, key.data, title.data);
  revalidatePath("/admin/web");
  redirect(`/admin/g/${id}`);
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-guard";
import { MAX_PROMO_SLOT, MIN_PROMO_SLOT, PROMO_THEMES, isSafePromoUrl } from "@/lib/promo-card";

// Server Actions are publicly reachable POST endpoints — every one of them
// re-verifies the session internally (CLAUDE.md invariant #3), and every write
// is scoped by `ownerId` so a guessed id cannot reach another owner's row.

/** Trims, then treats an empty field as "not set" rather than as an empty string. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .nullable()
    .catch(null);

const promoCardSchema = z.object({
  name: z.string().trim().min(1).max(80),
  eyebrow: optionalText(40),
  headline: z.string().trim().min(1).max(120),
  body: optionalText(400),
  ctaLabel: optionalText(60),
  // Not just "a URL": this string is rendered as an `href` into pages held by
  // people who are not the owner, so `javascript:` and `data:` must never get
  // in. `isSafePromoUrl` is the same predicate the render path re-checks with.
  ctaUrl: z.string().trim().min(1).max(500).refine(isSafePromoUrl, "URL musí začínat http(s)://"),
  theme: z.enum(PROMO_THEMES),
});

function readPromoCard(formData: FormData) {
  return promoCardSchema.safeParse({
    name: formData.get("name"),
    eyebrow: formData.get("eyebrow"),
    headline: formData.get("headline"),
    body: formData.get("body"),
    ctaLabel: formData.get("ctaLabel"),
    ctaUrl: formData.get("ctaUrl"),
    theme: formData.get("theme"),
  });
}

export async function createPromoCard(formData: FormData) {
  const session = await requireAdmin();

  const parsed = readPromoCard(formData);
  if (!parsed.success) throw new Error("INVALID_INPUT");

  await prisma.promoCard.create({ data: { ownerId: session.user.id, ...parsed.data } });

  revalidatePath("/admin/promo");
}

export async function updatePromoCard(promoCardId: string, formData: FormData) {
  const session = await requireAdmin();

  const parsed = readPromoCard(formData);
  if (!parsed.success) throw new Error("INVALID_INPUT");

  // updateMany, not update: the `ownerId` in the filter is what makes a
  // guessed id a no-op rather than someone else's card being rewritten.
  await prisma.promoCard.updateMany({
    where: { id: promoCardId, ownerId: session.user.id },
    data: parsed.data,
  });

  await revalidateGalleriesShowing(promoCardId);
  revalidatePath("/admin/promo");
}

export async function deletePromoCard(promoCardId: string) {
  const session = await requireAdmin();

  // Read the placements before the delete cascades them away, so the galleries
  // that were showing this card still get revalidated.
  await revalidateGalleriesShowing(promoCardId);

  await prisma.promoCard.deleteMany({ where: { id: promoCardId, ownerId: session.user.id } });

  revalidatePath("/admin/promo");
}

const placementSchema = z.object({
  promoCardId: z.string().min(1),
  slot: z.coerce.number().int().min(MIN_PROMO_SLOT).max(MAX_PROMO_SLOT),
});

/**
 * Places a card in a gallery, or moves the one already there.
 *
 * Upsert rather than create: the admin form is the same control for "add" and
 * "change the slot", and a unique-constraint error is not a useful answer to
 * someone who just typed 6 instead of 5.
 */
export async function placePromoInGallery(galleryId: string, formData: FormData) {
  const session = await requireAdmin();

  const parsed = placementSchema.safeParse({
    promoCardId: formData.get("promoCardId"),
    slot: formData.get("slot"),
  });
  if (!parsed.success) throw new Error("INVALID_INPUT");

  // Both sides are checked against this owner before anything is written —
  // otherwise a guessed gallery id would let a card be placed into it, or a
  // guessed card id would place someone else's copy into your gallery.
  const [gallery, card] = await Promise.all([
    prisma.gallery.findFirst({
      where: { id: galleryId, ownerId: session.user.id },
      select: { id: true },
    }),
    prisma.promoCard.findFirst({
      where: { id: parsed.data.promoCardId, ownerId: session.user.id },
      select: { id: true },
    }),
  ]);
  if (!gallery || !card) throw new Error("NOT_FOUND");

  await prisma.galleryPromo.upsert({
    where: { galleryId_promoCardId: { galleryId, promoCardId: card.id } },
    create: { galleryId, promoCardId: card.id, slot: parsed.data.slot, enabled: true },
    update: { slot: parsed.data.slot, enabled: true },
  });

  revalidatePath(`/admin/g/${galleryId}`);
}

export async function setPromoPlacementEnabled(placementId: string, enabled: boolean) {
  const session = await requireAdmin();

  const placement = await ownedPlacement(placementId, session.user.id);
  if (!placement) throw new Error("NOT_FOUND");

  await prisma.galleryPromo.update({ where: { id: placementId }, data: { enabled } });

  revalidatePath(`/admin/g/${placement.galleryId}`);
}

export async function removePromoFromGallery(placementId: string) {
  const session = await requireAdmin();

  const placement = await ownedPlacement(placementId, session.user.id);
  if (!placement) throw new Error("NOT_FOUND");

  await prisma.galleryPromo.delete({ where: { id: placementId } });

  revalidatePath(`/admin/g/${placement.galleryId}`);
}

/** The placement, but only if the gallery it hangs off belongs to this owner. */
async function ownedPlacement(placementId: string, ownerId: string) {
  return prisma.galleryPromo.findFirst({
    where: { id: placementId, gallery: { ownerId } },
    select: { id: true, galleryId: true },
  });
}

/**
 * Editing a card changes what every gallery showing it renders, and those
 * pages are `force-dynamic` per request but their admin counterparts are not.
 * Revalidating the admin detail pages keeps the "kde je umístěná" list honest
 * straight after a rename.
 */
async function revalidateGalleriesShowing(promoCardId: string) {
  const placements = await prisma.galleryPromo.findMany({
    where: { promoCardId },
    select: { galleryId: true },
  });
  for (const placement of placements) revalidatePath(`/admin/g/${placement.galleryId}`);
}

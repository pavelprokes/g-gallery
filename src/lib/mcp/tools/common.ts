import "server-only";
import { z } from "zod";
import { decryptToken } from "@/lib/token-cipher";
import { McpToolError } from "../types";

export const idInput = (what: string) => z.string().min(1).max(64).describe(`Id ${what}.`);

/** A calendar day as the admin's date input sends it; stored as that day's UTC midnight. */
export const dayInput = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Datum musí mít tvar RRRR-MM-DD.")
  // `new Date("2026-02-30")` rolls over to 2 March instead of failing, and the
  // date ends up frozen in a slug — so it must read back as the same day.
  .refine((value) => {
    const date = new Date(value);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Takový den v kalendáři není.");

export const parseDay = (value: string): Date => new Date(value);

export const titleInput = z.string().trim().min(1).max(200);

export const limitInput = (max: number, fallback: number) =>
  z.number().int().min(1).max(max).default(fallback).describe(`Kolik položek vrátit (1–${max}).`);

export const offsetInput = z
  .number()
  .int()
  .min(0)
  .max(100_000)
  .default(0)
  .describe("Kolik položek přeskočit (stránkování).");

export function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

/** The day part only — event dates are calendar days, not instants. */
export function day(date: Date | null | undefined): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

/** `message` is the whole phrase ("Galerie nenalezena") — Czech agrees it by gender. */
export function notFound(message: string): McpToolError {
  return new McpToolError(
    `${message}. Id ber z výsledků galleries_list, weddings_list, gallery_get nebo photos_list.`,
  );
}

/** Runs a shared admin operation, turning its NOT_FOUND into a message the model can act on. */
export async function owned<T>(operation: Promise<T>, message: string): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") throw notFound(message);
    throw error;
  }
}

export function adminGalleryUrl(origin: string, galleryId: string): string {
  return `${origin}/admin/g/${galleryId}`;
}

export function adminWeddingUrl(origin: string, eventId: string): string {
  return `${origin}/admin/e/${eventId}`;
}

/** Null when the token cannot be shown (no TOKEN_ENCRYPTION_KEY, or a row from before it). */
export function shareLinkUrl(
  origin: string,
  link: { tokenCipher: string | null; slug: string | null },
): string | null {
  const token = decryptToken(link.tokenCipher);
  return token ? `${origin}/g/${token}/${link.slug ?? ""}` : null;
}

export function weddingUrl(
  origin: string,
  event: { tokenCipher: string | null; slug: string },
): string | null {
  const token = decryptToken(event.tokenCipher);
  return token ? `${origin}/s/${token}/${event.slug}` : null;
}

export function isLive(
  link: { revokedAt: Date | null; expiresAt: Date | null },
  now: Date,
): boolean {
  return !link.revokedAt && (!link.expiresAt || link.expiresAt > now);
}

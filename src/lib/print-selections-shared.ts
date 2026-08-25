/**
 * Print-quantity clamping logic shared by the browser and the server.
 *
 * Deliberately free of `server-only` and of any Prisma import — the gallery is
 * a Client Component, and pulling the server module in would drag the
 * database client into the browser bundle.
 */

export const MAX_PRINT_QUANTITY = 99;

/** Keeps a +1/-1 step (or any arbitrary edit) inside the valid 0–99 range. */
export function clampPrintQuantity(quantity: number): number {
  return Math.max(0, Math.min(MAX_PRINT_QUANTITY, quantity));
}
